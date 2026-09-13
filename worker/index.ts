/// <reference types="@cloudflare/workers-types" />

/**
 * API for the round coordinator.
 *
 * Only `/api/*` reaches this script — `run_worker_first` in wrangler.jsonc routes
 * those paths here and lets every other request fall through to the static
 * assets, which use SPA handling.
 *
 * Shape: a tournament holds rounds, a round holds boards. Which tournament and
 * round are on screen is shared state in `app_state`, not a per-device setting —
 * the coordinator switches and the watching tablets follow.
 *
 * Deliberately, saving writes only the *match state* (score, casualties, half,
 * outlook). The roster is never written from the client, so editing a coach
 * directly in D1 cannot be silently reverted by a tablet showing the old
 * line-up.
 */

import { fetchLiveRound, fetchTournament, type LiveMatch } from './tourplay'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
}

/** Every viewer polls, so Tourplay is only re-read when the data is older than this. */
const SYNC_MIN_INTERVAL_MS = 8_000

/** The app renders at most this many boards. */
const MAX_BOARDS = 8

/** The only outlook values the scale allows. */
const OUTLOOKS = [-1, -0.5, 0, 0.5, 1]

/** Guards against a runaway stepper writing an absurd score. */
const MAX_COUNT = 99

interface TournamentRow {
  id: number
  name: string
  tourplay_slug: string | null
  tourplay_phase_id: number | null
  sync_enabled: number
  last_synced_at: string | null
  total_rounds: number
  team_a_name: string
  team_a_country: string
  team_b_name: string
  team_b_country: string
  updated_at: string
}

interface RoundRow {
  id: number
  tournament_id: number
  round_number: number
  updated_at: string
}

interface BoardRow {
  id: number
  round_id: number
  board_no: number
  a_naf_name: string
  a_naf_number: number | null
  a_race: string
  a_score: number
  a_injuries: number
  a_vacant: number
  b_naf_name: string
  b_naf_number: number | null
  b_race: string
  b_score: number
  b_injuries: number
  b_vacant: number
  half: number
  outlook: number
  tourplay_match_id: string | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The round changes constantly; never let an edge or browser cache hold it.
      'cache-control': 'no-store',
    },
  })
}

function boardFromRow(row: BoardRow) {
  return {
    id: row.board_no,
    tourplayMatchId: row.tourplay_match_id,
    a: {
      nafName: row.a_naf_name,
      nafNumber: row.a_naf_number,
      race: row.a_race,
      score: row.a_score,
      injuries: row.a_injuries,
      ...(row.a_vacant ? { vacant: true } : {}),
    },
    b: {
      nafName: row.b_naf_name,
      nafNumber: row.b_naf_number,
      race: row.b_race,
      score: row.b_score,
      injuries: row.b_injuries,
      ...(row.b_vacant ? { vacant: true } : {}),
    },
    half: row.half,
    outlook: row.outlook,
  }
}

interface Active {
  tournament: TournamentRow
  round: RoundRow
}

/**
 * Resolves what is on screen, healing the pointers if they have gone stale —
 * a deleted round or a fresh database should not leave the app with nothing.
 */
async function resolveActive(db: D1Database): Promise<Active | null> {
  const state = await db
    .prepare('SELECT active_tournament_id, active_round_id FROM app_state WHERE id = 1')
    .first<{ active_tournament_id: number | null; active_round_id: number | null }>()

  let tournament = state?.active_tournament_id
    ? await db
        .prepare('SELECT * FROM tournament WHERE id = ?')
        .bind(state.active_tournament_id)
        .first<TournamentRow>()
    : null

  if (!tournament) {
    tournament = await db
      .prepare('SELECT * FROM tournament ORDER BY id LIMIT 1')
      .first<TournamentRow>()
  }
  if (!tournament) return null

  let round = state?.active_round_id
    ? await db
        .prepare('SELECT * FROM round WHERE id = ? AND tournament_id = ?')
        .bind(state.active_round_id, tournament.id)
        .first<RoundRow>()
    : null

  if (!round) {
    round = await db
      .prepare('SELECT * FROM round WHERE tournament_id = ? ORDER BY round_number DESC LIMIT 1')
      .bind(tournament.id)
      .first<RoundRow>()
  }
  if (!round) return null

  return { tournament, round }
}

async function setActive(db: D1Database, tournamentId: number, roundId: number) {
  await db
    .prepare(
      `INSERT INTO app_state (id, active_tournament_id, active_round_id) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET active_tournament_id = ?, active_round_id = ?`,
    )
    .bind(tournamentId, roundId, tournamentId, roundId)
    .run()
}

/** The whole payload the app needs: the selectors plus the round on screen. */
async function readState(db: D1Database) {
  const active = await resolveActive(db)
  if (!active) return null
  const { tournament, round } = active

  const [tournaments, rounds, boards] = await db.batch<any>([
    db.prepare('SELECT id, name, tourplay_slug, sync_enabled FROM tournament ORDER BY id'),
    db
      .prepare('SELECT id, round_number FROM round WHERE tournament_id = ? ORDER BY round_number')
      .bind(tournament.id),
    db.prepare('SELECT * FROM board WHERE round_id = ? ORDER BY board_no').bind(round.id),
  ])

  return {
    tournaments: (tournaments.results as any[]).map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.tourplay_slug,
      syncEnabled: t.sync_enabled === 1,
    })),
    activeTournamentId: tournament.id,
    rounds: (rounds.results as any[]).map((r) => ({ id: r.id, roundNumber: r.round_number })),
    activeRoundId: round.id,

    roundNumber: round.round_number,
    totalRounds: tournament.total_rounds,
    teamA: { name: tournament.team_a_name, country: tournament.team_a_country },
    teamB: { name: tournament.team_b_name, country: tournament.team_b_country },
    boards: (boards.results as BoardRow[]).map(boardFromRow),
    updatedAt: round.updated_at,
    tourplay: {
      slug: tournament.tourplay_slug,
      phaseId: tournament.tourplay_phase_id,
      syncEnabled: tournament.sync_enabled === 1,
      lastSyncedAt: tournament.last_synced_at,
    },
  }
}

/** Nations the app has a flag for, keyed by lower-case name. */
const FLAGS: Record<string, string> = { england: 'england', italy: 'italy' }

/**
 * A tournament named "England v Italy" is telling us its two sides, so use
 * them rather than leaving the columns headed Home and Away.
 */
function teamsFromName(name: string): { a: string; b: string; aCountry: string; bCountry: string } {
  const parts = name.split(/\s+(?:v|vs|versus)\s+/i)
  if (parts.length !== 2) return { a: 'Home', b: 'Away', aCountry: '', bCountry: '' }
  const [a, b] = parts.map((p) => p.trim())
  return {
    a: a || 'Home',
    b: b || 'Away',
    aCountry: FLAGS[a.toLowerCase()] ?? '',
    bCountry: FLAGS[b.toLowerCase()] ?? '',
  }
}

/** A whole-number count within range, or null if the value is unusable. */
function count(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < 0 || value > MAX_COUNT) return null
  return value
}

interface ValidBoard {
  id: number
  aScore: number
  aInjuries: number
  bScore: number
  bInjuries: number
  half: number
  outlook: number
}

/** Validates the save payload, returning a message rather than throwing. */
function validate(payload: unknown): { boards: ValidBoard[] } | { error: string } {
  if (typeof payload !== 'object' || payload === null) return { error: 'Body must be an object' }
  const boards = (payload as { boards?: unknown }).boards
  if (!Array.isArray(boards) || boards.length === 0) return { error: 'boards must be a non-empty array' }
  if (boards.length > MAX_BOARDS) return { error: `At most ${MAX_BOARDS} boards` }

  const seen = new Set<number>()
  const valid: ValidBoard[] = []

  for (const raw of boards) {
    if (typeof raw !== 'object' || raw === null) return { error: 'Each board must be an object' }
    const b = raw as Record<string, unknown>

    const id = b.id
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > MAX_BOARDS) {
      return { error: `Bad board id: ${String(id)}` }
    }
    if (seen.has(id)) return { error: `Duplicate board ${id}` }
    seen.add(id)

    const aScore = count(b.aScore)
    const aInjuries = count(b.aInjuries)
    const bScore = count(b.bScore)
    const bInjuries = count(b.bInjuries)
    if (aScore === null || aInjuries === null || bScore === null || bInjuries === null) {
      return { error: `Board ${id}: score and casualties must be whole numbers 0-${MAX_COUNT}` }
    }

    if (b.half !== 1 && b.half !== 2) return { error: `Board ${id}: half must be 1 or 2` }
    if (typeof b.outlook !== 'number' || !OUTLOOKS.includes(b.outlook)) {
      return { error: `Board ${id}: outlook must be one of ${OUTLOOKS.join(', ')}` }
    }

    valid.push({ id, aScore, aInjuries, bScore, bInjuries, half: b.half, outlook: b.outlook })
  }

  return { boards: valid }
}

/**
 * Writes live match state onto a round's boards.
 *
 * Matching is by Tourplay match id only. Falling back to board order would
 * happily write round 2's scores onto round 1's boards, which is exactly the
 * mistake worth designing out.
 */
function syncStatements(env: Env, matches: LiveMatch[], boards: BoardRow[]) {
  const byMatchId = new Map(matches.map((m) => [String(m.matchId), m]))
  const statements: D1PreparedStatement[] = []

  for (const board of boards) {
    if (!board.tourplay_match_id) continue
    const match = byMatchId.get(board.tourplay_match_id)
    if (!match) continue

    // A half Tourplay could not give us leaves the stored value alone rather
    // than resetting the board to the first half.
    const half = match.half ?? board.half

    statements.push(
      env.DB.prepare(
        `UPDATE board
            SET a_score = ?, a_injuries = ?, b_score = ?, b_injuries = ?, half = ?
          WHERE id = ?`,
      ).bind(
        match.local.score,
        match.local.injuries,
        match.visitor.score,
        match.visitor.injuries,
        half,
        board.id,
      ),
    )
  }

  return statements
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // ---- POST /api/activate : switch tournament and/or round ----
    if (path === '/api/activate') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)
      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }

      const active = await resolveActive(env.DB)
      let tournamentId = Number(body?.tournamentId ?? active?.tournament.id)
      if (!Number.isInteger(tournamentId)) return json({ error: 'tournamentId must be a number' }, 400)

      const tournament = await env.DB.prepare('SELECT id FROM tournament WHERE id = ?')
        .bind(tournamentId)
        .first<{ id: number }>()
      if (!tournament) return json({ error: `No tournament ${tournamentId}` }, 404)

      let roundId = body?.roundId != null ? Number(body.roundId) : null
      if (roundId != null) {
        const round = await env.DB.prepare('SELECT id FROM round WHERE id = ? AND tournament_id = ?')
          .bind(roundId, tournamentId)
          .first<{ id: number }>()
        if (!round) return json({ error: `Round ${roundId} is not in that tournament` }, 400)
      } else {
        // Switching tournament without naming a round lands on its latest.
        const latest = await env.DB.prepare(
          'SELECT id FROM round WHERE tournament_id = ? ORDER BY round_number DESC LIMIT 1',
        )
          .bind(tournamentId)
          .first<{ id: number }>()
        if (!latest) return json({ error: 'That tournament has no rounds yet' }, 400)
        roundId = latest.id
      }

      await setActive(env.DB, tournamentId, roundId)
      return json(await readState(env.DB))
    }

    // ---- POST /api/tournaments : create an empty tournament ----
    if (path === '/api/tournaments') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)
      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (!name) return json({ error: 'name is required' }, 400)

      const teams = teamsFromName(name)
      const inserted = await env.DB.prepare(
        `INSERT INTO tournament (name, total_rounds, team_a_name, team_a_country,
                                 team_b_name, team_b_country)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
        .bind(
          name,
          Number.isInteger(body?.totalRounds) ? body.totalRounds : 6,
          teams.a,
          teams.aCountry,
          teams.b,
          teams.bCountry,
        )
        .first<{ id: number }>()

      const round = await env.DB.prepare(
        'INSERT INTO round (tournament_id, round_number) VALUES (?, 1) RETURNING id',
      )
        .bind(inserted!.id)
        .first<{ id: number }>()

      await setActive(env.DB, inserted!.id, round!.id)
      return json(await readState(env.DB))
    }

    // ---- POST /api/sync : pull live match state from Tourplay ----
    if (path === '/api/sync') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)

      const active = await resolveActive(env.DB)
      if (!active) return json({ error: 'No round is set up' }, 404)
      const { tournament, round } = active

      if (!tournament.tourplay_slug) {
        return json({ error: 'This tournament is not linked to Tourplay' }, 400)
      }
      if (tournament.sync_enabled !== 1) {
        return json({ error: 'Sync is turned off for this tournament' }, 400)
      }

      const last = tournament.last_synced_at ? Date.parse(tournament.last_synced_at + 'Z') : 0
      if (Number.isFinite(last) && Date.now() - last < SYNC_MIN_INTERVAL_MS) {
        return json({ ...(await readState(env.DB)), synced: false, reason: 'too soon' })
      }

      let live
      try {
        live = await fetchLiveRound(tournament.tourplay_slug)
      } catch (cause) {
        return json({ error: cause instanceof Error ? cause.message : String(cause) }, 502)
      }

      // Tourplay only ever reports the round being played. Writing it onto a
      // different round would corrupt history, so say so instead.
      if (live.currentRound && live.currentRound !== round.round_number) {
        await env.DB.prepare("UPDATE tournament SET last_synced_at = datetime('now') WHERE id = ?")
          .bind(tournament.id)
          .run()
        return json({
          ...(await readState(env.DB)),
          synced: false,
          reason: 'viewing an earlier round',
          liveRound: live.currentRound,
        })
      }

      const boards = await env.DB.prepare('SELECT * FROM board WHERE round_id = ? ORDER BY board_no')
        .bind(round.id)
        .all<BoardRow>()
      const statements = syncStatements(env, live.matches, boards.results as BoardRow[])
      statements.push(
        env.DB.prepare(
          "UPDATE tournament SET last_synced_at = datetime('now'), tourplay_phase_id = ? WHERE id = ?",
        ).bind(live.phaseId, tournament.id),
      )
      await env.DB.batch(statements)

      return json({ ...(await readState(env.DB)), synced: true, matched: statements.length - 1 })
    }

    // ---- POST /api/link : import a Tourplay round ----
    if (path === '/api/link') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)

      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }

      const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
      if (!slug) return json({ error: 'slug is required' }, 400)

      // Check the tournament exists before blaming the fixtures.
      let info
      try {
        info = await fetchTournament(slug)
      } catch (cause) {
        return json({ error: cause instanceof Error ? cause.message : String(cause) }, 404)
      }

      let live
      try {
        live = await fetchLiveRound(slug, false)
      } catch (cause) {
        return json({ error: cause instanceof Error ? cause.message : String(cause) }, 502)
      }

      const matches = [...live.matches].sort((a, b) => a.order - b.order).slice(0, MAX_BOARDS)
      if (matches.length === 0) return json({ error: 'That tournament has no matches drawn yet' }, 400)

      const roundNumber = live.currentRound || 1
      const existing = await env.DB.prepare('SELECT * FROM tournament WHERE tourplay_slug = ?')
        .bind(slug)
        .first<TournamentRow>()
      const existingRound = existing
        ? await env.DB.prepare('SELECT id FROM round WHERE tournament_id = ? AND round_number = ?')
            .bind(existing.id, roundNumber)
            .first<{ id: number }>()
        : null

      if (body?.confirm !== true) {
        return json({
          preview: true,
          slug,
          tournament: info,
          phaseId: live.phaseId,
          currentRound: roundNumber,
          truncated: live.matches.length > MAX_BOARDS ? live.matches.length - MAX_BOARDS : 0,
          // Says plainly what confirming would do to existing data.
          effect: existing
            ? existingRound
              ? `Replaces round ${roundNumber} of "${existing.name}"`
              : `Adds round ${roundNumber} to "${existing.name}"`
            : `Creates a new tournament "${info.name}"`,
          boards: matches.map((m) => ({
            board: m.order,
            a: { coach: m.local.coach, race: m.local.race },
            b: { coach: m.visitor.coach, race: m.visitor.race },
          })),
        })
      }

      // Find or create the tournament for this slug, so re-importing a round
      // updates it rather than piling up duplicates.
      let tournamentId = existing?.id
      if (!tournamentId) {
        const created = await env.DB.prepare(
          `INSERT INTO tournament (name, tourplay_slug, tourplay_phase_id, sync_enabled,
                                   last_synced_at, team_a_name, team_a_country,
                                   team_b_name, team_b_country)
           VALUES (?, ?, ?, 1, datetime('now'), 'Home', '', 'Away', '')
           RETURNING id`,
        )
          .bind(info.name, slug, live.phaseId)
          .first<{ id: number }>()
        tournamentId = created!.id
      } else {
        await env.DB.prepare(
          "UPDATE tournament SET tourplay_phase_id = ?, sync_enabled = 1, last_synced_at = datetime('now') WHERE id = ?",
        )
          .bind(live.phaseId, tournamentId)
          .run()
      }

      let roundId = existingRound?.id
      if (!roundId) {
        const created = await env.DB.prepare(
          'INSERT INTO round (tournament_id, round_number) VALUES (?, ?) RETURNING id',
        )
          .bind(tournamentId, roundNumber)
          .first<{ id: number }>()
        roundId = created!.id
      }

      const statements: D1PreparedStatement[] = [
        env.DB.prepare('DELETE FROM board WHERE round_id = ?').bind(roundId),
      ]
      matches.forEach((m, index) => {
        statements.push(
          env.DB.prepare(
            `INSERT INTO board (round_id, board_no, a_naf_name, a_race, a_score, a_injuries,
                                b_naf_name, b_race, b_score, b_injuries, half, outlook,
                                tourplay_match_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
          ).bind(
            roundId,
            index + 1,
            m.local.coach || 'Unknown',
            m.local.race || '',
            m.local.score,
            m.local.injuries,
            m.visitor.coach || 'Unknown',
            m.visitor.race || '',
            m.visitor.score,
            m.visitor.injuries,
            String(m.matchId),
          ),
        )
      })
      statements.push(
        env.DB.prepare("UPDATE round SET updated_at = datetime('now') WHERE id = ?").bind(roundId),
      )
      await env.DB.batch(statements)
      await setActive(env.DB, tournamentId!, roundId!)

      return json({ ...(await readState(env.DB)), linked: true, imported: matches.length })
    }

    // ---- POST /api/sync-mode : follow Tourplay, or go manual ----
    if (path === '/api/sync-mode') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)
      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }
      if (typeof body?.enabled !== 'boolean') return json({ error: 'enabled must be a boolean' }, 400)
      const active = await resolveActive(env.DB)
      if (!active) return json({ error: 'No round is set up' }, 404)
      await env.DB.prepare('UPDATE tournament SET sync_enabled = ? WHERE id = ?')
        .bind(body.enabled ? 1 : 0, active.tournament.id)
        .run()
      return json(await readState(env.DB))
    }

    if (path !== '/api/round') {
      return json({ error: 'Not found' }, 404)
    }

    if (request.method === 'GET') {
      const state = await readState(env.DB)
      if (!state) return json({ error: 'No round has been set up' }, 404)
      return json(state)
    }

    if (request.method === 'PUT') {
      let payload: unknown
      try {
        payload = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }

      const result = validate(payload)
      if ('error' in result) return json({ error: result.error }, 400)

      const active = await resolveActive(env.DB)
      if (!active) return json({ error: 'No round is set up' }, 404)

      // One batch, so a save either lands whole or not at all — a half-written
      // round on a coordinator's screen would be worse than a failed save.
      const statements = result.boards.map((b) =>
        env.DB.prepare(
          `UPDATE board
             SET a_score = ?, a_injuries = ?, b_score = ?, b_injuries = ?, half = ?, outlook = ?
           WHERE round_id = ? AND board_no = ?`,
        ).bind(b.aScore, b.aInjuries, b.bScore, b.bInjuries, b.half, b.outlook, active.round.id, b.id),
      )
      statements.push(
        env.DB.prepare("UPDATE round SET updated_at = datetime('now') WHERE id = ?").bind(
          active.round.id,
        ),
      )

      try {
        await env.DB.batch(statements)
      } catch (cause) {
        // Most likely a CHECK constraint the validation above should have caught.
        return json({ error: `Save rejected by the database: ${String(cause)}` }, 500)
      }

      return json(await readState(env.DB))
    }

    return json({ error: `${request.method} not allowed` }, 405)
  },
} satisfies ExportedHandler<Env>

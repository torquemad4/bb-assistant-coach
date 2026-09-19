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

import { fetchLiveRound, fetchNafNumbers, fetchTournament, type LiveMatch } from './tourplay'
import { pingEngine, pullScouting } from './scout'
import { fetchMatchups, tableFromSnapshot, MATCHUP_MAX_AGE_MS, type MatchupPayload } from './matchups'
import { identify } from './access'
import { chooseName, nafHandles } from './naf'

/**
 * How casualties read on screen. Declared here rather than imported: the Worker
 * compiles on its own and shares no module with the app. The two definitions
 * are two lines of the same alternative — if one gains a third reading, the
 * CHECK constraint in migration 0010 rejects it before the mismatch can matter.
 */
type CasualtyMode = 'removals' | 'players'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /** Base URL of the NAF Scout engine. Unset falls back to the hosted service. */
  SCOUT_API_URL?: string
  /** Zero Trust team domain. Unset falls back to the one in access.ts. */
  ACCESS_TEAM_DOMAIN?: string
  /**
   * The Access application's Audience tag. Unset means the `aud` claim is not
   * checked, which /api/me reports rather than hides — see access.ts.
   */
  ACCESS_AUD?: string
}

/** Who is asking, once Access and the roster have both had their say. */
interface Viewer {
  state: 'local' | 'verified' | 'rejected'
  email: string | null
  displayName: string | null
  nafNumber: number | null
  /** May run a round: Match Control, Settings, the selectors. */
  isAdmin: boolean
  /**
   * Owns the app: the Admin panel, which sets everyone else's role and decides
   * which tournaments are live. A separate axis from `isAdmin` so that handing
   * the coordinator role over does not hand over the ability to take it back.
   */
  isOwner: boolean
  audChecked: boolean
  reason: string | null
}

/**
 * Resolves the caller.
 *
 * A login Access recognises but the roster does not is a WATCHER: everything
 * visible, nothing writable. That is deliberately the default, so adding an
 * email to the Access allowlist never silently grants write access to the round.
 */
async function resolveViewer(request: Request, env: Env): Promise<Viewer> {
  const access = await identify(request, env)

  if (access.state !== 'verified' || !access.claims) {
    return {
      state: access.state,
      email: null,
      displayName: null,
      nafNumber: null,
      // Off Access entirely (local dev) the developer is the coordinator, and
      // the owner too — otherwise the Admin panel could never be worked on.
      isAdmin: access.state === 'local',
      isOwner: access.state === 'local',
      audChecked: false,
      reason: access.reason,
    }
  }

  const row = await env.DB.prepare(
    'SELECT naf_number, display_name, is_admin, is_owner FROM coach_identity WHERE email = ?',
  )
    .bind(access.claims.email)
    .first<{
      naf_number: number | null
      display_name: string | null
      is_admin: number
      is_owner: number
    }>()

  return {
    state: 'verified',
    email: access.claims.email,
    displayName: row?.display_name ?? null,
    nafNumber: row?.naf_number ?? null,
    isAdmin: row?.is_admin === 1,
    isOwner: row?.is_owner === 1,
    audChecked: access.claims.audChecked,
    reason: null,
  }
}

/** The refusal anyone but the owner gets from the Admin panel. */
function notOwner(viewer: Viewer): Response {
  if (viewer.state === 'rejected') {
    return json({ error: viewer.reason ?? 'Your Access session could not be checked' }, 403)
  }
  return json({ error: 'The Admin panel belongs to the app owner.' }, 403)
}

/** The refusal a non-coordinator gets from a coordinator-only endpoint. */
function notAllowed(viewer: Viewer): Response {
  if (viewer.state === 'rejected') {
    return json({ error: viewer.reason ?? 'Your Access session could not be checked' }, 403)
  }
  return json(
    {
      error: viewer.nafNumber
        ? 'Only the coordinator can change this. Your own board is on the My Board tab.'
        : 'Only the coordinator can change this.',
    },
    403,
  )
}

/** Every viewer polls, so Tourplay is only re-read when the data is older than this. */
const SYNC_MIN_INTERVAL_MS = 8_000

/** The app renders at most this many boards. */
const MAX_BOARDS = 8

/**
 * Where a board's number is parked for the instant a swap takes to run. Outside
 * the 1-8 range on purpose, so it can never collide with a real board.
 */
const PARKING_BOARD_NO = -1

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
  rosters_provisional: number
  team_a_name: string
  team_a_country: string
  team_b_name: string
  team_b_country: string
  updated_at: string
  /** Live now, rather than set up and waiting. See migration 0012. */
  is_active: number
  /** Which round of THIS tournament is showing. */
  active_round_id: number | null
  casualty_mode: string | null
  open_coordinator: number | null
  /** 'ours' makes the dashboard one card per coach of ours — see migration 0013. */
  dashboard_mode: string | null
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
  period: string
  kickoff: string | null
  outlook: number
  tourplay_match_id: string | null
  tag: string | null
  tag_locked: number
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
    period: row.period,
    kickoff: row.kickoff,
    outlook: row.outlook,
    tag: row.tag,
    tagLocked: row.tag_locked === 1,
  }
}

/** What each tag seeds a board's outlook to. */
const TAG_OUTLOOK: Record<string, number> = { swing: -0.5, anchor: 0, bonus: 0.5 }
const TAGS = Object.keys(TAG_OUTLOOK)

interface Active {
  tournament: TournamentRow
  round: RoundRow
  casualtyMode: CasualtyMode
  openCoordinator: boolean
}

/**
 * Which tournaments this coach belongs to, and which of those are live.
 *
 * Membership is derived from the boards rather than kept in a list of its own:
 * a coach is in a tournament because their NAF number is on one of its boards.
 * Nothing to maintain, and it cannot disagree with the roster. The cost is that
 * a tournament with no draw imported yet has nobody in it, which is right —
 * there is nothing for them to look at.
 */
async function tournamentsForCoach(
  db: D1Database,
  nafNumber: number | null,
): Promise<{ id: number; isActive: boolean }[]> {
  if (nafNumber == null) return []
  const rows = await db
    .prepare(
      `SELECT DISTINCT t.id AS id, t.is_active AS is_active
         FROM board b
         JOIN round r ON b.round_id = r.id
         JOIN tournament t ON r.tournament_id = t.id
        WHERE b.a_naf_number = ? OR b.b_naf_number = ?
        ORDER BY t.id`,
    )
    .bind(nafNumber, nafNumber)
    .all<{ id: number; is_active: number }>()
  return (rows.results ?? []).map((r) => ({ id: r.id, isActive: r.is_active === 1 }))
}

/**
 * Which tournament this viewer is looking at, and whether they may change it.
 *
 * The rule Karl set: a coach with a live tournament is LOCKED to it — at an
 * event you are playing in one thing, and the screen should not be able to
 * wander off it. A coach with none may pick among the ones they belong to.
 * Whoever runs the event is not a coach for this purpose: a coordinator and the
 * owner see everything and choose freely, because somebody has to be able to
 * look at the other hall.
 *
 * `wanted` is the viewer's own choice, carried per device rather than stored,
 * so two people can be on different tournaments at the same moment. It is
 * honoured only where the rules allow it.
 */
async function tournamentForViewer(
  db: D1Database,
  viewer: Viewer,
  wanted: number | null,
): Promise<{ id: number | null; locked: boolean; choices: number[] }> {
  if (viewer.isAdmin || viewer.isOwner) {
    const all = await db.prepare('SELECT id FROM tournament ORDER BY id').all<{ id: number }>()
    const ids = (all.results ?? []).map((r) => r.id)
    const active = await db
      .prepare('SELECT id FROM tournament WHERE is_active = 1 ORDER BY id LIMIT 1')
      .first<{ id: number }>()
    const pick = wanted != null && ids.includes(wanted) ? wanted : active?.id ?? ids[0] ?? null
    return { id: pick, locked: false, choices: ids }
  }

  const mine = await tournamentsForCoach(db, viewer.nafNumber)
  const live = mine.find((t) => t.isActive)
  if (live) return { id: live.id, locked: true, choices: [live.id] }

  const ids = mine.map((t) => t.id)
  if (ids.length > 0) {
    const pick = wanted != null && ids.includes(wanted) ? wanted : ids[0]
    return { id: pick, locked: ids.length === 1, choices: ids }
  }

  // A watcher, or a coach with no boards anywhere: show whatever is live so the
  // app is not blank, and let them look but not choose.
  const active = await db
    .prepare('SELECT id FROM tournament WHERE is_active = 1 ORDER BY id LIMIT 1')
    .first<{ id: number }>()
  return { id: active?.id ?? null, locked: true, choices: [] }
}

/**
 * Resolves what is on screen, healing the pointers if they have gone stale —
 * a deleted round or a fresh database should not leave the app with nothing.
 *
 * `forTournament` names which tournament to resolve; without it the first live
 * one is used, then simply the first, so a fresh database still renders.
 */
async function resolveActive(
  db: D1Database,
  forTournament?: number | null,
): Promise<Active | null> {
  let tournament = forTournament
    ? await db.prepare('SELECT * FROM tournament WHERE id = ?').bind(forTournament).first<TournamentRow>()
    : null

  if (!tournament) {
    tournament = await db
      .prepare('SELECT * FROM tournament WHERE is_active = 1 ORDER BY id LIMIT 1')
      .first<TournamentRow>()
  }
  if (!tournament) {
    tournament = await db
      .prepare('SELECT * FROM tournament ORDER BY id LIMIT 1')
      .first<TournamentRow>()
  }
  if (!tournament) return null

  let round = tournament.active_round_id
    ? await db
        .prepare('SELECT * FROM round WHERE id = ? AND tournament_id = ?')
        .bind(tournament.active_round_id, tournament.id)
        .first<RoundRow>()
    : null

  if (!round) {
    round = await db
      .prepare('SELECT * FROM round WHERE tournament_id = ? ORDER BY round_number DESC LIMIT 1')
      .bind(tournament.id)
      .first<RoundRow>()
  }
  if (!round) return null

  // Anything other than the one alternative reads as removals, so a value that
  // predates this column or arrives corrupt fails safe to the original meaning.
  const casualtyMode: CasualtyMode = tournament.casualty_mode === 'players' ? 'players' : 'removals'

  return { tournament, round, casualtyMode, openCoordinator: tournament.open_coordinator === 1 }
}

/**
 * Points a tournament at one of its own rounds.
 *
 * Was a single global pointer; now each tournament carries its own, so moving
 * the Eurobowl to round 3 leaves the EurOpen exactly where it was. `app_state`
 * is still written so that anything not yet migrated keeps working, but nothing
 * reads it for this any more.
 */
async function setActive(db: D1Database, tournamentId: number, roundId: number) {
  await db.batch([
    db
      .prepare('UPDATE tournament SET active_round_id = ? WHERE id = ?')
      .bind(roundId, tournamentId),
    db
      .prepare(
        `INSERT INTO app_state (id, active_tournament_id, active_round_id) VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET active_tournament_id = ?, active_round_id = ?`,
      )
      .bind(tournamentId, roundId, tournamentId, roundId),
  ])
}

/** The whole payload the app needs: the selectors plus the round on screen. */
async function readState(
  db: D1Database,
  view: { id: number | null; locked: boolean; choices: number[] },
) {
  const active = await resolveActive(db, view.id)
  if (!active) return null
  const { tournament, round, casualtyMode, openCoordinator } = active

  const scout = await db
    .prepare('SELECT payload, generated_at FROM scout WHERE round_id = ?')
    .bind(round.id)
    .first<{ payload: string; generated_at: string | null }>()

  // Only the tournaments this viewer may look at, so the selector cannot offer
  // somebody else's event. A coordinator's `choices` is every tournament.
  const visible = view.choices.length ? view.choices : [tournament.id]
  const [tournaments, rounds, boards] = await db.batch<any>([
    db.prepare(
      `SELECT id, name, tourplay_slug, sync_enabled, is_active FROM tournament
        WHERE id IN (${visible.map(() => '?').join(',')}) ORDER BY id`,
    ).bind(...visible),
    db
      .prepare('SELECT id, round_number FROM round WHERE tournament_id = ? ORDER BY round_number')
      .bind(tournament.id),
    db.prepare('SELECT * FROM board WHERE round_id = ? ORDER BY board_no').bind(round.id),
  ])

  // In 'ours' mode the dashboard is made of our coaches rather than of boards.
  // Worked out here, where coach_identity lives, so the client never has to be
  // told who "we" are: one entry per seat of ours, and a board with two of ours
  // on it yields two — the same match seen from each end.
  const dashboardMode = tournament.dashboard_mode === 'ours' ? 'ours' : 'fixture'
  let ourSeats: { boardId: number; side: 'a' | 'b' }[] = []
  if (dashboardMode === 'ours') {
    const rows = await db
      .prepare(
        // EXISTS rather than a join: two roster rows carrying the same NAF
        // number would make the join emit the board twice, which draws that
        // coach's card twice and counts their outlook twice in the round
        // total. Nothing stops a second row today — `naf_number` is not
        // unique — and a duplicate is easiest to create by accident exactly
        // when somebody is being added mid-event.
        `SELECT b.board_no AS board_no,
                EXISTS (SELECT 1 FROM coach_identity c
                         WHERE c.naf_number IS NOT NULL
                           AND c.naf_number = b.a_naf_number) AS mine_a,
                EXISTS (SELECT 1 FROM coach_identity c
                         WHERE c.naf_number IS NOT NULL
                           AND c.naf_number = b.b_naf_number) AS mine_b
           FROM board b
          WHERE b.round_id = ?
          ORDER BY b.board_no`,
      )
      .bind(round.id)
      .all<{ board_no: number; mine_a: number; mine_b: number }>()
    for (const r of rows.results ?? []) {
      if (r.mine_a === 1) ourSeats.push({ boardId: r.board_no, side: 'a' })
      if (r.mine_b === 1) ourSeats.push({ boardId: r.board_no, side: 'b' })
    }
  }

  return {
    dashboardMode,
    ourSeats,
    tournaments: (tournaments.results as any[]).map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.tourplay_slug,
      syncEnabled: t.sync_enabled === 1,
      isActive: t.is_active === 1,
    })),
    activeTournamentId: tournament.id,
    /** True when this viewer may not change tournament. */
    tournamentLocked: view.locked,
    rounds: (rounds.results as any[]).map((r) => ({ id: r.id, roundNumber: r.round_number })),
    activeRoundId: round.id,

    roundNumber: round.round_number,
    totalRounds: tournament.total_rounds,
    teamA: { name: tournament.team_a_name, country: tournament.team_a_country },
    teamB: { name: tournament.team_b_name, country: tournament.team_b_country },
    rostersProvisional: tournament.rosters_provisional === 1,
    casualtyMode,
    openCoordinator,
    boards: (boards.results as BoardRow[]).map(boardFromRow),
    // Parsed here so a corrupt blob fails once, on the server, rather than
    // throwing inside every viewer's render.
    scout: scout ? safeParse(scout.payload) : null,
    updatedAt: round.updated_at,
    tourplay: {
      slug: tournament.tourplay_slug,
      phaseId: tournament.tourplay_phase_id,
      syncEnabled: tournament.sync_enabled === 1,
      lastSyncedAt: tournament.last_synced_at,
    },
  }
}

/**
 * Everything the Admin panel shows: who is on the roster, and every tournament
 * with the count of coaches it would lock.
 */
async function adminState(db: D1Database) {
  const [people, tournaments] = await db.batch<any>([
    db.prepare(
      `SELECT email, naf_number, display_name, is_admin, is_owner, added_at
         FROM coach_identity ORDER BY is_owner DESC, is_admin DESC, display_name`,
    ),
    db.prepare(
      `SELECT t.id, t.name, t.is_active,
              (SELECT COUNT(DISTINCT c.email)
                 FROM coach_identity c
                 JOIN board b ON (b.a_naf_number = c.naf_number OR b.b_naf_number = c.naf_number)
                 JOIN round r ON b.round_id = r.id
                WHERE r.tournament_id = t.id) AS coaches
         FROM tournament t ORDER BY t.id`,
    ),
  ])
  return {
    people: (people.results as any[]).map((p) => ({
      email: p.email,
      nafNumber: p.naf_number,
      name: p.display_name,
      isAdmin: p.is_admin === 1,
      isOwner: p.is_owner === 1,
      addedAt: p.added_at,
    })),
    tournaments: (tournaments.results as any[]).map((t) => ({
      id: t.id,
      name: t.name,
      isActive: t.is_active === 1,
      coaches: t.coaches,
    })),
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

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** A whole-number count within range, or null if the value is unusable. */
function count(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < 0 || value > MAX_COUNT) return null
  return value
}

const PERIODS = ['1', '2', 'FT']

interface ValidBoard {
  id: number
  aScore: number
  aInjuries: number
  bScore: number
  bInjuries: number
  period: string
  kickoff: string | null
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

    if (typeof b.period !== 'string' || !PERIODS.includes(b.period)) {
      return { error: `Board ${id}: period must be one of ${PERIODS.join(', ')}` }
    }
    const kickoff = b.kickoff == null ? null : b.kickoff
    if (kickoff !== null && kickoff !== 'K' && kickoff !== 'R') {
      return { error: `Board ${id}: kickoff must be K, R or null` }
    }
    if (typeof b.outlook !== 'number' || !OUTLOOKS.includes(b.outlook)) {
      return { error: `Board ${id}: outlook must be one of ${OUTLOOKS.join(', ')}` }
    }

    // A finished match's outlook is the result, whatever the client sent. The
    // server decides this so two tablets cannot disagree about a settled game.
    const outlook =
      b.period === 'FT' ? (aScore > bScore ? 1 : aScore < bScore ? -1 : 0) : b.outlook

    valid.push({
      id,
      aScore,
      aInjuries,
      bScore,
      bInjuries,
      period: b.period,
      kickoff,
      outlook,
    })
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
    // Full time is the coordinator's call, and it stands. Tourplay must not
    // keep pushing scores into a game that has been settled.
    if (board.period === 'FT') continue
    const match = byMatchId.get(board.tourplay_match_id)
    if (!match) continue

    // A half Tourplay could not give us leaves the stored value alone rather
    // than resetting the board to the first half.
    const period = match.half ? String(match.half) : board.period

    statements.push(
      env.DB.prepare(
        `UPDATE board
            SET a_score = ?, a_injuries = ?, b_score = ?, b_injuries = ?, period = ?
          WHERE id = ?`,
      ).bind(
        match.local.score,
        match.local.injuries,
        match.visitor.score,
        match.visitor.injuries,
        period,
        board.id,
      ),
    )
  }

  return statements
}

/**
 * The Eurobowl race matrix, from cache when it is fresh enough.
 *
 * Deliberately total: a community site being down, slow or reshaped must never
 * fail a scouting pull. Stale beats absent, and absent beats broken — the view
 * renders a missing matchup as an em dash either way.
 */
async function loadMatchups(
  env: Env,
): Promise<{ payload: MatchupPayload | null; error: string | null; stale: boolean }> {
  const db = env.DB
  const cached = await db
    .prepare('SELECT payload, fetched_at FROM matchup_cache WHERE id = 1')
    .first<{ payload: string; fetched_at: string }>()

  const age = cached ? Date.now() - Date.parse(cached.fetched_at) : Infinity
  if (cached && Number.isFinite(age) && age < MATCHUP_MAX_AGE_MS) {
    return { payload: safeParse(cached.payload) as MatchupPayload, error: null, stale: false }
  }

  try {
    const fresh = await fetchMatchups()
    await db
      .prepare(
        `INSERT INTO matchup_cache (id, payload, fetched_at) VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
      )
      .bind(JSON.stringify(fresh), fresh.fetchedAt)
      .run()
    return { payload: fresh, error: null, stale: false }
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)

    // Whatever was last stored, however old, beats nothing.
    if (cached) {
      return { payload: safeParse(cached.payload) as MatchupPayload, error, stale: true }
    }

    // Then the snapshot that ships with the app. This is the normal path today:
    // BBTV omits its TLS intermediate and Cloudflare refuses the chain (526).
    try {
      const file = await env.ASSETS.fetch(new Request('https://assets/data/eb-matchups.json'))
      if (file.ok) {
        const snapshot = tableFromSnapshot(await file.json())
        if (snapshot) return { payload: snapshot, error, stale: true }
      }
    } catch {
      /* the snapshot is the last resort; there is nothing after it */
    }

    // Never silently: a missing figure nobody can explain is how a wrong
    // address passed for a dead service once already.
    return { payload: null, error, stale: false }
  }
}

/**
 * Is the hall running open, with everyone holding the coordinator's powers?
 *
 * Read on its own because the authorisation gate runs before any round is
 * resolved, and a write must not be admitted on the strength of a flag nobody
 * has looked up. A missing row or an unreadable value means closed: the safe
 * answer is always the one that grants nothing.
 */
async function openCoordinatorMode(db: D1Database, tournamentId: number | null): Promise<boolean> {
  if (tournamentId == null) return false
  try {
    const row = await db
      .prepare('SELECT open_coordinator FROM tournament WHERE id = ?')
      .bind(tournamentId)
      .first<{ open_coordinator: number | null }>()
    return row?.open_coordinator === 1
  } catch {
    return false
  }
}

/**
 * Endpoints only the coordinator may call, checked in ONE place rather than
 * eleven. Scattered guards are how one endpoint ends up unguarded, and every
 * one of these can rewrite boards that are not the caller's.
 */
const COORDINATOR_PATHS = new Set([
  '/api/activate',
  '/api/tournaments',
  '/api/tag',
  '/api/provisional',
  '/api/scout',
  '/api/scout/refresh',
  '/api/sync',
  '/api/sync-mode',
  '/api/link',
  '/api/board-order',
  '/api/settings',
])

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // What a screen shows now depends on who is looking, so the viewer is
    // resolved for every request rather than only for writes. The signature
    // check is a cached-key RSA verify; the ten-second poll can afford it.
    const viewer = await resolveViewer(request, env)

    // The viewer's own choice of tournament, carried in the query string so it
    // is per device — two people can be on different tournaments at once — and
    // so a POST does not have to spend its single body read on it.
    const askedFor = Number(url.searchParams.get('t'))
    const view = await tournamentForViewer(
      env.DB,
      viewer,
      Number.isInteger(askedFor) && askedFor > 0 ? askedFor : null,
    )

    const writing = request.method !== 'GET' && request.method !== 'HEAD'
    if (writing && (COORDINATOR_PATHS.has(path) || path === '/api/round')) {
      // Open mode lends the coordinator's powers to everyone signed in — but
      // never over these two endpoints, which are where the lending is switched
      // off and where roles are set. A flag that could protect itself would be
      // a one-way door.
      const guarded = path === '/api/settings' || path === '/api/admin'
      const lent = guarded ? false : await openCoordinatorMode(env.DB, view.id)
      if (!viewer.isAdmin && !lent) return notAllowed(viewer)
    }

    // The Admin panel is the owner's alone, read and write. It is the one place
    // that decides who may coordinate, so it cannot be reachable by a role it
    // hands out.
    if (path === '/api/admin' && !viewer.isOwner) return notOwner(viewer)

    // ---- GET /api/me : who does this browser belong to? ----
    if (path === '/api/me') {
      if (request.method !== 'GET') return json({ error: `${request.method} not allowed` }, 405)

      // Which board, if any, in the round this viewer is looking at. By NAF
      // number, so re-pairing and board reordering both take care of
      // themselves — and scoped to their own tournament, so a coach in the
      // EurOpen is not told they have no board because the Eurobowl is up.
      let board: { id: number; side: 'a' | 'b'; opponent: string } | null = null
      if (viewer.nafNumber != null) {
        const active = await resolveActive(env.DB, view.id)
        if (active) {
          const row = await env.DB.prepare(
            `SELECT board_no, a_naf_number, a_naf_name, b_naf_name
               FROM board
              WHERE round_id = ? AND (a_naf_number = ? OR b_naf_number = ?)`,
          )
            .bind(active.round.id, viewer.nafNumber, viewer.nafNumber)
            .first<{
              board_no: number
              a_naf_number: number | null
              a_naf_name: string
              b_naf_name: string
            }>()
          if (row) {
            const side = row.a_naf_number === viewer.nafNumber ? 'a' : 'b'
            board = {
              id: row.board_no,
              side,
              opponent: side === 'a' ? row.b_naf_name : row.a_naf_name,
            }
          }
        }
      }

      const lent = await openCoordinatorMode(env.DB, view.id)

      // The tournaments this viewer may look at, named, so the dropdown can be
      // drawn without a second request.
      const choosable = view.choices.length
        ? await env.DB.prepare(
            `SELECT id, name, is_active FROM tournament WHERE id IN (${view.choices
              .map(() => '?')
              .join(',')}) ORDER BY id`,
          )
            .bind(...view.choices)
            .all<{ id: number; name: string; is_active: number }>()
        : { results: [] as { id: number; name: string; is_active: number }[] }

      return json({
        state: viewer.state,
        email: viewer.email,
        name: viewer.displayName,
        nafNumber: viewer.nafNumber,
        // The real role, from coach_identity. It alone opens the Settings tab,
        // because Settings holds the switch that lends the role out.
        isAdmin: viewer.isAdmin,
        // The role in force right now, real or lent. This is what the app reads
        // to decide whether to offer Match Control — a control that would be
        // refused should not be on screen, and one that would be accepted
        // should not be hidden.
        canCoordinate: viewer.isAdmin || lent,
        /** True when the powers are lent rather than held, so the app can say so. */
        openCoordinator: lent,
        /** Owns the app: the Admin panel. Separate from coordinating. */
        isOwner: viewer.isOwner,
        /** The tournament this viewer is on. */
        tournamentId: view.id,
        /**
         * True when they may not change it — a coach whose tournament is live
         * is held to it, and a watcher has nothing to choose between.
         */
        tournamentLocked: view.locked,
        /** What the dropdown may offer them. */
        tournaments: (choosable.results ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          isActive: t.is_active === 1,
        })),
        board,
        // Surfaced, not hidden: an unset ACCESS_AUD means a token minted for a
        // different Access app in the same account would also be accepted.
        audChecked: viewer.audChecked,
        reason: viewer.reason,
      })
    }

    // ---- POST /api/my-board : a coach reports their own match ----
    if (path === '/api/my-board') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)
      const viewer = await resolveViewer(request, env)
      if (viewer.state === 'rejected') return notAllowed(viewer)
      if (viewer.nafNumber == null) {
        return json({ error: 'You are not on the roster for this round.' }, 403)
      }

      const active = await resolveActive(env.DB, view.id)
      if (!active) return json({ error: 'No round is set up' }, 404)

      // Tourplay owns match state while it is being followed; anything entered
      // here would be overwritten within ten seconds, which is worse than
      // being told no.
      if (active.tournament.sync_enabled === 1) {
        return json(
          { error: 'This round is following Tourplay. The coordinator must switch to manual entry first.' },
          409,
        )
      }

      // The board is NEVER taken from the request. A coach cannot name a board,
      // so they cannot name someone else's.
      const board = await env.DB.prepare(
        `SELECT * FROM board WHERE round_id = ? AND (a_naf_number = ? OR b_naf_number = ?)`,
      )
        .bind(active.round.id, viewer.nafNumber, viewer.nafNumber)
        .first<BoardRow>()
      if (!board) return json({ error: 'You do not have a board in this round.' }, 404)

      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }

      const aScore = count(body?.aScore)
      const aInjuries = count(body?.aInjuries)
      const bScore = count(body?.bScore)
      const bInjuries = count(body?.bInjuries)
      if (aScore === null || aInjuries === null || bScore === null || bInjuries === null) {
        return json({ error: `Scores and casualties must be whole numbers, 0 to ${MAX_COUNT}` }, 400)
      }
      const period = body?.period
      if (!PERIODS.includes(period)) {
        return json({ error: `period must be one of ${PERIODS.join(', ')}` }, 400)
      }
      const kickoff = body?.kickoff === 'K' || body?.kickoff === 'R' ? body.kickoff : null

      // A coach reads their own board — Karl's call on 15 Sep, revising the
      // original split where outlook was the coordinator's alone. Sent from the
      // team A point of view, as it is stored, so the client does the flipping
      // for a coach sitting on side B.
      let outlook = board.outlook
      if (body?.outlook !== undefined) {
        if (!OUTLOOKS.includes(body.outlook)) {
          return json({ error: `outlook must be one of ${OUTLOOKS.join(', ')}` }, 400)
        }
        outlook = body.outlook
      }

      // Full time settles it from the score regardless, exactly as it does for
      // the coordinator — and leaving FT hands the reading back, so a mistake
      // can be undone rather than needing someone else to fix it.
      if (period === 'FT') outlook = aScore > bScore ? 1 : aScore < bScore ? -1 : 0

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE board
              SET a_score = ?, a_injuries = ?, b_score = ?, b_injuries = ?,
                  period = ?, kickoff = ?, outlook = ?
            WHERE id = ?`,
        ).bind(aScore, aInjuries, bScore, bInjuries, period, kickoff, outlook, board.id),
        env.DB.prepare("UPDATE round SET updated_at = datetime('now') WHERE id = ?").bind(
          active.round.id,
        ),
      ])

      return json(await readState(env.DB, view))
    }

    // ---- POST /api/activate : switch tournament and/or round ----
    if (path === '/api/activate') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)
      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }

      const active = await resolveActive(env.DB, view.id)
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
      // Answer with the tournament just switched to, not the one the request
      // arrived on, or the selector appears to ignore the change.
      return json(await readState(env.DB, { ...view, id: tournamentId }))
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
      return json(await readState(env.DB, view))
    }

    // ---- POST /api/tag : mark a board Swing / Anchor / Bonus ----
    if (path === '/api/tag') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)
      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }

      const active = await resolveActive(env.DB, view.id)
      if (!active) return json({ error: 'No round is set up' }, 404)

      const boardId = Number(body?.boardId)
      if (!Number.isInteger(boardId)) return json({ error: 'boardId must be a number' }, 400)

      const board = await env.DB.prepare('SELECT * FROM board WHERE round_id = ? AND board_no = ?')
        .bind(active.round.id, boardId)
        .first<BoardRow>()
      if (!board) return json({ error: `No board ${boardId} in this round` }, 404)

      // Unlocking is its own action: it reopens the board without touching the
      // tag or the outlook it seeded.
      if (body?.locked === false) {
        await env.DB.prepare('UPDATE board SET tag_locked = 0 WHERE id = ?').bind(board.id).run()
        return json(await readState(env.DB, view))
      }

      const tag = body?.tag
      if (tag === null) {
        await env.DB.prepare('UPDATE board SET tag = NULL, tag_locked = 0 WHERE id = ?')
          .bind(board.id)
          .run()
        return json(await readState(env.DB, view))
      }

      if (typeof tag !== 'string' || !TAGS.includes(tag)) {
        return json({ error: `tag must be one of ${TAGS.join(', ')}, or null` }, 400)
      }
      // Full time has already settled the outlook; a tag must not undo that.
      const outlook = board.period === 'FT' ? board.outlook : TAG_OUTLOOK[tag]
      await env.DB.prepare('UPDATE board SET tag = ?, tag_locked = 1, outlook = ? WHERE id = ?')
        .bind(tag, outlook, board.id)
        .run()
      return json(await readState(env.DB, view))
    }

    // ---- POST /api/provisional : mark the line-up provisional, or confirmed ----
    if (path === '/api/provisional') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)
      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }
      if (typeof body?.provisional !== 'boolean') {
        return json({ error: 'provisional must be a boolean' }, 400)
      }
      const active = await resolveActive(env.DB, view.id)
      if (!active) return json({ error: 'No round is set up' }, 404)
      await env.DB.prepare('UPDATE tournament SET rosters_provisional = ? WHERE id = ?')
        .bind(body.provisional ? 1 : 0, active.tournament.id)
        .run()
      return json(await readState(env.DB, view))
    }

    // ---- POST /api/settings : how the hall reads its boards ----
    if (path === '/api/settings') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)
      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }
      const wantsMode = body?.casualtyMode !== undefined
      const wantsOpen = body?.openCoordinator !== undefined
      if (!wantsMode && !wantsOpen) {
        return json({ error: 'Nothing to set' }, 400)
      }
      if (wantsMode && body.casualtyMode !== 'removals' && body.casualtyMode !== 'players') {
        return json({ error: "casualtyMode must be 'removals' or 'players'" }, 400)
      }
      if (wantsOpen && typeof body.openCoordinator !== 'boolean') {
        return json({ error: 'openCoordinator must be a boolean' }, 400)
      }
      const active = await resolveActive(env.DB, view.id)
      if (!active) return json({ error: 'No round is set up' }, 404)

      const statements: D1PreparedStatement[] = []

      // Changing the reading clears the round's casualties, which the app warns
      // about and makes the coordinator confirm. The numbers already entered
      // were counted under the other heading, and a 2 that silently becomes a 9
      // is worse than a 0 somebody has to re-enter. A no-op change clears
      // nothing, so a stray double-tap on the toggle cannot cost a round.
      if (wantsMode && body.casualtyMode !== active.casualtyMode) {
        statements.push(
          env.DB
            .prepare('UPDATE board SET a_injuries = 0, b_injuries = 0 WHERE round_id = ?')
            .bind(active.round.id),
          env.DB
            .prepare('UPDATE tournament SET casualty_mode = ? WHERE id = ?')
            .bind(body.casualtyMode, active.tournament.id),
        )
      }
      if (wantsOpen) {
        statements.push(
          env.DB
            .prepare('UPDATE tournament SET open_coordinator = ? WHERE id = ?')
            .bind(body.openCoordinator ? 1 : 0, active.tournament.id),
        )
      }
      if (statements.length > 0) await env.DB.batch(statements)
      return json(await readState(env.DB, view))
    }

    // ---- /api/admin : the owner's panel — roles, and which events are live ----
    //
    // Gated above by `viewer.isOwner` for both read and write, because who may
    // coordinate is decided here and a role must not be able to reach the place
    // that grants it.
    if (path === '/api/admin') {
      if (request.method === 'GET') return json(await adminState(env.DB))
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)

      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }

      // --- set somebody's role ---
      if (body?.action === 'role') {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        if (!email) return json({ error: 'email is required' }, 400)
        if (body.isAdmin !== true && body.isAdmin !== false) {
          return json({ error: 'isAdmin must be a boolean' }, 400)
        }
        const row = await env.DB.prepare('SELECT email, is_owner FROM coach_identity WHERE email = ?')
          .bind(email)
          .first<{ email: string; is_owner: number }>()
        if (!row) return json({ error: `${email} is not on the roster` }, 404)
        await env.DB.prepare('UPDATE coach_identity SET is_admin = ? WHERE email = ?')
          .bind(body.isAdmin ? 1 : 0, email)
          .run()
        return json(await adminState(env.DB))
      }

      // --- make a tournament live, or stand it down ---
      if (body?.action === 'active') {
        const id = Number(body.tournamentId)
        if (!Number.isInteger(id)) return json({ error: 'tournamentId must be a number' }, 400)
        if (body.isActive !== true && body.isActive !== false) {
          return json({ error: 'isActive must be a boolean' }, 400)
        }

        if (body.isActive) {
          // A coach may be in any number of tournaments but live in only one:
          // being locked to two at once has no meaning, and the lock is what
          // keeps a playing coach on their own boards. Refuse with the names,
          // because "conflict" without the who is useless standing in a hall.
          const clash = await env.DB
            .prepare(
              `SELECT DISTINCT t.name AS tournament, b2.a_naf_name AS name
                 FROM board b1
                 JOIN round r1 ON b1.round_id = r1.id
                 JOIN board b2 ON (b2.a_naf_number = b1.a_naf_number OR b2.a_naf_number = b1.b_naf_number
                                OR b2.b_naf_number = b1.a_naf_number OR b2.b_naf_number = b1.b_naf_number)
                 JOIN round r2 ON b2.round_id = r2.id
                 JOIN tournament t ON r2.tournament_id = t.id
                WHERE r1.tournament_id = ? AND t.id != ? AND t.is_active = 1
                LIMIT 5`,
            )
            .bind(id, id)
            .all<{ tournament: string; name: string }>()
          const clashes = clash.results ?? []
          if (clashes.length > 0) {
            const where = [...new Set(clashes.map((c) => c.tournament))].join(', ')
            return json(
              {
                error:
                  `Some of these coaches are already live in ${where}. ` +
                  'A coach can only be in one live tournament at a time — stand that one down first.',
              },
              409,
            )
          }
        }

        await env.DB.prepare('UPDATE tournament SET is_active = ? WHERE id = ?')
          .bind(body.isActive ? 1 : 0, id)
          .run()
        return json(await adminState(env.DB))
      }

      return json({ error: 'Unknown action' }, 400)
    }

    // ---- GET /api/scout/ping : is the Scout engine answering at all? ----
    if (path === '/api/scout/ping') {
      if (request.method !== 'GET') return json({ error: `${request.method} not allowed` }, 405)
      return json(await pingEngine(env.SCOUT_API_URL))
    }

    // ---- POST /api/scout/refresh : pull scouting from the NAF Scout engine ----
    if (path === '/api/scout/refresh') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)
      const active = await resolveActive(env.DB, view.id)
      if (!active) return json({ error: 'No round is set up' }, 404)

      const boards = await env.DB.prepare('SELECT * FROM board WHERE round_id = ? ORDER BY board_no')
        .bind(active.round.id)
        .all<BoardRow>()
      const rows = boards.results ?? []
      if (rows.length === 0) return json({ error: 'This round has no boards to scout' }, 400)

      const matchups = await loadMatchups(env)

      let result
      try {
        result = await pullScouting(
          rows.map((row) => ({
            id: row.board_no,
            a: {
              nafName: row.a_naf_name,
              nafNumber: row.a_naf_number,
              race: row.a_race,
              vacant: row.a_vacant === 1,
            },
            b: {
              nafName: row.b_naf_name,
              nafNumber: row.b_naf_number,
              race: row.b_race,
              vacant: row.b_vacant === 1,
            },
          })),
          {
            base: env.SCOUT_API_URL,
            scope: url.searchParams.get('scope') ?? undefined,
            resolveByName: url.searchParams.get('resolve') === 'name',
            matchups: matchups.payload?.table,
          },
        )
      } catch (cause) {
        // Only a failure that took the whole pull down lands here — a single
        // coach failing is reported as a skip, not an error.
        return json({ error: `Scout engine unreachable: ${String(cause)}` }, 502)
      }

      // Nothing is stored unless at least one coach came back. A pull that
      // reached nobody must not wipe the scouting already on screen.
      if (result.scouted === 0) {
        return json(
          {
            error: 'Nothing could be scouted, so the existing scouting was left alone',
            skipped: result.skipped,
          },
          502,
        )
      }

      await env.DB.prepare(
        `INSERT INTO scout (round_id, payload, generated_at, updated_at)
         VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(round_id) DO UPDATE
              SET payload = excluded.payload,
                  generated_at = excluded.generated_at,
                  updated_at = datetime('now')`,
      )
        .bind(active.round.id, JSON.stringify(result.round), result.round.generatedAt)
        .run()

      const state = await readState(env.DB, view)
      return json({
        ...state,
        refresh: {
          scouted: result.scouted,
          skipped: result.skipped,
          matchups: {
            source: matchups.payload?.source ?? null,
            fetchedAt: matchups.payload?.fetchedAt ?? null,
            stale: matchups.stale,
            error: matchups.error,
          },
        },
      })
    }

    // ---- PUT /api/scout : NAF Scout delivers a round's scouting ----
    if (path === '/api/scout') {
      const active = await resolveActive(env.DB, view.id)
      if (!active) return json({ error: 'No round is set up' }, 404)

      if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM scout WHERE round_id = ?').bind(active.round.id).run()
        return json(await readState(env.DB, view))
      }

      if (request.method !== 'PUT') return json({ error: `${request.method} not allowed` }, 405)

      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }
      if (typeof body !== 'object' || body === null || !Array.isArray(body.boards)) {
        return json({ error: 'Expected a ScoutRound: { generatedAt, boards: [...] }' }, 400)
      }
      // Deliberately shallow: every figure inside is optional by contract, and
      // the view already renders a missing one as a dash. Rejecting on detail
      // would make Scout's job harder for no gain.
      for (const b of body.boards) {
        if (!Number.isInteger(b?.boardId)) {
          return json({ error: 'Each board needs an integer boardId' }, 400)
        }
      }

      await env.DB.prepare(
        `INSERT INTO scout (round_id, payload, generated_at, updated_at)
         VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(round_id) DO UPDATE
              SET payload = excluded.payload,
                  generated_at = excluded.generated_at,
                  updated_at = datetime('now')`,
      )
        .bind(
          active.round.id,
          JSON.stringify(body),
          typeof body.generatedAt === 'string' ? body.generatedAt : null,
        )
        .run()

      return json(await readState(env.DB, view))
    }

    // ---- POST /api/sync : pull live match state from Tourplay ----
    if (path === '/api/sync') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)

      const active = await resolveActive(env.DB, view.id)
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
        return json({ ...(await readState(env.DB, view)), synced: false, reason: 'too soon' })
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
          ...(await readState(env.DB, view)),
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

      return json({ ...(await readState(env.DB, view)), synced: true, matched: statements.length - 1 })
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

      // Who these coaches are on NAF, rather than what they called themselves on
      // Tourplay. Two hops — Tourplay player id to NAF number from the entry
      // list, NAF number to handle from the Scout engine — and both fail soft:
      // a coach with no NAF number, or an engine that is down, leaves the
      // Tourplay name in place rather than blanking the board.
      //
      // The NAF number is worth storing for its own sake. Nothing was writing
      // one before, which is why an imported round could not tell which board
      // belonged to the coach signing in.
      const nafByPlayer = await fetchNafNumbers(slug)
      const nafNumberOf = (sideOf: { playerId: string | null }) =>
        sideOf.playerId ? nafByPlayer.get(String(sideOf.playerId)) ?? null : null
      const handles = await nafHandles(
        matches.flatMap((m) => [nafNumberOf(m.local), nafNumberOf(m.visitor)]),
        env.SCOUT_API_URL,
      )
      const displayName = (sideOf: { coach: string; playerId: string | null }) => {
        const naf = nafNumberOf(sideOf)
        return chooseName(sideOf.coach || 'Unknown', naf == null ? null : handles.get(naf))
      }

      const statements: D1PreparedStatement[] = [
        env.DB.prepare('DELETE FROM board WHERE round_id = ?').bind(roundId),
      ]
      matches.forEach((m, index) => {
        statements.push(
          env.DB.prepare(
            `INSERT INTO board (round_id, board_no, a_naf_name, a_naf_number, a_race, a_score,
                                a_injuries, b_naf_name, b_naf_number, b_race, b_score,
                                b_injuries, period, outlook, tourplay_match_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '1', 0, ?)`,
          ).bind(
            roundId,
            index + 1,
            displayName(m.local),
            nafNumberOf(m.local),
            m.local.race || '',
            m.local.score,
            m.local.injuries,
            displayName(m.visitor),
            nafNumberOf(m.visitor),
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

      return json({ ...(await readState(env.DB, view)), linked: true, imported: matches.length })
    }

    // ---- POST /api/board-order : move a board along the row ----
    if (path === '/api/board-order') {
      if (request.method !== 'POST') return json({ error: `${request.method} not allowed` }, 405)
      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Body is not valid JSON' }, 400)
      }

      const active = await resolveActive(env.DB, view.id)
      if (!active) return json({ error: 'No round is set up' }, 404)

      const boardId = Number(body?.boardId)
      const direction = Number(body?.direction)
      if (!Number.isInteger(boardId)) return json({ error: 'boardId must be a number' }, 400)
      if (direction !== 1 && direction !== -1) {
        return json({ error: 'direction must be 1 (right) or -1 (left)' }, 400)
      }

      const listed = await env.DB.prepare('SELECT * FROM board WHERE round_id = ? ORDER BY board_no')
        .bind(active.round.id)
        .all<BoardRow>()
      const rows = listed.results ?? []
      const index = rows.findIndex((row) => row.board_no === boardId)
      if (index < 0) return json({ error: `No board ${boardId} in this round` }, 404)

      const swapWith = index + direction
      if (swapWith < 0 || swapWith >= rows.length) {
        return json({ error: `Board ${boardId} is already at the end of the row` }, 400)
      }

      const moving = rows[index]
      const other = rows[swapWith]

      // Three steps rather than two: UNIQUE (round_id, board_no) would reject a
      // straight swap the moment both rows briefly held the same number.
      const statements = [
        env.DB.prepare('UPDATE board SET board_no = ? WHERE id = ?').bind(PARKING_BOARD_NO, moving.id),
        env.DB.prepare('UPDATE board SET board_no = ? WHERE id = ?').bind(moving.board_no, other.id),
        env.DB.prepare('UPDATE board SET board_no = ? WHERE id = ?').bind(other.board_no, moving.id),
      ]

      // Scouting is keyed by board number, so it has to travel with the pairing.
      // Leaving it behind would put one coach's record under another's name.
      const scoutRow = await env.DB.prepare('SELECT payload FROM scout WHERE round_id = ?')
        .bind(active.round.id)
        .first<{ payload: string }>()
      if (scoutRow) {
        const payload = safeParse(scoutRow.payload) as any
        if (payload && Array.isArray(payload.boards)) {
          for (const entry of payload.boards) {
            if (entry?.boardId === moving.board_no) entry.boardId = other.board_no
            else if (entry?.boardId === other.board_no) entry.boardId = moving.board_no
          }
          statements.push(
            env.DB.prepare('UPDATE scout SET payload = ? WHERE round_id = ?').bind(
              JSON.stringify(payload),
              active.round.id,
            ),
          )
        }
      }

      await env.DB.batch(statements)
      return json(await readState(env.DB, view))
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
      const active = await resolveActive(env.DB, view.id)
      if (!active) return json({ error: 'No round is set up' }, 404)
      await env.DB.prepare('UPDATE tournament SET sync_enabled = ? WHERE id = ?')
        .bind(body.enabled ? 1 : 0, active.tournament.id)
        .run()
      return json(await readState(env.DB, view))
    }

    if (path !== '/api/round') {
      return json({ error: 'Not found' }, 404)
    }

    if (request.method === 'GET') {
      const state = await readState(env.DB, view)
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

      const active = await resolveActive(env.DB, view.id)
      if (!active) return json({ error: 'No round is set up' }, 404)

      // One batch, so a save either lands whole or not at all — a half-written
      // round on a coordinator's screen would be worse than a failed save.
      const statements = result.boards.map((b) =>
        env.DB.prepare(
          `UPDATE board
             SET a_score = ?, a_injuries = ?, b_score = ?, b_injuries = ?,
                 period = ?, kickoff = ?, outlook = ?
           WHERE round_id = ? AND board_no = ?`,
        ).bind(
          b.aScore,
          b.aInjuries,
          b.bScore,
          b.bInjuries,
          b.period,
          b.kickoff,
          b.outlook,
          active.round.id,
          b.id,
        ),
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

      return json(await readState(env.DB, view))
    }

    return json({ error: `${request.method} not allowed` }, 405)
  },
} satisfies ExportedHandler<Env>

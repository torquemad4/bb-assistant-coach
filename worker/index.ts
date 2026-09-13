/// <reference types="@cloudflare/workers-types" />

/**
 * API for the round coordinator.
 *
 * Only `/api/*` reaches this script — `run_worker_first` in wrangler.jsonc routes
 * those paths here and lets every other request fall through to the static
 * assets, which use SPA handling.
 *
 * Deliberately, PUT writes only the *match state* (score, casualties, half,
 * outlook). The roster lives in the same tables but is never written from the
 * client, so editing a coach directly in D1 cannot be silently reverted by a
 * tablet that still has the old line-up on screen.
 */

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
}

/** The only outlook values the scale allows. */
const OUTLOOKS = [-1, -0.5, 0, 0.5, 1]

/** Guards against a runaway stepper writing an absurd score. */
const MAX_COUNT = 99

interface RoundRow {
  round_number: number
  total_rounds: number
  team_a_name: string
  team_a_country: string
  team_b_name: string
  team_b_country: string
  updated_at: string
}

interface BoardRow {
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

async function readRound(db: D1Database) {
  const [meta, boards] = await db.batch<RoundRow | BoardRow>([
    db.prepare('SELECT * FROM round WHERE id = 1'),
    db.prepare('SELECT * FROM board ORDER BY board_no'),
  ])

  const round = (meta.results as RoundRow[])[0]
  if (!round) return null

  return {
    roundNumber: round.round_number,
    totalRounds: round.total_rounds,
    teamA: { name: round.team_a_name, country: round.team_a_country },
    teamB: { name: round.team_b_name, country: round.team_b_country },
    boards: (boards.results as BoardRow[]).map(boardFromRow),
    updatedAt: round.updated_at,
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

/**
 * Validates the save payload. Returns an error string rather than throwing, so
 * the client gets a usable message instead of a 500.
 */
function validate(payload: unknown): { boards: ValidBoard[] } | { error: string } {
  if (typeof payload !== 'object' || payload === null) return { error: 'Body must be an object' }
  const boards = (payload as { boards?: unknown }).boards
  if (!Array.isArray(boards) || boards.length === 0) return { error: 'boards must be a non-empty array' }
  if (boards.length > 8) return { error: 'At most 8 boards' }

  const seen = new Set<number>()
  const valid: ValidBoard[] = []

  for (const raw of boards) {
    if (typeof raw !== 'object' || raw === null) return { error: 'Each board must be an object' }
    const b = raw as Record<string, unknown>

    const id = b.id
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > 8) {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname !== '/api/round') {
      return json({ error: 'Not found' }, 404)
    }

    if (request.method === 'GET') {
      const round = await readRound(env.DB)
      if (!round) return json({ error: 'No round has been set up' }, 404)
      return json(round)
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

      // One batch, so a save either lands whole or not at all — a half-written
      // round on a coordinator's screen would be worse than a failed save.
      const statements = result.boards.map((b) =>
        env.DB.prepare(
          `UPDATE board
             SET a_score = ?, a_injuries = ?, b_score = ?, b_injuries = ?, half = ?, outlook = ?
           WHERE board_no = ?`,
        ).bind(b.aScore, b.aInjuries, b.bScore, b.bInjuries, b.half, b.outlook, b.id),
      )
      statements.push(
        env.DB.prepare("UPDATE round SET updated_at = datetime('now') WHERE id = 1"),
      )

      try {
        await env.DB.batch(statements)
      } catch (cause) {
        // Most likely a CHECK constraint the validation above should have caught.
        return json({ error: `Save rejected by the database: ${String(cause)}` }, 500)
      }

      const round = await readRound(env.DB)
      return json(round)
    }

    return json({ error: `${request.method} not allowed` }, 405)
  },
} satisfies ExportedHandler<Env>

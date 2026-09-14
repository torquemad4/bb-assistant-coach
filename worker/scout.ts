/**
 * Pulls scouting from the NAF Eurobowl Scout engine.
 *
 * The engine is a FastAPI service over the official NAF database dump, hosted on
 * Azure App Service and shared with the England BB site. Source lives in
 * `torquemad4/bb-county-tool` (`core/naf_scout/` is the engine, `api/` the
 * wrapper); its own docs are at `{base}/docs`.
 *
 * Called from the Worker rather than the browser on purpose: the service sets
 * `CORS_ORIGINS=https://englandbb.co.uk`, which would block a tablet calling it
 * directly, and CORS binds browsers only. Server-side there is nothing to
 * negotiate.
 *
 * What comes back maps almost exactly onto `src/scout.ts` — see the table in the
 * README. The two figures the engine has no endpoint for yet are the form strip
 * and the racial matchup, so both are left empty and render as em dashes.
 */

import { matchupKey, type MatchupTable } from './matchups'

/**
 * Where the engine lives when the environment does not say otherwise.
 *
 * The full App Service hostname, regional suffix and all. `DEPLOY_AZURE.md` in
 * bb-county-tool talks about `bb-county-app.azurewebsites.net`, but that name
 * does not resolve — taking it from there cost a round of "HTTP 530, error 1016"
 * (Cloudflare for "origin DNS failure"), which reads like a dead service rather
 * than a wrong address. The deployed URL is the one in `DEPLOY_UI.md`.
 */
const DEFAULT_BASE =
  'https://bb-county-app-euebajf9c8bnfqb0.ukwest-01.azurewebsites.net'

/**
 * Peak-ELO threshold for an opponent to count as "established".
 *
 * 200 is the engine's own default and the number the pre-match view labels
 * "vs 200+". Changing it here changes what that label means, so it does not
 * change without the label changing too.
 */
const ESTABLISHED_ELO = 200

/**
 * Which rulesets the figures are drawn from. The engine offers `2025` (BB2025
 * only), `competitive` (2020 + 2025) and `all` (adds Classic).
 *
 * `competitive` is the default because BB2025 alone is still thin: at a
 * tournament a record of 3/0/1 tells you less than one of 40/10/20 from a
 * ruleset generation away.
 */
const DEFAULT_SCOPE = 'competitive'

/** The engine boots by downloading the NAF pack, so a cold hit is slow. */
const REQUEST_TIMEOUT_MS = 45_000

/**
 * Race names the app spells differently from the engine. Everything else in
 * `RACES` matches its `RACE_IDS` exactly, and an unknown name is a 400 from the
 * engine rather than a wrong answer.
 */
const RACE_ALIASES: Record<string, string> = {
  'Underworld Denizens': 'Underworld Denizen',
}

function engineRace(race: string): string {
  return RACE_ALIASES[race] ?? race
}

/** One win/draw/loss tally as the engine reports it. */
interface EngineTally {
  games: number
  wins: number
  draws: number
  losses: number
  winrate: number
  no_loss_rate: number
}

interface EngineReport {
  coach_id: number
  coach_name: string
  max_elo: number | null
  race_elo?: number | null
  with_race?: EngineTally
  with_race_vs_established?: EngineTally
  vs_races?: Record<string, { overall: EngineTally; vs_established: EngineTally }>
}

/** The app's own record shape — kept structurally identical to `ScoutRecord`. */
interface ScoutRecord {
  w: number
  d: number
  l: number
  winRate: number | null
}

interface ScoutCoach {
  nafNumber: number | null
  ratingWithRace: number | null
  ratingMax: number | null
  ratingMaxRace: string | null
  withRace: ScoutRecord | null
  withRaceVs200: ScoutRecord | null
  vsOppRace: ScoutRecord | null
  vsOppRaceVs200: ScoutRecord | null
  form: never[]
}

/** A side of a board, as much of it as scouting needs. */
export interface ScoutSide {
  nafName: string
  nafNumber: number | null
  race: string
  vacant?: boolean
}

export interface ScoutBoardInput {
  id: number
  a: ScoutSide
  b: ScoutSide
}

/** Why a coach could not be scouted, in words the coordinator can act on. */
export interface ScoutSkip {
  boardId: number
  side: 'a' | 'b'
  coach: string
  reason: string
}

export interface ScoutPullResult {
  round: {
    generatedAt: string
    vs200Basis: string
    dataDate: string | null
    boards: { boardId: number; a: ScoutCoach | null; b: ScoutCoach | null; matchup: unknown }[]
  }
  scouted: number
  skipped: ScoutSkip[]
}

export interface ScoutOptions {
  base?: string
  scope?: string
  /** Eurobowl race-versus-race table, when one could be loaded. */
  matchups?: MatchupTable
  /**
   * Look a missing NAF number up from the coach's NAF name. Off by default: a
   * name match that picks the wrong coach attaches someone else's whole record
   * to a player, which is worse than showing nothing. Only an exact,
   * unambiguous match is ever accepted, even when this is on.
   */
  resolveByName?: boolean
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS)
}

/**
 * Turns a failed response into something a coordinator can act on.
 *
 * A bare status number reads like a bug in this app when it is usually the host
 * in front of the engine — App Service answering while the container is down,
 * say. So: the code, what layer it came from, and whatever the body said.
 */
async function describeFailure(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')

  // FastAPI puts the real reason in { detail }; the platform sends HTML.
  let detail = ''
  try {
    const body = JSON.parse(text) as { detail?: string }
    if (body?.detail) detail = String(body.detail)
  } catch {
    // Not JSON, so it did not come from the engine — an HTML error page from
    // Azure or whatever sits in front of it. Collapse it to one readable line.
    detail = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
  }

  // Runtimes hand back "unknown" for a status they have no name for, which
  // reads as a second, mysterious fault rather than a missing label.
  const named = response.statusText && response.statusText.toLowerCase() !== 'unknown'
  const status = `HTTP ${response.status}${named ? ` ${response.statusText}` : ''}`
  const engine = response.status < 500 && detail && !text.startsWith('<')
  return engine ? `${status} from the engine: ${detail}` : detail ? `${status} — ${detail}` : status
}

async function getJson(url: string): Promise<any> {
  let response: Response
  try {
    response = await fetch(url, { signal: timeoutSignal(), headers: { accept: 'application/json' } })
  } catch (cause) {
    // Never reached the service at all: DNS, TLS, refused, or the timeout.
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`could not reach the engine (${reason})`)
  }
  if (!response.ok) throw new Error(await describeFailure(response))
  return response.json()
}

/**
 * Asks the engine whether it is up, without pulling anything.
 *
 * Worth its own endpoint: when every coach fails with the same message, the
 * question is not about the coaches, and a coordinator should not have to run a
 * whole pull to find out whether the service is even answering.
 */
export async function pingEngine(base?: string): Promise<{
  base: string
  ok: boolean
  health: string
  version: string | null
}> {
  const url = (base ?? DEFAULT_BASE).replace(/\/+$/, '')
  let ok = false
  let health: string
  try {
    const response = await fetch(`${url}/health`, {
      signal: timeoutSignal(),
      headers: { accept: 'application/json' },
    })
    ok = response.ok
    health = response.ok ? 'answering' : await describeFailure(response)
  } catch (cause) {
    health = `could not reach it (${cause instanceof Error ? cause.message : String(cause)})`
  }

  let version: string | null = null
  if (ok) {
    try {
      const payload = await getJson(`${url}/version`)
      version = JSON.stringify(payload).slice(0, 200)
    } catch {
      /* the health line is the answer that matters */
    }
  }

  return { base: url, ok, health, version }
}

/**
 * A tally as the app records it.
 *
 * A record of no games keeps its zeroes but loses its rate: 0/0/0 is a true
 * statement about a coach who has never played the matchup, while "0.0%" reads
 * as having played and lost.
 */
function toRecord(tally: EngineTally | undefined): ScoutRecord | null {
  if (!tally) return null
  return {
    w: tally.wins,
    d: tally.draws,
    l: tally.losses,
    winRate: tally.games > 0 ? tally.winrate : null,
  }
}

/**
 * Resolves a coach's NAF number from their name, and only when it is beyond
 * doubt: the engine's search is a substring match, so "Pete" hits every Peter.
 * One exact, case-insensitive full-name match or nothing.
 */
async function resolveCoachId(base: string, nafName: string): Promise<number | null> {
  const payload = await getJson(`${base}/coaches/search?q=${encodeURIComponent(nafName)}&limit=100`)
  const wanted = nafName.trim().toLowerCase()
  const exact = (payload.coaches ?? []).filter(
    (c: { id: number; name: string }) => String(c.name).trim().toLowerCase() === wanted,
  )
  return exact.length === 1 ? exact[0].id : null
}

async function scoutCoach(
  base: string,
  scope: string,
  nafNumber: number,
  race: string,
  opponentRace: string,
): Promise<ScoutCoach> {
  const oppParam = engineRace(opponentRace)
  const query = new URLSearchParams({
    race: engineRace(race),
    opponent_race: oppParam,
    scope,
    established_elo: String(ESTABLISHED_ELO),
  })

  // Two calls: the report carries every figure except which race the coach's
  // best rating belongs to, which only the per-race peak list names.
  const [report, peak] = await Promise.all([
    getJson(`${base}/coaches/${nafNumber}/report?${query}`) as Promise<EngineReport>,
    getJson(`${base}/coaches/${nafNumber}/peak-elo-by-race`) as Promise<{
      races: { race: string; elo: number }[]
    }>,
  ])

  // The peak list comes back highest first, so the head of it is the best race.
  const best = (peak.races ?? [])[0] ?? null
  const vs = report.vs_races?.[oppParam]

  return {
    nafNumber,
    ratingWithRace: report.race_elo ?? null,
    ratingMax: report.max_elo ?? null,
    ratingMaxRace: best?.race ?? null,
    withRace: toRecord(report.with_race),
    withRaceVs200: toRecord(report.with_race_vs_established),
    vsOppRace: toRecord(vs?.overall),
    vsOppRaceVs200: toRecord(vs?.vs_established),
    // No last-N-games endpoint on the engine yet, so the strip stays empty and
    // the view draws "No recent games" rather than inventing a shape.
    form: [],
  }
}

/** The date of the NAF dump the engine is serving, when it will say. */
async function dataDate(base: string): Promise<string | null> {
  try {
    const payload = await getJson(`${base}/version`)
    return payload?.data_date ?? payload?.dump_date ?? payload?.local_dump_date ?? null
  } catch {
    // Never fail a whole pull over the provenance line.
    return null
  }
}

/**
 * Scouts every seat on every board.
 *
 * One coach failing never fails the pull: their figures come back null, the
 * view shows em dashes, and the reason is reported so it can be fixed. A
 * tournament needs seven of eight boards scouted more than it needs an error.
 */
export async function pullScouting(
  boards: ScoutBoardInput[],
  options: ScoutOptions = {},
): Promise<ScoutPullResult> {
  const base = (options.base ?? DEFAULT_BASE).replace(/\/+$/, '')
  const scope = options.scope ?? DEFAULT_SCOPE

  const skipped: ScoutSkip[] = []
  let scouted = 0

  const one = async (
    board: ScoutBoardInput,
    side: 'a' | 'b',
  ): Promise<ScoutCoach | null> => {
    const self = board[side]
    const other = side === 'a' ? board.b : board.a

    if (self.vacant) return null
    if (other.vacant) {
      skipped.push({
        boardId: board.id,
        side,
        coach: self.nafName,
        reason: 'the other seat on this board is vacant, so there is no opponent race to scout against',
      })
      return null
    }

    let nafNumber = self.nafNumber
    if (nafNumber == null) {
      if (!options.resolveByName) {
        skipped.push({
          boardId: board.id,
          side,
          coach: self.nafName,
          reason: 'no NAF number on the roster',
        })
        return null
      }
      try {
        nafNumber = await resolveCoachId(base, self.nafName)
      } catch (cause) {
        skipped.push({
          boardId: board.id,
          side,
          coach: self.nafName,
          reason: `name lookup failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        })
        return null
      }
      if (nafNumber == null) {
        skipped.push({
          boardId: board.id,
          side,
          coach: self.nafName,
          reason: 'no NAF number, and the name matches either nothing or more than one coach',
        })
        return null
      }
    }

    try {
      const coach = await scoutCoach(base, scope, nafNumber, self.race, other.race)
      scouted += 1
      return coach
    } catch (cause) {
      skipped.push({
        boardId: board.id,
        side,
        coach: self.nafName,
        reason: cause instanceof Error ? cause.message : String(cause),
      })
      return null
    }
  }

  // Board by board rather than all at once: eight boards is 32 calls, and a
  // Worker's subrequest budget is not generous enough to be careless with.
  const scoutBoards: ScoutPullResult['round']['boards'] = []
  for (const board of boards) {
    const [a, b] = await Promise.all([one(board, 'a'), one(board, 'b')])
    // Always from the home side's point of view, which is team A — England at
    // the Euros. The NAF Scout engine has no global race matrix of its own; the
    // Eurobowl-tagged one comes from `matchups.ts`.
    const matchup = options.matchups?.[matchupKey(board.a.race, board.b.race)] ?? null

    scoutBoards.push({ boardId: board.id, a, b, matchup })
  }

  return {
    round: {
      generatedAt: new Date().toISOString(),
      vs200Basis:
        `opponent's PEAK career Regular ELO ≥ ${ESTABLISHED_ELO} — ` +
        'coaches who have at some point been rated that highly, not coaches rated ' +
        `that highly on the day. Scope: ${scope}.`,
      dataDate: await dataDate(base),
      boards: scoutBoards,
    },
    scouted,
    skipped,
  }
}

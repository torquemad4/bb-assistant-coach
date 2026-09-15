import {
  OUTLOOK_VALUES,
  PERIODS,
  outlookForResult,
  resultOf,
  type Board,
  type Kickoff,
  type Outlook,
  type Period,
  type Round,
} from './types'

/** The mutable half of a board — the only fields a save is allowed to write. */
export interface SaveBoard {
  id: number
  aScore: number
  aInjuries: number
  bScore: number
  bInjuries: number
  period: Period
  kickoff: Kickoff
  outlook: Outlook
}

export function toSaveBoard(board: Board): SaveBoard {
  return {
    id: board.id,
    aScore: board.a.score,
    aInjuries: board.a.injuries,
    bScore: board.b.score,
    bInjuries: board.b.injuries,
    period: board.period,
    kickoff: board.kickoff,
    // A finished match is no longer a judgement call; send the result's value
    // so the client and the server agree on what was saved.
    outlook: board.period === 'FT' ? outlookForResult(resultOf(board)) : board.outlook,
  }
}

/**
 * The API is ours, but the response still gets checked: a stray value from a
 * hand-edited database should degrade to a sane default rather than render
 * `NaN` across the dashboard mid-round.
 */
function asPeriod(value: unknown): Period {
  return PERIODS.includes(value as Period) ? (value as Period) : '1'
}

function asKickoff(value: unknown): Kickoff {
  return value === 'K' || value === 'R' ? value : null
}

function asOutlook(value: unknown): Outlook {
  return OUTLOOK_VALUES.includes(value as Outlook) ? (value as Outlook) : 0
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function normalise(payload: any): Round {
  return {
    rostersProvisional: payload.rostersProvisional === true,
    scout: payload.scout ?? null,
    tournaments: payload.tournaments ?? [],
    activeTournamentId: payload.activeTournamentId,
    rounds: payload.rounds ?? [],
    activeRoundId: payload.activeRoundId,
    tourplay: payload.tourplay,
    roundNumber: payload.roundNumber,
    totalRounds: payload.totalRounds,
    // The API sends '' for a team with no flag.
    teamA: { ...payload.teamA, country: payload.teamA?.country || null },
    teamB: { ...payload.teamB, country: payload.teamB?.country || null },
    updatedAt: payload.updatedAt,
    boards: (payload.boards ?? []).map((b: any): Board => ({
      id: b.id,
      tourplayMatchId: b.tourplayMatchId ?? null,
      a: { ...b.a, score: asCount(b.a.score), injuries: asCount(b.a.injuries) },
      b: { ...b.b, score: asCount(b.b.score), injuries: asCount(b.b.injuries) },
      period: asPeriod(b.period),
      kickoff: asKickoff(b.kickoff),
      tag: b.tag ?? null,
      tagLocked: b.tagLocked === true,
      outlook: asOutlook(b.outlook),
    })),
  }
}

/** Reads the error message the Worker sends, falling back to the status line. */
async function errorFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    if (body?.error) return body.error
  } catch {
    /* not JSON — fall through */
  }
  return `${response.status} ${response.statusText}`
}

export async function fetchRound(signal?: AbortSignal): Promise<Round> {
  const response = await fetch('/api/round', { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await errorFrom(response))
  return normalise(await response.json())
}

export async function saveRound(boards: Board[]): Promise<Round> {
  const response = await fetch('/api/round', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ boards: boards.map(toSaveBoard) }),
  })
  if (!response.ok) throw new Error(await errorFrom(response))
  return normalise(await response.json())
}

/** One board as Tourplay would set it up, for the link preview. */
export interface LinkPreviewBoard {
  board: number
  a: { coach: string; race: string }
  b: { coach: string; race: string }
}

export interface LinkPreview {
  preview: true
  slug: string
  tournament: { name: string; country: string | null; initDate: string | null }
  currentRound: number
  truncated: number
  /** Plain English for what confirming would do to existing data. */
  effect: string
  boards: LinkPreviewBoard[]
}

async function post(path: string, body?: unknown): Promise<any> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await errorFrom(response))
  return response.json()
}

export interface SyncResult {
  round: Round
  /** Set when Tourplay is playing a different round from the one on screen. */
  liveRound: number | null
}

/** Pulls live match state. The server ignores calls that come too close together. */
export async function syncNow(): Promise<SyncResult> {
  const payload = await post('/api/sync')
  return {
    round: normalise(payload),
    liveRound: payload.reason === 'viewing an earlier round' ? payload.liveRound : null,
  }
}

/** Without `confirm`, returns what the import would do rather than doing it. */
export async function linkTournament(slug: string, confirm = false): Promise<Round | LinkPreview> {
  const payload = await post('/api/link', { slug, confirm })
  return payload.preview ? (payload as LinkPreview) : normalise(payload)
}

export async function setSyncMode(enabled: boolean): Promise<Round> {
  return normalise(await post('/api/sync-mode', { enabled }))
}

/** Switches which tournament and round everyone is looking at. */
export async function activate(tournamentId?: number, roundId?: number): Promise<Round> {
  return normalise(await post('/api/activate', { tournamentId, roundId }))
}

/** Creates an empty tournament with a single round, and switches to it. */
export async function createTournament(name: string): Promise<Round> {
  return normalise(await post('/api/tournaments', { name }))
}

/** Who Cloudflare Access says this browser belongs to. */
export interface Identity {
  state: 'local' | 'verified' | 'rejected'
  email: string | null
  name: string | null
  nafNumber: number | null
  isAdmin: boolean
  board: { id: number; side: 'a' | 'b'; opponent: string } | null
  /** False when ACCESS_AUD is unset, which weakens the check — see access.ts. */
  audChecked: boolean
  reason: string | null
}

export async function fetchIdentity(signal?: AbortSignal): Promise<Identity> {
  const response = await fetch('/api/me', { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await errorFrom(response))
  return response.json()
}

/** The match state a coach may report for their own board. */
export interface MyBoardEntry {
  aScore: number
  aInjuries: number
  bScore: number
  bInjuries: number
  period: Period
  kickoff: Kickoff
}

/**
 * Reports a coach's own board. Deliberately carries no board number: the
 * server works it out from the Access identity, so this cannot address anyone
 * else's match.
 */
export async function saveMyBoard(entry: MyBoardEntry): Promise<Round> {
  return normalise(await post('/api/my-board', entry))
}

/** Marks the line-up on screen as provisional, or confirms it. */
export async function setProvisional(provisional: boolean): Promise<Round> {
  return normalise(await post('/api/provisional', { provisional }))
}

export interface EnginePing {
  base: string
  ok: boolean
  health: string
  version: string | null
}

/** Asks whether the Scout engine is answering, without pulling anything. */
export async function pingScoutEngine(): Promise<EnginePing> {
  const response = await fetch('/api/scout/ping', { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await errorFrom(response))
  return response.json()
}

/** One seat the pull could not scout, and why. */
export interface ScoutSkip {
  boardId: number
  side: 'a' | 'b'
  coach: string
  reason: string
}

/** How the Eurobowl race matrix fared on the last pull. */
export interface MatchupReport {
  source: string | null
  fetchedAt: string | null
  stale: boolean
  error: string | null
}

export interface ScoutRefresh {
  round: Round
  scouted: number
  skipped: ScoutSkip[]
  matchups: MatchupReport | null
}

/**
 * Has the Worker pull scouting from the NAF Scout engine for the active round.
 *
 * `resolveByName` lets the engine find a coach whose NAF number is missing from
 * the roster, and only accepts an unambiguous exact match — a wrong match would
 * put another coach's whole career under this one's name.
 */
export async function refreshScouting(opts: { resolveByName?: boolean; scope?: string } = {}): Promise<ScoutRefresh> {
  const query = new URLSearchParams()
  if (opts.resolveByName) query.set('resolve', 'name')
  if (opts.scope) query.set('scope', opts.scope)
  const suffix = query.toString() ? `?${query}` : ''

  const response = await fetch(`/api/scout/refresh${suffix}`, {
    method: 'POST',
    headers: { accept: 'application/json' },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    // A failed pull still explains itself per seat, which is the useful half.
    const error = new Error(payload?.error ?? `${response.status} ${response.statusText}`) as Error & {
      skipped?: ScoutSkip[]
    }
    error.skipped = payload?.skipped ?? []
    throw error
  }
  return {
    round: normalise(payload),
    scouted: payload.refresh?.scouted ?? 0,
    skipped: payload.refresh?.skipped ?? [],
    matchups: payload.refresh?.matchups ?? null,
  }
}

/** Tags a board, which locks it and seeds its outlook. */
export async function setBoardTag(boardId: number, tag: string | null): Promise<Round> {
  return normalise(await post('/api/tag', { boardId, tag }))
}

/**
 * Swaps a board with its neighbour, moving the pairing — tag, scores and
 * scouting with it — to the next board number along.
 */
export async function moveBoard(boardId: number, direction: 1 | -1): Promise<Round> {
  return normalise(await post('/api/board-order', { boardId, direction }))
}

/** Reopens a tagged board without changing the tag or the outlook it seeded. */
export async function unlockBoardTag(boardId: number): Promise<Round> {
  return normalise(await post('/api/tag', { boardId, locked: false }))
}

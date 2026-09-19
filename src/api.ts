import {
  OUTLOOK_VALUES,
  PERIODS,
  outlookForResult,
  resultOf,
  type Board,
  type CasualtyMode,
  type Kickoff,
  type Outlook,
  type Period,
  type Round,
} from './types'

/**
 * Which tournament this device is looking at.
 *
 * Per device rather than per hall: two people can be on different tournaments
 * at the same moment, which is the whole point of them being independent. Kept
 * in localStorage so a reload does not bounce a coordinator back, and sent as
 * `?t=` on every call so one value decides both what is read and what is
 * written. The server still has the last word — a coach whose own tournament is
 * live is held to it whatever this says.
 */
const TOURNAMENT_KEY = 'bb-coordinator-tournament'

let chosenTournament: number | null = (() => {
  try {
    const raw = Number(localStorage.getItem(TOURNAMENT_KEY))
    return Number.isInteger(raw) && raw > 0 ? raw : null
  } catch {
    return null
  }
})()

export function currentTournament(): number | null {
  return chosenTournament
}

export function chooseTournament(id: number | null) {
  chosenTournament = id
  try {
    if (id == null) localStorage.removeItem(TOURNAMENT_KEY)
    else localStorage.setItem(TOURNAMENT_KEY, String(id))
  } catch {
    /* a device that will not remember still works for this session */
  }
}

/** Appends the chosen tournament, so every request agrees on which one it means. */
function scoped(path: string): string {
  if (chosenTournament == null) return path
  return `${path}${path.includes('?') ? '&' : '?'}t=${chosenTournament}`
}

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
    // Anything unrecognised reads as removals, the meaning the app had before
    // the setting existed.
    casualtyMode: payload.casualtyMode === 'players' ? 'players' : 'removals',
    dashboardMode: payload.dashboardMode === 'ours' ? 'ours' : 'fixture',
    ourSeats: Array.isArray(payload.ourSeats) ? payload.ourSeats : [],
    idleSquad: Array.isArray(payload.idleSquad) ? payload.idleSquad : [],
    openCoordinator: payload.openCoordinator === true,
    tournamentLocked: payload.tournamentLocked === true,
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
  const response = await fetch(scoped('/api/round'), { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await errorFrom(response))
  return normalise(await response.json())
}

export async function saveRound(boards: Board[]): Promise<Round> {
  const response = await fetch(scoped('/api/round'), {
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
  const response = await fetch(scoped(path), {
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

/** What the owner's Admin panel shows. */
export interface AdminState {
  people: {
    email: string
    nafNumber: number | null
    name: string | null
    isAdmin: boolean
    isOwner: boolean
    addedAt: string | null
  }[]
  tournaments: { id: number; name: string; isActive: boolean; coaches: number }[]
}

export async function fetchAdmin(): Promise<AdminState> {
  const response = await fetch('/api/admin', { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await errorFrom(response))
  return response.json()
}

/** Grants or removes the coordinator role. Owner only, enforced server-side. */
export async function setRole(email: string, isAdmin: boolean): Promise<AdminState> {
  return post('/api/admin', { action: 'role', email, isAdmin })
}

/**
 * Makes a tournament live, or stands it down.
 *
 * Refused with a 409 naming the clash when a coach in it is already live
 * somewhere else — a coach can only be held to one tournament at a time.
 */
export async function setTournamentActive(
  tournamentId: number,
  isActive: boolean,
): Promise<AdminState> {
  return post('/api/admin', { action: 'active', tournamentId, isActive })
}

/** Who Cloudflare Access says this browser belongs to. */
export interface Identity {
  state: 'local' | 'verified' | 'rejected'
  email: string | null
  name: string | null
  nafNumber: number | null
  /** The role actually held, from coach_identity. Opens the Settings tab. */
  isAdmin: boolean
  /** Owns the app: the Admin panel. Separate axis from coordinating. */
  isOwner: boolean
  /** The tournament this viewer is on, and whether they may change it. */
  tournamentId: number | null
  tournamentLocked: boolean
  /** What the dropdown may offer them. */
  tournaments: { id: number; name: string; isActive: boolean }[]
  /** The role in force — held, or lent by open coordinator mode. */
  canCoordinate: boolean
  /** True when the role is lent rather than held, so the app can say so. */
  openCoordinator: boolean
  board: { id: number; side: 'a' | 'b'; opponent: string } | null
  /** False when ACCESS_AUD is unset, which weakens the check — see access.ts. */
  audChecked: boolean
  reason: string | null
}

export async function fetchIdentity(signal?: AbortSignal): Promise<Identity> {
  const response = await fetch(scoped('/api/me'), { signal, headers: { accept: 'application/json' } })
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
  /** Always team A's point of view, as stored. The view flips it for side B. */
  outlook: Outlook
}

/**
 * Reports a coach's own board. Deliberately carries no board number: the
 * server works it out from the Access identity, so this cannot address anyone
 * else's match.
 */
export async function saveMyBoard(entry: MyBoardEntry): Promise<Round> {
  return normalise(await post('/api/my-board', entry))
}

/**
 * Lends the coordinator's powers to everyone signed in, or takes them back.
 *
 * Only a real coordinator may call this — the server checks coach_identity
 * rather than the role in force, so the switch cannot hold itself on.
 */
export async function setOpenCoordinator(openCoordinator: boolean): Promise<Round> {
  return normalise(await post('/api/settings', { openCoordinator }))
}

/** Marks the line-up on screen as provisional, or confirms it. */
export async function setProvisional(provisional: boolean): Promise<Round> {
  return normalise(await post('/api/provisional', { provisional }))
}

/**
 * Switches how casualties read for every device in the hall.
 *
 * A real change clears the current round's casualties server-side, which is why
 * the app asks first.
 */
export async function setCasualtyMode(casualtyMode: CasualtyMode): Promise<Round> {
  return normalise(await post('/api/settings', { casualtyMode }))
}

export interface EnginePing {
  base: string
  ok: boolean
  health: string
  version: string | null
}

/** Asks whether the Scout engine is answering, without pulling anything. */
export async function pingScoutEngine(): Promise<EnginePing> {
  const response = await fetch(scoped('/api/scout/ping'), { headers: { accept: 'application/json' } })
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

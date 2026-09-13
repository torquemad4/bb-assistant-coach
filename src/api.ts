import { OUTLOOK_VALUES, type Board, type Half, type Outlook, type Round } from './types'

/** The mutable half of a board — the only fields a save is allowed to write. */
export interface SaveBoard {
  id: number
  aScore: number
  aInjuries: number
  bScore: number
  bInjuries: number
  half: Half
  outlook: Outlook
}

export function toSaveBoard(board: Board): SaveBoard {
  return {
    id: board.id,
    aScore: board.a.score,
    aInjuries: board.a.injuries,
    bScore: board.b.score,
    bInjuries: board.b.injuries,
    half: board.half,
    outlook: board.outlook,
  }
}

/**
 * The API is ours, but the response still gets checked: a stray value from a
 * hand-edited database should degrade to a sane default rather than render
 * `NaN` across the dashboard mid-round.
 */
function asHalf(value: unknown): Half {
  return value === 2 ? 2 : 1
}

function asOutlook(value: unknown): Outlook {
  return OUTLOOK_VALUES.includes(value as Outlook) ? (value as Outlook) : 0
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function normalise(payload: any): Round {
  return {
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
      half: asHalf(b.half),
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

/** Pulls live match state. The server ignores calls that come too close together. */
export async function syncNow(): Promise<Round> {
  return normalise(await post('/api/sync'))
}

/** Without `confirm`, returns what the import would do rather than doing it. */
export async function linkTournament(slug: string, confirm = false): Promise<Round | LinkPreview> {
  const payload = await post('/api/link', { slug, confirm })
  return payload.preview ? (payload as LinkPreview) : normalise(payload)
}

export async function setSyncMode(enabled: boolean): Promise<Round> {
  return normalise(await post('/api/sync-mode', { enabled }))
}

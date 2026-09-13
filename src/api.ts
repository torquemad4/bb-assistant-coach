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
    roundNumber: payload.roundNumber,
    totalRounds: payload.totalRounds,
    teamA: payload.teamA,
    teamB: payload.teamB,
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

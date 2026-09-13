import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchRound, saveRound, toSaveBoard } from '../api'
import { SEED_ROUND } from '../data/round'
import {
  OUTLOOK_MAX,
  OUTLOOK_MIN,
  OUTLOOK_STEP,
  type Board,
  type Half,
  type Outlook,
  type Round,
  type TeamId,
} from '../types'

/** How often a clean, connected client re-reads the round. */
const POLL_MS = 10_000

/** Clamp an arbitrary number back onto the legal outlook scale. */
function clampOutlook(value: number): Outlook {
  const stepped = Math.round(value / OUTLOOK_STEP) * OUTLOOK_STEP
  return Math.min(OUTLOOK_MAX, Math.max(OUTLOOK_MIN, stepped)) as Outlook
}

/** Scores and casualties can never go below zero. */
function clampCount(value: number): number {
  return Math.max(0, value)
}

/**
 * Whether a board's match state differs from what the server last confirmed.
 * Only the savable fields count — a roster change made directly in D1 is not an
 * unsaved edit.
 */
function boardChanged(a: Board, b: Board): boolean {
  const x = toSaveBoard(a)
  const y = toSaveBoard(b)
  return (
    x.aScore !== y.aScore ||
    x.aInjuries !== y.aInjuries ||
    x.bScore !== y.bScore ||
    x.bInjuries !== y.bInjuries ||
    x.half !== y.half ||
    x.outlook !== y.outlook
  )
}

/** 'live' talks to D1; 'offline' is the committed fixture, read only. */
export type Connection = 'loading' | 'live' | 'offline'

export interface RoundController {
  round: Round
  connection: Connection
  loadError: string | null
  aggregate: number
  aggregateRange: number
  /** Boards whose match state has been edited but not saved. */
  dirtyBoardIds: number[]
  isDirty: boolean
  saving: boolean
  saveError: string | null
  lastSavedAt: Date | null
  nudgeOutlook: (boardId: number, direction: 1 | -1) => void
  nudgeScore: (boardId: number, team: TeamId, direction: 1 | -1) => void
  nudgeInjuries: (boardId: number, team: TeamId, direction: 1 | -1) => void
  setHalf: (boardId: number, half: Half) => void
  /** Throw away unsaved edits and go back to the last saved state. */
  discard: () => void
  save: () => void
  reload: () => void
}

/**
 * Single source of truth for the round.
 *
 * `round` is what is on screen; `baseline` is what the server last confirmed.
 * The difference between them is the unsaved work, which is why nothing here
 * writes to D1 until `save` is called.
 */
export function useRound(): RoundController {
  const [round, setRound] = useState<Round>(SEED_ROUND)
  const [baseline, setBaseline] = useState<Round>(SEED_ROUND)
  const [connection, setConnection] = useState<Connection>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  const dirtyBoardIds = useMemo(() => {
    const byId = new Map(baseline.boards.map((b) => [b.id, b]))
    return round.boards.filter((b) => {
      const was = byId.get(b.id)
      return was ? boardChanged(b, was) : true
    }).map((b) => b.id)
  }, [round, baseline])

  const isDirty = dirtyBoardIds.length > 0

  // Kept in a ref so the polling interval can read current values without
  // being torn down and rebuilt on every keystroke.
  const guard = useRef({ isDirty, saving, connection })
  guard.current = { isDirty, saving, connection }

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const fresh = await fetchRound(signal)
      setRound(fresh)
      setBaseline(fresh)
      setConnection('live')
      setLoadError(null)
    } catch (cause) {
      if (signal?.aborted) return
      // Fall back to the committed fixture so the dashboard still shows
      // something, but read only — saving into a round we could not read
      // would be worse than not saving at all.
      setRound(SEED_ROUND)
      setBaseline(SEED_ROUND)
      setConnection('offline')
      setLoadError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // Watchers need the live picture. Polling pauses while there are unsaved
  // edits, so a refresh can never wipe work in progress.
  useEffect(() => {
    const timer = setInterval(() => {
      const { isDirty: dirty, saving: busy, connection: state } = guard.current
      if (dirty || busy || state !== 'live') return
      void load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // A tablet that gets closed mid-edit should say so.
  useEffect(() => {
    if (!isDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  const updateBoard = useCallback((boardId: number, change: (board: Board) => Board) => {
    setRound((current) => ({
      ...current,
      boards: current.boards.map((board) => (board.id === boardId ? change(board) : board)),
    }))
  }, [])

  const nudgeOutlook = useCallback(
    (boardId: number, direction: 1 | -1) => {
      updateBoard(boardId, (board) => ({
        ...board,
        outlook: clampOutlook(board.outlook + direction * OUTLOOK_STEP),
      }))
    },
    [updateBoard],
  )

  const nudgeScore = useCallback(
    (boardId: number, team: TeamId, direction: 1 | -1) => {
      updateBoard(boardId, (board) => {
        const key = team === 'A' ? 'a' : 'b'
        return { ...board, [key]: { ...board[key], score: clampCount(board[key].score + direction) } }
      })
    },
    [updateBoard],
  )

  const nudgeInjuries = useCallback(
    (boardId: number, team: TeamId, direction: 1 | -1) => {
      updateBoard(boardId, (board) => {
        const key = team === 'A' ? 'a' : 'b'
        return { ...board, [key]: { ...board[key], injuries: clampCount(board[key].injuries + direction) } }
      })
    },
    [updateBoard],
  )

  const setHalf = useCallback(
    (boardId: number, half: Half) => {
      updateBoard(boardId, (board) => ({ ...board, half }))
    },
    [updateBoard],
  )

  const discard = useCallback(() => {
    setRound(baseline)
    setSaveError(null)
  }, [baseline])

  const save = useCallback(async () => {
    if (connection !== 'live') return
    setSaving(true)
    setSaveError(null)
    try {
      const fresh = await saveRound(round.boards)
      setRound(fresh)
      setBaseline(fresh)
      setLastSavedAt(new Date())
    } catch (cause) {
      // The edits stay on screen so nothing is lost and Save can be retried.
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }, [connection, round])

  const reload = useCallback(() => {
    setConnection('loading')
    void load()
  }, [load])

  const aggregate = useMemo(
    () => round.boards.reduce((total, board) => total + board.outlook, 0),
    [round.boards],
  )

  return {
    round,
    connection,
    loadError,
    aggregate,
    aggregateRange: round.boards.length,
    dirtyBoardIds,
    isDirty,
    saving,
    saveError,
    lastSavedAt,
    nudgeOutlook,
    nudgeScore,
    nudgeInjuries,
    setHalf,
    discard,
    save: () => void save(),
    reload,
  }
}

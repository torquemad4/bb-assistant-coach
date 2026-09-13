import { useCallback, useMemo, useState } from 'react'
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

/** Clamp an arbitrary number back onto the legal outlook scale. */
function clampOutlook(value: number): Outlook {
  const stepped = Math.round(value / OUTLOOK_STEP) * OUTLOOK_STEP
  return Math.min(OUTLOOK_MAX, Math.max(OUTLOOK_MIN, stepped)) as Outlook
}

/** Scores and casualties can never go below zero. */
function clampCount(value: number): number {
  return Math.max(0, value)
}

export interface RoundController {
  round: Round
  /** Sum of every board's outlook — the round-level number on the dashboard. */
  aggregate: number
  /** The widest the aggregate could swing, i.e. one per board. */
  aggregateRange: number
  nudgeOutlook: (boardId: number, direction: 1 | -1) => void
  nudgeScore: (boardId: number, team: TeamId, direction: 1 | -1) => void
  nudgeInjuries: (boardId: number, team: TeamId, direction: 1 | -1) => void
  setHalf: (boardId: number, half: Half) => void
  reset: () => void
}

/**
 * Single source of truth for the round. Score, injuries and half are held as
 * ordinary state here so a Tourplay subscription can later push into the same
 * setters; outlook stays coach-entered either way.
 */
export function useRound(): RoundController {
  const [round, setRound] = useState<Round>(SEED_ROUND)

  const updateBoard = useCallback(
    (boardId: number, change: (board: Board) => Board) => {
      setRound((current) => ({
        ...current,
        boards: current.boards.map((board) => (board.id === boardId ? change(board) : board)),
      }))
    },
    [],
  )

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

  const reset = useCallback(() => setRound(SEED_ROUND), [])

  const aggregate = useMemo(
    () => round.boards.reduce((total, board) => total + board.outlook, 0),
    [round.boards],
  )

  return {
    round,
    aggregate,
    aggregateRange: round.boards.length,
    nudgeOutlook,
    nudgeScore,
    nudgeInjuries,
    setHalf,
    reset,
  }
}

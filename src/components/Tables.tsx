import { useEffect, useMemo, useState } from 'react'
import { PreMatchCard } from './PreMatch'
import type { RoundController } from '../state/useRound'
import { flagsForBoard, type Board } from '../types'

/**
 * One table of a pairs event: the two boards played side by side on it.
 *
 * At a pairs event a squad of two meets another squad of two across one table,
 * which is two games. Walking up to a table, the question is never "how is
 * board 5 doing" — it is "what is happening on this table", both games at once.
 * The Pre-Match tab answers the first question for every board in the round;
 * this answers the second for one table.
 *
 * Boards pair by adjacency — table 1 is boards 1 and 2 — because that is the
 * order a squad-versus-squad fixture arrives in from Tourplay: its two matches
 * are listed together, so the import numbers them side by side. An odd last
 * board gets a table of its own rather than being dropped.
 */
function tablesOf(boards: Board[]): Board[][] {
  const tables: Board[][] = []
  for (let i = 0; i < boards.length; i += 2) tables.push(boards.slice(i, i + 2))
  return tables
}

export function Tables(controller: RoundController) {
  const { round } = controller
  const tables = useMemo(() => tablesOf(round.boards), [round.boards])
  const [selected, setSelected] = useState(0)

  // A round can change under this view — a new one imported, boards reordered.
  // Landing on a table that no longer exists would render nothing at all.
  useEffect(() => {
    if (selected > tables.length - 1) setSelected(0)
  }, [tables.length, selected])

  const byBoard = useMemo(
    () => new Map((round.scout?.boards ?? []).map((b) => [b.boardId, b])),
    [round.scout],
  )

  if (tables.length === 0) {
    return (
      <div className="tables">
        <p className="tables__none">
          <strong>No boards in this round yet.</strong> Import a draw from Tourplay in Settings and
          the tables appear here.
        </p>
      </div>
    )
  }

  const table = tables[Math.min(selected, tables.length - 1)] ?? []

  return (
    <div className="tables">
      <nav className="tables__picker" aria-label="Table">
        <span className="tables__picker-label">Table</span>
        <div className="tables__numbers">
          {tables.map((boards, i) => (
            <button
              key={i}
              type="button"
              className={`tables__number${i === selected ? ' is-on' : ''}`}
              aria-current={i === selected}
              onClick={() => setSelected(i)}
              // The board numbers are what is printed on the table in the hall,
              // so they belong in the label a coordinator reads out.
              title={`Boards ${boards.map((b) => b.id).join(' and ')}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <span className="tables__boards">
          {table.length === 2
            ? `Boards ${table[0].id} and ${table[1].id}`
            : `Board ${table[0]?.id}`}
        </span>
      </nav>

      <div className="tables__grid" data-count={table.length}>
        {table.map((board) => (
          <PreMatchCard
            key={board.id}
            board={board}
            scout={byBoard.get(board.id)}
            controller={controller}
            countryA={flagsForBoard(round, board.id).a}
            countryB={flagsForBoard(round, board.id).b}
            // Reordering is a Pre-Match job and moving a board here would
            // silently re-cut the tables under the reader, so the arrows are
            // switched off by telling the card it is the only board there is.
            index={0}
            count={1}
          />
        ))}
      </div>
    </div>
  )
}

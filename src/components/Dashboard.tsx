import { BoardCard } from './BoardCard'
import { RoundOutlook } from './RoundOutlook'
import type { RoundController } from '../state/useRound'

/** Tab one: every live board in the round, read only. */
export function Dashboard({ round, aggregate, aggregateRange }: RoundController) {
  return (
    <div className="dashboard">
      <div className="dashboard__legend">
        <span className="legend__team legend__team--a">{round.teamAName}</span>
        <span className="legend__vs">vs</span>
        <span className="legend__team legend__team--b">{round.teamBName}</span>
      </div>

      <div className="boards" data-count={round.boards.length}>
        {round.boards.map((board) => (
          <BoardCard key={board.id} board={board} />
        ))}
      </div>

      <RoundOutlook boards={round.boards} aggregate={aggregate} range={aggregateRange} />
    </div>
  )
}

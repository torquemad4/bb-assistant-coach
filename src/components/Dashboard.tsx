import { BoardCard } from './BoardCard'
import { Flag } from './Flag'
import { RoundOutlook } from './RoundOutlook'
import type { RoundController } from '../state/useRound'

/** Tab one: every live board in the round, read only. */
export function Dashboard({ round, aggregate, aggregateRange }: RoundController) {
  return (
    <div className="dashboard">
      <div className="dashboard__legend">
        <span className="legend__team legend__team--a">
          <Flag country={round.teamA.country} />
          {round.teamA.name}
        </span>
        <span className="legend__vs">vs</span>
        <span className="legend__team legend__team--b">
          <Flag country={round.teamB.country} />
          {round.teamB.name}
        </span>
      </div>

      <div className="boards" data-count={round.boards.length}>
        {round.boards.map((board) => (
          <BoardCard
            key={board.id}
            board={board}
            countryA={round.teamA.country}
            countryB={round.teamB.country}
          />
        ))}
      </div>

      <RoundOutlook boards={round.boards} aggregate={aggregate} range={aggregateRange} />
    </div>
  )
}

import { aggregateVerdict, signed, toneOf } from '../format'
import type { Board } from '../types'

interface RoundOutlookProps {
  boards: Board[]
  aggregate: number
  range: number
}

/**
 * The frame across the bottom of the dashboard: the single round-level number,
 * plus a per-board strip so the sum can be read back to its parts at a glance.
 */
export function RoundOutlook({ boards, aggregate, range }: RoundOutlookProps) {
  const tone = toneOf(aggregate)
  // Aggregate mapped onto 0-100% for the balance bar.
  const balance = range === 0 ? 50 : ((aggregate / range + 1) / 2) * 100

  return (
    <section className={`round round--${tone}`} aria-label="Round outlook">
      <div className="round__figure">
        <span className="round__label">Round Outlook</span>
        <span className="round__value">{signed(aggregate)}</span>
        <span className="round__verdict">{aggregateVerdict(aggregate, range)}</span>
        <span className="round__range">
          sum of {boards.length} boards · range {signed(-range)} to {signed(range)}
        </span>
      </div>

      <div className="round__bar-wrap">
        <div className="round__bar" role="img" aria-label={`Balance ${signed(aggregate)} of ${range}`}>
          <div className="round__bar-centre" />
          <div className="round__bar-marker" style={{ left: `${balance}%` }} />
        </div>
        <div className="round__strip">
          {boards.map((board) => (
            <div key={board.id} className={`chip chip--${toneOf(board.outlook)}`}>
              <span className="chip__board">{board.id}</span>
              <span className="chip__value">{signed(board.outlook)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

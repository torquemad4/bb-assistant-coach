import { RACE_TAG, type Race } from '../data/races'
import { signed, toneOf } from '../format'
import { Stepper } from './Stepper'
import type { RoundController } from '../state/useRound'
import { OUTLOOK_MAX, OUTLOOK_MIN, type Board } from '../types'

function raceTag(race: string): string {
  return RACE_TAG[race as Race] ?? race.slice(0, 4).toUpperCase()
}

interface RowProps {
  board: Board
  controller: RoundController
}

function ControlRow({ board, controller }: RowProps) {
  const { nudgeOutlook, nudgeScore, nudgeInjuries, setHalf } = controller

  return (
    <div className="ctl-row">
      <div className="ctl-row__board">
        <span className="ctl-row__number">{board.id}</span>
      </div>

      <div className="ctl-row__names">
        <div className="ctl-name ctl-name--a">
          <span className="ctl-name__handle">{board.a.nafName}</span>
          <span className="ctl-name__race">{raceTag(board.a.race)}</span>
        </div>
        <div className="ctl-name ctl-name--b">
          <span className="ctl-name__handle">{board.b.nafName}</span>
          <span className="ctl-name__race">{raceTag(board.b.race)}</span>
        </div>
      </div>

      <div className="ctl-row__cell ctl-row__cell--pair">
        <Stepper
          team="a"
          label={`board ${board.id} team A score`}
          display={String(board.a.score)}
          atMin={board.a.score === 0}
          onStep={(d) => nudgeScore(board.id, 'A', d)}
        />
        <Stepper
          team="b"
          label={`board ${board.id} team B score`}
          display={String(board.b.score)}
          atMin={board.b.score === 0}
          onStep={(d) => nudgeScore(board.id, 'B', d)}
        />
      </div>

      <div className="ctl-row__cell ctl-row__cell--pair">
        <Stepper
          team="a"
          label={`board ${board.id} team A casualties`}
          display={String(board.a.injuries)}
          atMin={board.a.injuries === 0}
          onStep={(d) => nudgeInjuries(board.id, 'A', d)}
        />
        <Stepper
          team="b"
          label={`board ${board.id} team B casualties`}
          display={String(board.b.injuries)}
          atMin={board.b.injuries === 0}
          onStep={(d) => nudgeInjuries(board.id, 'B', d)}
        />
      </div>

      <div className="ctl-row__cell">
        <div className="halves" role="group" aria-label={`Board ${board.id} half`}>
          {([1, 2] as const).map((half) => (
            <button
              key={half}
              type="button"
              className={`halves__btn${board.half === half ? ' is-active' : ''}`}
              onClick={() => setHalf(board.id, half)}
              aria-pressed={board.half === half}
            >
              {half === 1 ? '1st' : '2nd'}
            </button>
          ))}
        </div>
      </div>

      <div className="ctl-row__cell ctl-row__cell--outlook">
        <Stepper
          arrows
          label={`board ${board.id} outlook`}
          display={signed(board.outlook)}
          tone={toneOf(board.outlook)}
          atMin={board.outlook <= OUTLOOK_MIN}
          atMax={board.outlook >= OUTLOOK_MAX}
          onStep={(d) => nudgeOutlook(board.id, d)}
        />
      </div>
    </div>
  )
}

/** Tab two: every mutable value for the round, one row per board. */
export function ControlPanel(controller: RoundController) {
  const { round, aggregate, reset } = controller

  return (
    <div className="control">
      <div className="control__bar">
        <p className="control__hint">
          Score, casualties and half stand in for the live Tourplay feed. Outlook steps by 0.5,
          clamped to −1.0 … +1.0.
        </p>
        <div className="control__total">
          <span className="control__total-label">Aggregate</span>
          <span className={`control__total-value control__total-value--${toneOf(aggregate)}`}>
            {signed(aggregate)}
          </span>
        </div>
        <button type="button" className="control__reset" onClick={reset}>
          Reset round
        </button>
      </div>

      <div className="ctl-head" aria-hidden="true">
        <span className="ctl-head__board">#</span>
        <span>Coaches</span>
        <span>Score A / B</span>
        <span>Casualties A / B</span>
        <span>Half</span>
        <span>Outlook</span>
      </div>

      <div className="ctl-rows">
        {round.boards.map((board) => (
          <ControlRow key={board.id} board={board} controller={controller} />
        ))}
      </div>
    </div>
  )
}

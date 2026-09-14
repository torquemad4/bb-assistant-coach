import { RACE_TAG, type Race } from '../data/races'
import { signed, toneOf } from '../format'
import { Flag } from './Flag'
import { Stepper } from './Stepper'
import { TourplayPanel } from './TourplayPanel'
import type { RoundController } from '../state/useRound'
import {
  OUTLOOK_MAX,
  OUTLOOK_MIN,
  PERIODS,
  type Board,
  type CountryCode,
  type Period,
} from '../types'

function raceTag(race: string): string {
  return RACE_TAG[race as Race] ?? race.slice(0, 4).toUpperCase()
}

interface RowProps {
  board: Board
  controller: RoundController
  countryA: CountryCode | null
  countryB: CountryCode | null
}

function ControlRow({ board, controller, countryA, countryB }: RowProps) {
  const { nudgeOutlook, nudgeScore, nudgeInjuries, setPeriod, setKickoff, connection, dirtyBoardIds } =
    controller
  const locked = connection !== 'live'
  // Score, casualties and half come from Tourplay while the round follows it —
  // editing them by hand would just be overwritten on the next sync.
  const followed = locked || controller.followingTourplay
  // A finished match is settled: nothing about it is editable except undoing
  // full time itself.
  const ft = board.period === 'FT'
  const stateLocked = followed || ft
  const dirty = dirtyBoardIds.includes(board.id)

  return (
    <div className={`ctl-row${dirty ? ' ctl-row--dirty' : ''}`}>
      <div className="ctl-row__board">
        <span className="ctl-row__number">{board.id}</span>
        {dirty && <span className="ctl-row__dot" title="Unsaved changes" />}
      </div>

      <div className="ctl-row__names">
        <div className={`ctl-name ctl-name--a${board.a.vacant ? ' ctl-name--vacant' : ''}`}>
          {!board.a.vacant && <Flag country={countryA} />}
          <span className="ctl-name__handle">{board.a.nafName}</span>
          <span className="ctl-name__race">
            {board.a.vacant ? 'seat unfilled' : raceTag(board.a.race)}
          </span>
        </div>
        <div className={`ctl-name ctl-name--b${board.b.vacant ? ' ctl-name--vacant' : ''}`}>
          {!board.b.vacant && <Flag country={countryB} />}
          <span className="ctl-name__handle">{board.b.nafName}</span>
          <span className="ctl-name__race">
            {board.b.vacant ? 'seat unfilled' : raceTag(board.b.race)}
          </span>
        </div>
      </div>

      <div className="ctl-row__cell ctl-row__cell--pair">
        <Stepper
          team="a"
          disabled={stateLocked}
          label={`board ${board.id} team A score`}
          display={String(board.a.score)}
          atMin={board.a.score === 0}
          onStep={(d) => nudgeScore(board.id, 'A', d)}
        />
        <Stepper
          team="b"
          disabled={stateLocked}
          label={`board ${board.id} team B score`}
          display={String(board.b.score)}
          atMin={board.b.score === 0}
          onStep={(d) => nudgeScore(board.id, 'B', d)}
        />
      </div>

      <div className="ctl-row__cell ctl-row__cell--pair">
        <Stepper
          team="a"
          disabled={stateLocked}
          label={`board ${board.id} team A casualties`}
          display={String(board.a.injuries)}
          atMin={board.a.injuries === 0}
          onStep={(d) => nudgeInjuries(board.id, 'A', d)}
        />
        <Stepper
          team="b"
          disabled={stateLocked}
          label={`board ${board.id} team B casualties`}
          display={String(board.b.injuries)}
          atMin={board.b.injuries === 0}
          onStep={(d) => nudgeInjuries(board.id, 'B', d)}
        />
      </div>

      <div className="ctl-row__cell">
        <div className="halves halves--kick" role="group" aria-label={`Board ${board.id} kick-off`}>
          {(['K', 'R'] as const).map((side) => (
            <button
              key={side}
              type="button"
              className={`halves__btn${board.kickoff === side ? ' is-active' : ''}`}
              onClick={() => setKickoff(board.id, side)}
              disabled={locked || ft}
              aria-pressed={board.kickoff === side}
              title={side === 'K' ? 'Home side kicked off' : 'Home side received'}
            >
              {side}
            </button>
          ))}
        </div>
      </div>

      <div className="ctl-row__cell">
        <div className="halves halves--period" role="group" aria-label={`Board ${board.id} period`}>
          {PERIODS.map((period: Period) => (
            <button
              key={period}
              type="button"
              className={`halves__btn${board.period === period ? ' is-active' : ''}${
                period === 'FT' ? ' halves__btn--ft' : ''
              }`}
              onClick={() => setPeriod(board.id, period)}
              // Tourplay owns which half it is, but calling full time is always
              // the coordinator's to do — and undo.
              disabled={period === 'FT' ? locked : followed}
              aria-pressed={board.period === period}
            >
              {period === '1' ? '1st' : period === '2' ? '2nd' : 'FT'}
            </button>
          ))}
        </div>
      </div>

      <div className="ctl-row__cell ctl-row__cell--outlook">
        <Stepper
          arrows
          disabled={locked || ft}
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
function saveLabel(controller: RoundController): string {
  if (controller.saving) return 'Saving…'
  const count = controller.dirtyBoardIds.length
  if (count === 0) return 'Saved'
  return `Save ${count} board${count === 1 ? '' : 's'}`
}

export function ControlPanel(controller: RoundController) {
  const { round, aggregate, discard, save, saving, isDirty, saveError, lastSavedAt, connection } =
    controller

  return (
    <div className="control">
      <TourplayPanel {...controller} />

      <div className="control__bar">
        <p className="control__hint">
          Outlook steps by 0.5, clamped to −1.0 … +1.0 — positive favours {round.teamA.name},
          negative favours {round.teamB.name}.{' '}
          {controller.followingTourplay
            ? 'Score, casualties and half come from Tourplay; kick-off, full time and outlook are yours.'
            : 'Nothing is written until you save.'}{' '}
          Calling FT fixes that board's outlook to the result and locks it.
        </p>
        <div className="control__total">
          <span className="control__total-label">Aggregate</span>
          <span className={`control__total-value control__total-value--${toneOf(aggregate)}`}>
            {signed(aggregate)}
          </span>
        </div>
        <div className="control__actions">
          <button
            type="button"
            className={`control__provisional${round.rostersProvisional ? ' is-on' : ''}`}
            onClick={() => controller.setProvisional(!round.rostersProvisional)}
            disabled={connection !== 'live'}
            title={
              round.rostersProvisional
                ? 'Confirm this line-up — removes the provisional banner'
                : 'Mark this line-up as a stand-in, so nobody reads placeholder picks as real'
            }
          >
            {round.rostersProvisional ? 'Confirm line-up' : 'Mark provisional'}
          </button>
          <button
            type="button"
            className="control__reset"
            onClick={discard}
            disabled={!isDirty || saving}
          >
            Discard
          </button>
          <button
            type="button"
            className={`control__save${isDirty ? ' is-dirty' : ''}`}
            onClick={save}
            disabled={!isDirty || saving || connection !== 'live'}
          >
            {saveLabel(controller)}
          </button>
        </div>
      </div>

      {saveError && (
        <p className="control__error" role="alert">
          Save failed — your changes are still here, try again. {saveError}
        </p>
      )}

      {!saveError && lastSavedAt && !isDirty && (
        <p className="control__saved">
          Saved at{' '}
          {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      <div className="ctl-head" aria-hidden="true">
        <span className="ctl-head__board">#</span>
        <span>Coaches</span>
        <span>
          Score {round.teamA.name} / {round.teamB.name}
        </span>
        <span>
          Casualties {round.teamA.name} / {round.teamB.name}
        </span>
        <span>Kick</span>
        <span>Period</span>
        <span>Outlook</span>
      </div>

      <div className="ctl-rows">
        {round.boards.map((board) => (
          <ControlRow
            key={board.id}
            board={board}
            controller={controller}
            countryA={round.teamA.country}
            countryB={round.teamB.country}
          />
        ))}
      </div>
    </div>
  )
}

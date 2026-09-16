import { useState } from 'react'
import { CASUALTY_LABEL, SQUAD_DEFAULT, SQUAD_SNOTLING } from '../casualties'
import { TourplayPanel } from './TourplayPanel'
import type { RoundController } from '../state/useRound'
import type { CasualtyMode } from '../types'

/**
 * The coordinator's settings, and only theirs.
 *
 * Everything here changes what every screen in the hall does, which is why it
 * is one tab rather than controls scattered through the views they affect: a
 * switch that moves other people's screens should be somewhere you go on
 * purpose, not somewhere you can catch with a thumb while entering a score.
 *
 * This tab stays with the real coordinators even when open mode has lent the
 * role out — see `OpenCoordinatorRow`.
 */
export function Settings(controller: RoundController) {
  const { round, connection } = controller
  const offline = connection !== 'live'

  return (
    <div className="settings">
      <TourplayPanel {...controller} />

      <section className="set-group" aria-label="Display">
        <ProvisionalRow controller={controller} offline={offline} />
        <CasualtyRow controller={controller} offline={offline} />
      </section>

      <section className="set-group" aria-label="Access">
        <OpenCoordinatorRow controller={controller} offline={offline} />
      </section>

      <p className="set-foot">
        These settings are shared. Changing one here changes it on every screen
        in the hall, not just this one.
        {round.updatedAt && <> Last write {round.updatedAt}.</>}
      </p>
    </div>
  )
}

interface RowProps {
  controller: RoundController
  offline: boolean
}

/** A setting: what it is, what it does, and the control, in that order. */
function Row({
  title,
  state,
  detail,
  children,
}: {
  title: string
  state: string
  detail: string
  children: React.ReactNode
}) {
  return (
    <div className="set-row">
      <div className="set-row__text">
        <h3 className="set-row__title">{title}</h3>
        <p className="set-row__state">{state}</p>
        <p className="set-row__detail">{detail}</p>
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  )
}

function ProvisionalRow({ controller, offline }: RowProps) {
  const on = controller.round.rostersProvisional
  return (
    <Row
      title="Provisional line-up warning"
      state={on ? 'Showing on every screen.' : 'Hidden — this line-up is confirmed.'}
      detail={
        'The banner marks the line-up as a stand-in. Placeholder races look exactly like real ' +
        'ones on screen, and scouting run against them reads as intel when it is fiction.'
      }
    >
      <button
        type="button"
        className={`set-toggle${on ? ' is-on' : ''}`}
        onClick={() => controller.setProvisional(!on)}
        disabled={offline}
        aria-pressed={on}
      >
        {on ? 'Hide — line-up confirmed' : 'Show — line-up is a stand-in'}
      </button>
    </Row>
  )
}

/**
 * Removals or players left.
 *
 * The confirmation is the point of this control rather than an afterthought:
 * the numbers already on the boards were counted under the other heading, so
 * the server clears them, and nobody should discover that after the fact.
 */
function CasualtyRow({ controller, offline }: RowProps) {
  const mode = controller.round.casualtyMode
  const next: CasualtyMode = mode === 'removals' ? 'players' : 'removals'
  const [asking, setAsking] = useState(false)

  return (
    <Row
      title="Casualty numbers"
      state={
        mode === 'removals'
          ? 'Counting removals — how many players have been taken off.'
          : `Counting players left — starting at ${SQUAD_DEFAULT}, and ${SQUAD_SNOTLING} for a Snotling team.`
      }
      detail={
        'Both readings come from the same stored number, so switching does not rewrite any ' +
        'round that is already finished.'
      }
    >
      {asking ? (
        <div className="set-confirm" role="alertdialog" aria-label="Confirm the change">
          <p className="set-confirm__warn">
            Changing this will reset the casualty numbers for the current round.
          </p>
          <div className="set-confirm__actions">
            <button
              type="button"
              className="set-confirm__go"
              onClick={() => {
                controller.setCasualtyMode(next)
                setAsking(false)
              }}
            >
              Change and reset
            </button>
            <button type="button" className="set-confirm__no" onClick={() => setAsking(false)}>
              Keep {CASUALTY_LABEL[mode].toLowerCase()}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="set-toggle"
          onClick={() => setAsking(true)}
          disabled={offline}
        >
          Switch to {CASUALTY_LABEL[next].toLowerCase()}
        </button>
      )}
    </Row>
  )
}

/**
 * Lends the coordinator's powers to everyone signed in.
 *
 * Only a real coordinator sees this tab at all, so this control cannot lock
 * itself on: whoever opened it — or any other real coordinator — can always
 * close it. The server enforces that independently, checking the role held
 * rather than the role in force.
 */
function OpenCoordinatorRow({ controller, offline }: RowProps) {
  const on = controller.round.openCoordinator
  const [asking, setAsking] = useState(false)

  return (
    <Row
      title="Everyone coordinates"
      state={
        on
          ? 'On — everyone signed in has Match Control.'
          : 'Off — only coordinators have Match Control.'
      }
      detail={
        'With this on, anyone signed in can edit any board, call full time on a match that is ' +
        'not theirs, and switch the round for every screen. Only a coordinator can turn it ' +
        'back off, and this tab stays coordinators-only either way.'
      }
    >
      {asking ? (
        <div className="set-confirm" role="alertdialog" aria-label="Confirm the change">
          <p className="set-confirm__warn">
            Everyone signed in will be able to edit every board and switch the round.
          </p>
          <div className="set-confirm__actions">
            <button
              type="button"
              className="set-confirm__go"
              onClick={() => {
                controller.setOpenCoordinator(true)
                setAsking(false)
              }}
            >
              Hand it to everyone
            </button>
            <button type="button" className="set-confirm__no" onClick={() => setAsking(false)}>
              Keep it to coordinators
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`set-toggle${on ? ' is-on' : ''}`}
          onClick={() => (on ? controller.setOpenCoordinator(false) : setAsking(true))}
          disabled={offline}
          aria-pressed={on}
        >
          {on ? 'Take it back' : 'Hand it to everyone'}
        </button>
      )}
    </Row>
  )
}

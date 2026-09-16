import { useCallback, useEffect, useRef, useState } from 'react'
import { saveMyBoard, type Identity } from '../api'
import { casualtyStep, casualtyView } from '../casualties'
import type { RoundController } from '../state/useRound'
import {
  OUTLOOK_MAX,
  OUTLOOK_MIN,
  OUTLOOK_STEP,
  PERIODS,
  resultOf,
  type Kickoff,
  type Outlook,
  type Period,
} from '../types'

/** How long after the last tap the entry is sent. Long enough to coalesce a
 *  run of taps on the same stepper, short enough to feel immediate. */
const SETTLE_MS = 600

type Status = 'idle' | 'saving' | 'saved' | 'failed'

interface StepProps {
  label: string
  value: number
  tone?: 'score' | 'cas'
  /** Both ends are given rather than inferred: in players-left mode the number
   *  counts down from a full team, so neither end is where a count from zero
   *  would put it. */
  atMin?: boolean
  atMax?: boolean
  disabled: boolean
  /** Which way the coach pressed, not what the number becomes — the caller owns
   *  the arithmetic, because in players-left mode "+" is one fewer casualty. */
  onStep: (direction: 1 | -1) => void
}

/** A big two-button stepper. Sized for a thumb on a phone, not a mouse. */
function Step({
  label,
  value,
  tone = 'score',
  atMin = false,
  atMax = false,
  disabled,
  onStep,
}: StepProps) {
  return (
    <div className={`mb-step mb-step--${tone}`}>
      <span className="mb-step__label">{label}</span>
      <div className="mb-step__row">
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={disabled || atMin}
          aria-label={`${label} down`}
        >
          −
        </button>
        <output className="mb-step__value">{value}</output>
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={disabled || atMax}
          aria-label={`${label} up`}
        >
          +
        </button>
      </div>
    </div>
  )
}

const PERIOD_LABEL: Record<Period, string> = { '1': '1st half', '2': '2nd half', FT: 'Full time' }

/** The coach's own read on their board, in words rather than a bare number. */
const OUTLOOK_WORD: Record<string, string> = {
  '-1': 'Losing it',
  '-0.5': 'Under the cosh',
  '0': 'Line ball',
  '0.5': 'On top',
  '1': 'Winning it',
}

function clampOutlook(value: number): Outlook {
  const stepped = Math.round(value / OUTLOOK_STEP) * OUTLOOK_STEP
  return Math.min(OUTLOOK_MAX, Math.max(OUTLOOK_MIN, stepped)) as Outlook
}

/**
 * A coach's own board, on their own phone.
 *
 * Writes through rather than waiting for a Save button: the thing this has to
 * survive is somebody being called to their next game mid-entry, and an unsaved
 * form is exactly how a score goes missing. The trade is that every change has
 * to say out loud whether it landed, which is what the status line is for.
 */
export function MyBoard({
  controller,
  identity,
}: {
  controller: RoundController
  identity: Identity
}) {
  const { round, aggregate, connection } = controller
  const seat = identity.board
  const board = seat ? round.boards.find((b) => b.id === seat.id) : undefined

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [at, setAt] = useState<Date | null>(null)
  /** What the coach has tapped but the server has not confirmed. */
  const [draft, setDraft] = useState<{
    aScore: number
    aInjuries: number
    bScore: number
    bInjuries: number
    period: Period
    kickoff: Kickoff
    outlook: Outlook
  } | null>(null)
  const timer = useRef<number | null>(null)

  // With no draft in flight the server's copy is what shows, so a correction
  // made by the coordinator or on another device appears here on the next poll.
  const live = draft ?? (board
    ? {
        aScore: board.a.score,
        aInjuries: board.a.injuries,
        bScore: board.b.score,
        bInjuries: board.b.injuries,
        period: board.period,
        kickoff: board.kickoff,
        outlook: board.outlook,
      }
    : null)

  const push = useCallback(
    (next: NonNullable<typeof live>) => {
      setDraft(next)
      setStatus('saving')
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(async () => {
        try {
          // The response is the round as it now stands, so adopt it rather than
          // reloading: a reload drops the app to its loading screen, and the
          // view disappearing after every tap is not a thing to do to somebody
          // entering a score at a table.
          const fresh = await saveMyBoard(next)
          controller.adoptRound(fresh)
          setDraft(null)
          setStatus('saved')
          setAt(new Date())
          setError(null)
        } catch (cause) {
          // The taps stay on screen so nothing is lost and Retry can send them.
          setStatus('failed')
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, SETTLE_MS)
    },
    [controller],
  )

  const retry = useCallback(() => {
    if (live) push(live)
  }, [live, push])

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  if (!seat || !board || !live) {
    return (
      <div className="mb">
        <p className="mb__none">
          <strong>No board for you in this round.</strong>{' '}
          {identity.nafNumber
            ? 'You are on the roster but not paired in the round on screen.'
            : 'Your login is not linked to a coach yet — ask Karl to add it.'}
        </p>
      </div>
    )
  }

  const mine = seat.side
  const locked = live.period === 'FT'

  // The whole page speaks in the coach's own terms — for and against, inflicted
  // and suffered — so the team A / team B pairs are resolved once, here.
  //
  // The four steppers are ordered so the left column is always what this coach
  // did and the right is what was done to them: for / against, inflicted /
  // suffered. Mixing those columns is how a casualty gets entered the wrong way
  // round at a noisy table.
  // `injuries` on a side means casualties that side SUFFERED, so the ones a
  // coach inflicted are the opponent's.
  const forKey = mine === 'a' ? 'aScore' : 'bScore'
  const againstKey = mine === 'a' ? 'bScore' : 'aScore'
  const sufferedKey = mine === 'a' ? 'aInjuries' : 'bInjuries'
  const inflictedKey = mine === 'a' ? 'bInjuries' : 'aInjuries'

  // Removals or players left, whichever the hall is on. In players mode the
  // two numbers stop being something each coach did to the other and become
  // what each side has on the pitch, so the labels change with them — and each
  // side counts against its own squad, which is how a Snotling team gets 14.
  const mode = round.casualtyMode
  const players = mode === 'players'
  const mySide = mine === 'a' ? board.a : board.b
  const theirSide = mine === 'a' ? board.b : board.a
  const sufferedView = casualtyView(live[sufferedKey], mySide.race, mode)
  const inflictedView = casualtyView(live[inflictedKey], theirSide.race, mode)

  // Outlook is stored from team A's point of view. A coach sitting on side B
  // would otherwise see their own good position as a negative number.
  const myOutlook = (mine === 'a' ? live.outlook : -live.outlook) as Outlook
  const setMyOutlook = (next: Outlook) =>
    push({ ...live, outlook: (mine === 'a' ? next : -next) as Outlook })
  const disabled = connection !== 'live'
  const result = resultOf({
    a: { ...board.a, score: live.aScore },
    b: { ...board.b, score: live.bScore },
  })
  // W/D/L is only ever shown from the reporting coach's own point of view.
  const myResult = mine === 'a' ? result : result === 'W' ? 'L' : result === 'L' ? 'W' : 'D'

  return (
    <div className="mb">
      <header className="mb__head">
        <span className="mb__board">Board {seat.id}</span>
        <span className="mb__vs">
          {identity.name ?? 'You'} <em>v</em> {seat.opponent}
        </span>
      </header>

      <div className="mb__scores">
        <Step
          label="TDs for"
          value={live[forKey]}
          atMin={live[forKey] <= 0}
          disabled={disabled || locked}
          onStep={(d) => push({ ...live, [forKey]: Math.max(0, live[forKey] + d) })}
        />
        <Step
          label="TDs against"
          value={live[againstKey]}
          atMin={live[againstKey] <= 0}
          disabled={disabled || locked}
          onStep={(d) => push({ ...live, [againstKey]: Math.max(0, live[againstKey] + d) })}
        />
        <Step
          label={players ? 'Their players left' : 'Removals inflicted'}
          value={inflictedView.value}
          tone="cas"
          atMin={inflictedView.atMin}
          atMax={inflictedView.atMax}
          disabled={disabled || locked}
          onStep={(d) =>
            push({ ...live, [inflictedKey]: live[inflictedKey] + casualtyStep(d, mode) })
          }
        />
        <Step
          label={players ? 'Your players left' : 'Removals suffered'}
          value={sufferedView.value}
          tone="cas"
          atMin={sufferedView.atMin}
          atMax={sufferedView.atMax}
          disabled={disabled || locked}
          onStep={(d) => push({ ...live, [sufferedKey]: live[sufferedKey] + casualtyStep(d, mode) })}
        />
      </div>

      {/* Sits with the scores because it changes as often as they do, and
          because it is the same question: how is this board going. Locked at
          full time, where the result has settled it. */}
      <div className={`mb-outlook mb-outlook--${myOutlook > 0 ? 'up' : myOutlook < 0 ? 'down' : 'level'}`}>
        <span className="mb-outlook__label">Your read</span>
        <div className="mb-outlook__row">
          <button
            type="button"
            onClick={() => setMyOutlook(clampOutlook(myOutlook - OUTLOOK_STEP))}
            disabled={disabled || locked || myOutlook <= OUTLOOK_MIN}
            aria-label="Your read, worse"
          >
            −
          </button>
          <span className="mb-outlook__value">
            <output className="mb-outlook__number">
              {myOutlook > 0 ? `+${myOutlook.toFixed(1)}` : myOutlook.toFixed(1)}
            </output>
            <span className="mb-outlook__word">{OUTLOOK_WORD[String(myOutlook)]}</span>
          </span>
          <button
            type="button"
            onClick={() => setMyOutlook(clampOutlook(myOutlook + OUTLOOK_STEP))}
            disabled={disabled || locked || myOutlook >= OUTLOOK_MAX}
            aria-label="Your read, better"
          >
            +
          </button>
        </div>
        {locked && (
          <span className="mb-outlook__note">Settled by the result at full time.</span>
        )}
      </div>

      <div className="mb__row" role="group" aria-label="Kick-off">
        <span className="mb__row-label">Kick-off</span>
        {(['K', 'R'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`mb-pill${live.kickoff === k ? ' is-on' : ''}`}
            disabled={disabled || locked}
            onClick={() => push({ ...live, kickoff: live.kickoff === k ? null : k })}
          >
            {k === 'K' ? 'Kicked' : 'Received'}
          </button>
        ))}
      </div>

      <div className="mb__row" role="group" aria-label="Period">
        <span className="mb__row-label">Period</span>
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            className={`mb-pill${live.period === p ? ' is-on' : ''}${p === 'FT' ? ' mb-pill--ft' : ''}`}
            disabled={disabled}
            onClick={() => push({ ...live, period: p })}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {locked && (
        <div className={`mb__result mb__result--${myResult.toLowerCase()}`}>
          <span className="mb__result-letter">{myResult}</span>
          <span className="mb__result-note">
            Reported final, {live.aScore}–{live.bScore}. Tap a half above to reopen it if that is
            wrong.
          </span>
        </div>
      )}

      <p className={`mb__status mb__status--${status}`} role="status">
        {status === 'saving' && 'Saving…'}
        {status === 'saved' &&
          `Saved ${at?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
        {status === 'idle' && 'Changes save on their own.'}
        {status === 'failed' && (
          <>
            <strong>Not saved.</strong> {error}{' '}
            <button type="button" className="mb-pill" onClick={retry}>
              Retry
            </button>
          </>
        )}
      </p>

      <section className="mb__round">
        <div className="mb__outlook">
          <span className="mb__outlook-label">Round outlook</span>
          <span className="mb__outlook-value">
            {aggregate > 0 ? `+${aggregate.toFixed(1)}` : aggregate.toFixed(1)}
          </span>
        </div>

        <ul className="mb__results" aria-label="Boards already finished">
          {round.boards.map((b) => {
            const done = b.period === 'FT'
            const r = done ? resultOf(b) : null
            return (
              <li key={b.id} className={`mb__pip${b.id === seat.id ? ' is-mine' : ''}`}>
                <span className="mb__pip-no">{b.id}</span>
                <span className={`mb__pip-result${r ? ` is-${r.toLowerCase()}` : ''}`}>
                  {r ?? '·'}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

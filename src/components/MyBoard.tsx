import { useCallback, useEffect, useRef, useState } from 'react'
import { saveMyBoard, type Identity } from '../api'
import type { RoundController } from '../state/useRound'
import { PERIODS, resultOf, type Kickoff, type Period } from '../types'

/** How long after the last tap the entry is sent. Long enough to coalesce a
 *  run of taps on the same stepper, short enough to feel immediate. */
const SETTLE_MS = 600

type Status = 'idle' | 'saving' | 'saved' | 'failed'

interface StepProps {
  label: string
  value: number
  tone?: 'score' | 'cas'
  disabled: boolean
  onChange: (next: number) => void
}

/** A big two-button stepper. Sized for a thumb on a phone, not a mouse. */
function Step({ label, value, tone = 'score', disabled, onChange }: StepProps) {
  return (
    <div className={`mb-step mb-step--${tone}`}>
      <span className="mb-step__label">{label}</span>
      <div className="mb-step__row">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          disabled={disabled || value === 0}
          aria-label={`${label} down`}
        >
          −
        </button>
        <output className="mb-step__value">{value}</output>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          disabled={disabled}
          aria-label={`${label} up`}
        >
          +
        </button>
      </div>
    </div>
  )
}

const PERIOD_LABEL: Record<Period, string> = { '1': '1st half', '2': '2nd half', FT: 'Full time' }

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
          label={mine === 'a' ? 'Your TDs' : `${seat.opponent} TDs`}
          value={live.aScore}
          disabled={disabled || locked}
          onChange={(aScore) => push({ ...live, aScore })}
        />
        <Step
          label={mine === 'b' ? 'Your TDs' : `${seat.opponent} TDs`}
          value={live.bScore}
          disabled={disabled || locked}
          onChange={(bScore) => push({ ...live, bScore })}
        />
        <Step
          label={mine === 'a' ? 'Your CAS' : 'Their CAS'}
          value={live.aInjuries}
          tone="cas"
          disabled={disabled || locked}
          onChange={(aInjuries) => push({ ...live, aInjuries })}
        />
        <Step
          label={mine === 'b' ? 'Your CAS' : 'Their CAS'}
          value={live.bInjuries}
          tone="cas"
          disabled={disabled || locked}
          onChange={(bInjuries) => push({ ...live, bInjuries })}
        />
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

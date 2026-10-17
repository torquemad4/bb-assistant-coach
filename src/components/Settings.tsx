import { useEffect, useState } from 'react'
import { CASUALTY_LABEL, SQUAD_DEFAULT, SQUAD_SNOTLING } from '../casualties'
import {
  enterDraw,
  loadDirectory,
  type DirectoryResult,
  type DrawPreview,
  type DrawSide,
} from '../api'
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

      <section className="set-group" aria-label="Follow the draw">
        <WatchRow controller={controller} offline={offline} />
      </section>

      <section className="set-group" aria-label="Coach directory">
        <DirectoryRow offline={offline} />
      </section>

      <section className="set-group" aria-label="Enter a draw">
        <DrawRow controller={controller} offline={offline} />
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
 * Removals or players on pitch.
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
          : `Counting players on pitch — starting at ${SQUAD_DEFAULT}, and ${SQUAD_SNOTLING} for a Snotling team.`
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

/**
 * Arms the Worker to follow this tournament's draw by itself.
 *
 * The point is that nobody has to watch Tourplay. From the start time the
 * Worker looks every minute for a draw, imports it the moment it appears, then
 * rests to five-minute checks while the round is played and speeds up again
 * when it finishes. It stops itself once the last round named here is done, so
 * an armed event cannot leave it polling for ever.
 *
 * Local time in, UTC out: a coordinator types the time on the hall clock, and
 * the input gives it back in the browser's own zone, which is the venue's.
 */
function WatchRow({
  controller,
  offline,
}: {
  controller: RoundController
  offline: boolean
}) {
  const { round } = controller
  const armed = round.watch.from !== null

  // The stored value is UTC; the input wants local wall-clock.
  const asLocalInput = (utc: string | null) => {
    if (!utc) return ''
    const d = new Date(utc.replace(' ', 'T') + 'Z')
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const [from, setFrom] = useState(() => asLocalInput(round.watch.from))
  const [until, setUntil] = useState(() => String(round.watch.untilRound ?? ''))

  // Somebody else arming it, or the watch finishing and clearing itself, has
  // to show here rather than leaving a stale form looking authoritative.
  useEffect(() => {
    setFrom(asLocalInput(round.watch.from))
    setUntil(String(round.watch.untilRound ?? ''))
  }, [round.watch.from, round.watch.untilRound])

  const untilRound = Number(until)
  const canArm =
    from !== '' && Number.isInteger(untilRound) && untilRound >= 1 && !Number.isNaN(Date.parse(from))

  return (
    <div className="set-row set-row--watch">
      <div className="set-row__text">
        <span className="set-row__label">Follow the draw</span>
        <span className="set-row__note">
          {armed ? (
            <>
              Armed. From <strong>{new Date(round.watch.from!.replace(' ', 'T') + 'Z').toLocaleString()}</strong>{' '}
              the app imports each round as it is drawn, and stops after round{' '}
              <strong>{round.watch.untilRound}</strong>. Nobody needs to press anything.
            </>
          ) : (
            <>
              Off. Give a start time and the last round worth following, and the app
              will pull each round in as it goes up — every minute while it waits for
              a draw, every five while one is being played.
            </>
          )}
        </span>
      </div>

      <div className="set-watch">
        <label className="set-watch__field">
          <span>Start</span>
          <input
            type="datetime-local"
            value={from}
            disabled={offline}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="set-watch__field set-watch__field--round">
          <span>Until round</span>
          <input
            type="number"
            min={1}
            max={20}
            value={until}
            disabled={offline}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
        <div className="set-watch__acts">
          <button
            type="button"
            className="set-btn"
            disabled={offline || !canArm}
            onClick={() =>
              controller.setWatch({ from: new Date(from).toISOString(), untilRound })
            }
          >
            {armed ? 'Update' : 'Arm'}
          </button>
          {armed && (
            <button
              type="button"
              className="set-btn set-btn--off"
              disabled={offline}
              onClick={() => controller.setWatch(null)}
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Pulls everyone entered at this tournament into the coach directory.
 *
 * A draw arrives as a photograph, and turning the names on it into NAF numbers
 * is what makes scouting work. Tourplay shows some coaches by handle and some
 * by real name, and NAF only indexes handles, so matching them up by hand is
 * slow — it cost most of an hour for four coaches the night before Eurobowl
 * XVII. Tourplay's entry list has both halves, so this fetches it once.
 *
 * It runs on the server for a reason: Tourplay's bot protection refuses
 * browsers and laptops now, but the Worker calls from Cloudflare's network.
 * If that stops working too, the error here is how we will find out.
 */
/**
 * Entering a round from a photographed draw.
 *
 * This exists because every draw at Eurobowl XVII arrived as a photograph of
 * Tourplay on a phone — their bot protection refuses us from every route we
 * have — and until now the only way to get one into the app was somebody
 * writing SQL by hand. That makes the round go up when a person is awake and at
 * a keyboard, rather than when the draw is on the wall.
 *
 * The names are the hard part, so the coach directory fills the NAF numbers.
 * Nothing is written until the preview has been read: scouting runs on those
 * numbers, and a wrong one does not fail, it quietly shows a stranger's record
 * as the opponent's.
 */
function DrawRow({ controller, offline }: RowProps) {
  const [text, setText] = useState('')
  // Defaults to the one after what is on screen, which is what a draw going up
  // almost always is. It stays editable: a round entered wrong, or a late
  // correction to one already played, both need to name their own number.
  const [roundNumber, setRoundNumber] = useState(String(controller.round.roundNumber + 1))
  const [preview, setPreview] = useState<DrawPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (confirm: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const result = await enterDraw(text, Number(roundNumber), confirm)
      if ('preview' in result) {
        setPreview(result)
      } else {
        controller.adoptRound(result)
        setPreview(null)
        setText('')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  // Editing the paste invalidates the preview: confirming a preview that no
  // longer matches what is on screen is the one way this could write something
  // nobody read.
  const edit = (next: string) => {
    setText(next)
    setPreview(null)
  }

  return (
    <div className="set-row set-row--stack">
      <div className="set-row__text">
        <span className="set-row__label">Enter a draw</span>
        <span className="set-row__note">
          One board per line, in board order — <code>Geggster vs Tok_Janne</code>. A race
          in brackets after a name is used as given; otherwise the directory supplies the
          one that coach registered. NAF numbers are filled from the directory and shown
          below before anything is written.
        </span>
      </div>

      <textarea
        className="draw-paste"
        rows={8}
        value={text}
        spellCheck={false}
        placeholder={'Geggster vs Tok_Janne\nPeteW (Black Orc) vs Umberto (Chaos Chosen)'}
        onChange={(e) => edit(e.target.value)}
        disabled={offline || busy}
        aria-label="The draw, one board per line"
      />

      <div className="draw-actions">
        <label className="draw-round">
          Round
          <input
            type="number"
            min={1}
            value={roundNumber}
            onChange={(e) => {
              setRoundNumber(e.target.value)
              setPreview(null)
            }}
            disabled={offline || busy}
          />
        </label>
        <button
          type="button"
          className="set-row__button"
          onClick={() => void run(false)}
          disabled={offline || busy || !text.trim()}
        >
          {busy && !preview ? 'Checking…' : 'Check the draw'}
        </button>
      </div>

      {error && <p className="set-row__note set-row__bad">{error}</p>}

      {preview && (
        <div className="draw-preview">
          <p className="set-row__note">
            <strong>{preview.effect}</strong>
            {preview.unresolved > 0 && (
              <>
                {' '}
                <span className="set-row__bad">
                  {preview.unresolved} of {preview.boards.length} boards have a coach with
                  no NAF number — those get no scouting, and no board of their own if they
                  sign in.
                </span>
              </>
            )}
          </p>

          <table className="draw-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Home</th>
                <th scope="col">Away</th>
              </tr>
            </thead>
            <tbody>
              {preview.boards.map((b) => (
                <tr key={b.boardNo}>
                  <td>{b.boardNo}</td>
                  <td>
                    <DrawCell side={b.a} />
                  </td>
                  <td>
                    <DrawCell side={b.b} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {preview.skipped.length > 0 && (
            <p className="set-row__note">
              Not read as fixtures, and left out: {preview.skipped.join(' / ')}
            </p>
          )}

          <button
            type="button"
            className="set-row__button"
            onClick={() => void run(true)}
            disabled={offline || busy}
          >
            {busy ? 'Entering…' : `Enter round ${preview.roundNumber}`}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * One coach in the preview, with where their number came from.
 *
 * An inferred number reads differently from a confirmed one on purpose. The
 * guessing that this replaces was wrong twice in this project's history, and
 * both times it looked exactly as confident as a correct answer.
 */
function DrawCell({ side }: { side: DrawSide }) {
  return (
    <span className="draw-cell">
      <span className="draw-cell__name">{side.nafName || side.typed}</span>
      {side.nafNumber == null ? (
        <span className="draw-cell__flag set-row__bad">no NAF number</span>
      ) : (
        <span className={side.verified ? 'draw-cell__naf' : 'draw-cell__naf set-row__bad'}>
          #{side.nafNumber}
          {!side.verified && ' — guessed from a partial name, check it'}
        </span>
      )}
      <span className="draw-cell__race">
        {side.race || 'no race'}
        {side.raceAssumed && ' (as registered)'}
      </span>
    </span>
  )
}

function DirectoryRow({ offline }: { offline: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DirectoryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await loadDirectory())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="set-row">
      <div className="set-row__text">
        <span className="set-row__label">Pre-load the coach directory</span>
        <span className="set-row__note">
          {result ? (
            <>
              <strong>
                {result.entered} entered, {result.withNafNumber} with a NAF number
              </strong>{' '}
              across {result.teams} teams.
              {result.missing.length > 0 && (
                <>
                  {' '}
                  No usable number for: {result.missing.join(', ')} — they will have no
                  scouting, and no board of their own if they sign in.
                </>
              )}
            </>
          ) : error ? (
            <span className="set-row__bad">{error}</span>
          ) : (
            <>
              Fetches everyone entered at the linked tournament from Tourplay, with their
              NAF numbers, so a name on a draw can be looked up instead of hunted down.
            </>
          )}
        </span>
      </div>
      <button type="button" className="set-btn" disabled={offline || busy} onClick={run}>
        {busy ? 'Fetching…' : result || error ? 'Fetch again' : 'Fetch'}
      </button>
    </div>
  )
}

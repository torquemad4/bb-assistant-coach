import { useCallback, useEffect, useState } from 'react'
import { fetchAdmin, setRole, setTournamentActive, type AdminState } from '../api'

/**
 * The owner's panel: who may coordinate, and which events are live.
 *
 * Only the owner reaches this, on the server as well as in the tabs, because it
 * is the one place that decides who holds the coordinator role — a panel that a
 * role it granted could open would be no gate at all.
 *
 * Deliberately plain. It is opened rarely, between events rather than during
 * one, and every control here changes what other people can do.
 */
export function Admin({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<AdminState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setState(await fetchAdmin())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Every change re-reads the panel, so what is on screen is what the server did. */
  const run = async (key: string, action: () => Promise<AdminState>) => {
    setBusy(key)
    try {
      setState(await action())
      setError(null)
      // The rest of the app may now show a different tournament, or a different
      // set of tabs for whoever this is.
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  if (!state) {
    return (
      <div className="admin">
        <p className="admin__note">{error ?? 'Loading…'}</p>
      </div>
    )
  }

  return (
    <div className="admin">
      {error && (
        <p className="admin__error" role="alert">
          {error}
        </p>
      )}

      <section className="admin__group" aria-label="Tournaments">
        <h2 className="admin__heading">Tournaments</h2>
        <p className="admin__lede">
          A live tournament holds its coaches to it — they open the app on their own boards and
          cannot wander off. A coach can only be live in one at a time, so stand one down before
          starting another that shares people.
        </p>
        <ul className="admin__list">
          {state.tournaments.map((t) => (
            <li key={t.id} className="admin__row">
              <div className="admin__row-text">
                <span className="admin__name">{t.name}</span>
                <span className="admin__meta">
                  {t.coaches === 0
                    ? 'nobody on its boards yet'
                    : `${t.coaches} coach${t.coaches === 1 ? '' : 'es'} on its boards`}
                  {t.isActive ? ' · live' : ' · standing by'}
                </span>
              </div>
              <button
                type="button"
                className={`admin__toggle${t.isActive ? ' is-on' : ''}`}
                disabled={busy !== null}
                aria-pressed={t.isActive}
                onClick={() =>
                  run(`t${t.id}`, () => setTournamentActive(t.id, !t.isActive))
                }
              >
                {busy === `t${t.id}` ? '…' : t.isActive ? 'Stand down' : 'Make live'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin__group" aria-label="People">
        <h2 className="admin__heading">People</h2>
        <p className="admin__lede">
          A coordinator gets Match Control and Settings for whichever tournament they are looking
          at. Everyone else reports their own board and reads the rest. The owner is not a rank
          above coordinator — it is this panel, and it does not move.
        </p>
        <ul className="admin__list">
          {state.people.map((p) => (
            <li key={p.email} className="admin__row">
              <div className="admin__row-text">
                <span className="admin__name">
                  {p.name ?? p.email}
                  {p.isOwner && <span className="admin__owner">owner</span>}
                </span>
                <span className="admin__meta">
                  {p.email}
                  {p.nafNumber ? ` · NAF ${p.nafNumber}` : ' · not playing'}
                </span>
              </div>
              <button
                type="button"
                className={`admin__toggle${p.isAdmin ? ' is-on' : ''}`}
                disabled={busy !== null}
                aria-pressed={p.isAdmin}
                onClick={() => run(p.email, () => setRole(p.email, !p.isAdmin))}
              >
                {busy === p.email ? '…' : p.isAdmin ? 'Coordinator' : 'Coach'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="admin__note">
        Adding somebody new takes two things: their email on the Cloudflare Access allowlist, which
        is done in Zero Trust, and a row on the roster. Without the first they cannot reach the app
        at all; without the second they can look but not report.
      </p>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { Dashboard } from './components/Dashboard'
import { PreMatch } from './components/PreMatch'
import { Selectors } from './components/Selectors'
import { FullscreenToggle } from './components/FullscreenToggle'
import { WakeToggle } from './components/WakeToggle'
import { ThemeToggle } from './components/ThemeToggle'
import { MyBoard } from './components/MyBoard'
import { useIdentity } from './state/useIdentity'
import { useRound } from './state/useRound'

type Tab = 'myboard' | 'dashboard' | 'prematch' | 'control'

export default function App() {
  const controller = useRound()
  const { round, connection, loadError, isDirty, reload } = controller
  const { identity, loaded: identityLoaded } = useIdentity()

  // Match Control can rewrite every board, so it is the coordinator's alone —
  // the server refuses a coach's write either way, but offering a control that
  // will be refused is its own kind of wrong. My Board appears only for
  // somebody who actually has one.
  const tabs = useMemo(() => {
    const list: { id: Tab; label: string }[] = []
    if (identity.board) list.push({ id: 'myboard', label: 'My Board' })
    list.push({ id: 'dashboard', label: 'Dashboard' }, { id: 'prematch', label: 'Pre-Match' })
    if (identity.isAdmin) list.push({ id: 'control', label: 'Match Control' })
    return list
  }, [identity.board, identity.isAdmin])

  // A coach opening this on their phone wants their own board, not the hall
  // dashboard. Only once identity has actually answered, or it would flick.
  const [chosen, setChosen] = useState<Tab | null>(null)
  const tab: Tab = chosen ?? (identityLoaded && identity.board ? 'myboard' : 'dashboard')
  const setTab = setChosen

  if (connection === 'loading') {
    return (
      <div className="app app--bare">
        <p className="bare__message">Loading the round…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__title">
          <h1>Round Coordinator</h1>
          <p className="topbar__sub">
            Round {round.roundNumber} of {round.totalRounds} · {round.boards.length} boards live
            {isDirty && <span className="topbar__dirty">unsaved changes</span>}
          </p>
        </div>

        {/* Shared state: switching the round moves it for every device in the
            hall, so it is the coordinator's control. The server refuses anyone
            else, but a button that will be refused should not be there. */}
        {identity.isAdmin && <Selectors {...controller} />}

        <div className="topbar__tools">
          <ThemeToggle />
          <WakeToggle />
          <FullscreenToggle />
        </div>

        <nav className="tabs" aria-label="Views">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`tabs__btn${tab === entry.id ? ' is-active' : ''}`}
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      {connection === 'offline' && (
        <div className="offline" role="alert">
          <span>
            <strong>Not connected to the database.</strong> Showing the last committed line-up;
            edits are disabled so nothing is lost. {loadError}
          </span>
          <button type="button" className="offline__retry" onClick={reload}>
            Retry
          </button>
        </div>
      )}

      {round.rostersProvisional && (
        <div className="provisional" role="status">
          <span className="provisional__tag">Provisional</span>
          <span>
            This line-up is a stand-in — coaches or races may still change. Scouting and board
            tags are only as true as the picks they were run against.
          </span>
        </div>
      )}

      <main className="stage">
        {tab === 'myboard' && <MyBoard controller={controller} identity={identity} />}
        {tab === 'dashboard' && <Dashboard {...controller} />}
        {tab === 'prematch' && <PreMatch {...controller} />}
        {tab === 'control' && identity.isAdmin && <ControlPanel {...controller} />}
      </main>
    </div>
  )
}

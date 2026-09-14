import { useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { Dashboard } from './components/Dashboard'
import { PreMatch } from './components/PreMatch'
import { Selectors } from './components/Selectors'
import { ThemeToggle } from './components/ThemeToggle'
import { useRound } from './state/useRound'

type Tab = 'dashboard' | 'prematch' | 'control'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'prematch', label: 'Pre-Match' },
  { id: 'control', label: 'Match Control' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const controller = useRound()
  const { round, connection, loadError, isDirty, reload } = controller

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

        <Selectors {...controller} />

        <ThemeToggle />

        <nav className="tabs" aria-label="Views">
          {TABS.map((entry) => (
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

      <main className="stage">
        {tab === 'dashboard' && <Dashboard {...controller} />}
        {tab === 'prematch' && <PreMatch {...controller} />}
        {tab === 'control' && <ControlPanel {...controller} />}
      </main>
    </div>
  )
}

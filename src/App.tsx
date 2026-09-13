import { useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { Dashboard } from './components/Dashboard'
import { useRound } from './state/useRound'

type Tab = 'dashboard' | 'control'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'control', label: 'Match Control' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const controller = useRound()
  const { round } = controller

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__title">
          <h1>Round Coordinator</h1>
          <p className="topbar__sub">
            Round {round.roundNumber} of {round.totalRounds} · {round.boards.length} boards live
          </p>
        </div>

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

      <main className="stage">
        {tab === 'dashboard' ? <Dashboard {...controller} /> : <ControlPanel {...controller} />}
      </main>
    </div>
  )
}

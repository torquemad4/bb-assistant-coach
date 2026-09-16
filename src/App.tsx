import { useMemo, useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { Dashboard } from './components/Dashboard'
import { PreMatch } from './components/PreMatch'
import { Selectors } from './components/Selectors'
import { FullscreenToggle } from './components/FullscreenToggle'
import { WakeToggle } from './components/WakeToggle'
import { ThemeToggle } from './components/ThemeToggle'
import { MyBoard } from './components/MyBoard'
import { Settings } from './components/Settings'
import { useIdentity } from './state/useIdentity'
import { useRound } from './state/useRound'

type Tab = 'myboard' | 'dashboard' | 'prematch' | 'control' | 'settings'

export default function App() {
  const controller = useRound()
  const { round, connection, loadError, isDirty, reload } = controller
  const { identity, loaded: identityLoaded } = useIdentity()

  // Match Control can rewrite every board, so it needs the coordinator's role —
  // held, or lent by open coordinator mode. The server decides the same way, so
  // the tab is offered exactly when a write would be accepted: a control that
  // will be refused is its own kind of wrong, and one that would be accepted
  // should not be hidden.
  //
  // Settings is the exception, and deliberately so. It holds the switch that
  // lends the role out, so it goes by the role actually held — otherwise the
  // first person handed the role could keep it, and nobody could take it back.
  //
  // My Board appears only for somebody who actually has one.
  const tabs = useMemo(() => {
    const list: { id: Tab; label: string }[] = []
    if (identity.board) list.push({ id: 'myboard', label: 'My Board' })
    list.push({ id: 'dashboard', label: 'Dashboard' }, { id: 'prematch', label: 'Pre-Match' })
    if (identity.canCoordinate) list.push({ id: 'control', label: 'Match Control' })
    if (identity.isAdmin) list.push({ id: 'settings', label: 'Settings' })
    return list
  }, [identity.board, identity.canCoordinate, identity.isAdmin])

  // A coach opening this on their phone wants their own board, not the hall
  // dashboard. Only once identity has actually answered, or it would flick.
  const [chosen, setChosen] = useState<Tab | null>(null)
  const tab: Tab = chosen ?? (identityLoaded && identity.board ? 'myboard' : 'dashboard')

  const setTab = (next: Tab) => {
    setChosen(next)
    // A view should start at its top. Worth doing explicitly because the phone
    // scrolls the page while the tablet scrolls the stage, so whichever one is
    // carrying the scroll, changing tab would otherwise drop you into the
    // middle of the new view at the old view's offset.
    window.scrollTo({ top: 0 })
    document.querySelector('.stage')?.scrollTo({ top: 0 })
  }

  if (connection === 'loading') {
    return (
      <div className="app app--bare">
        <p className="bare__message">Loading the round…</p>
      </div>
    )
  }

  return (
    <div className="app">
      {/* One bar on a tablet, two stacked pieces on a phone. The split is real
          rather than cosmetic: on a phone the tab strip stays pinned while the
          title, tools and provisional band scroll away, and a sticky element
          cannot escape its parent's box — so the piece that pins has to be a
          box of its own, outside the one that scrolls off. `.frame` dissolves
          on whichever side does not need it, which is how the tablet keeps the
          single row it has today. */}
      <header className="frame">
        <div className="topbar">
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
          {identity.canCoordinate && <Selectors {...controller} />}

          <div className="topbar__tools">
            <ThemeToggle />
            <WakeToggle />
            <FullscreenToggle />
          </div>
        </div>

        <div className="tabbar">
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
        </div>
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
        {tab === 'control' && identity.canCoordinate && <ControlPanel {...controller} />}
        {tab === 'settings' && identity.isAdmin && <Settings {...controller} />}
      </main>
    </div>
  )
}

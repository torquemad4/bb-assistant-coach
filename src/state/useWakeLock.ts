import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Holds the screen awake while the app is open.
 *
 * On by default, because the app spends all day being looked at rather than
 * touched, and a coordinator should not have to remember to switch it on. One
 * tap turns it off, and the choice is remembered per device — someone watching
 * on their own phone may well not want it.
 *
 * The browser drops the lock whenever the page stops being visible — a tab
 * switch, a manual screen-off — and does not give it back on return, so it is
 * re-taken on visibilitychange. Without that it works once and quietly stops.
 */
const KEY = 'bb-coordinator-wakelock'

type Sentinel = { released: boolean; release: () => Promise<void> } | null

function stored(): boolean {
  try {
    // Anything other than an explicit opt-out means on.
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

function available(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

export function useWakeLock() {
  const [supported] = useState(available)
  const [wanted, setWanted] = useState(stored)
  /** Whether a lock is actually held, which is not the same as wanting one. */
  const [held, setHeld] = useState(false)
  const lock = useRef<Sentinel>(null)

  const release = useCallback(async () => {
    const current = lock.current
    lock.current = null
    setHeld(false)
    if (current && !current.released) {
      try {
        await current.release()
      } catch {
        /* already gone; nothing to undo */
      }
    }
  }, [])

  const acquire = useCallback(async () => {
    if (!available() || lock.current || document.visibilityState !== 'visible') return
    try {
      const sentinel = await (navigator as any).wakeLock.request('screen')
      lock.current = sentinel
      setHeld(true)
      // Fired when the system takes it back, not only when we release it.
      sentinel.addEventListener?.('release', () => {
        if (lock.current === sentinel) lock.current = null
        setHeld(false)
      })
    } catch {
      // Refused: battery saver, a background tab, or a browser that says no.
      // The app carries on; only the screen behaves as it otherwise would.
      setHeld(false)
    }
  }, [])

  useEffect(() => {
    if (!supported) return
    if (wanted) void acquire()
    else void release()

    try {
      localStorage.setItem(KEY, wanted ? 'on' : 'off')
    } catch {
      /* not remembering the choice is not worth failing over */
    }
  }, [wanted, supported, acquire, release])

  // Re-take it on every return to visibility, or it holds exactly once.
  useEffect(() => {
    if (!supported) return
    const onVisible = () => {
      if (wanted && document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [wanted, supported, acquire])

  // Let go on unmount rather than leaving a stranded lock behind.
  useEffect(() => () => void release(), [release])

  return {
    supported,
    /** What the user asked for. */
    wanted,
    /** What the browser is actually doing about it. */
    held,
    toggle: useCallback(() => setWanted((on) => !on), []),
  }
}

import { useCallback, useEffect, useState } from 'react'
import { fetchIdentity, type Identity } from '../api'

/**
 * Who this browser belongs to, according to Cloudflare Access.
 *
 * Read once: an Access session lasts far longer than a round, and re-checking
 * on a timer would buy nothing. Until it answers, the app shows the watcher's
 * view — the safe assumption, since everything a watcher can do is read.
 */
const WATCHER: Identity = {
  state: 'verified',
  email: null,
  name: null,
  nafNumber: null,
  isAdmin: false,
  board: null,
  audChecked: false,
  reason: null,
}

export function useIdentity() {
  const [identity, setIdentity] = useState<Identity>(WATCHER)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setIdentity(await fetchIdentity(signal))
    } catch {
      // Offline, or the API is unreachable: stay a watcher. The dashboard
      // still renders from its own fallback; only editing is unavailable.
      setIdentity(WATCHER)
    } finally {
      if (!signal?.aborted) setLoaded(true)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { identity, loaded, reload: () => void load() }
}

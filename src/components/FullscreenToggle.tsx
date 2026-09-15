import { useCallback, useEffect, useState } from 'react'

/**
 * A browser with no fullscreen API at all — iPhone Safari, notably. Detected
 * rather than assumed, and the button simply is not rendered there.
 */
function supported(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.documentElement as any
  return Boolean(el.requestFullscreen ?? el.webkitRequestFullscreen)
}

function current(): boolean {
  const d = document as any
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement)
}

/**
 * Fills the screen, hiding the browser's own furniture.
 *
 * Separate from installing to the home screen, which does the same thing more
 * permanently: this works on a borrowed tablet, in one tap, with nothing to
 * set up — and it also hides the status bar, which installing does not.
 */
export function FullscreenToggle() {
  const [available] = useState(supported)
  const [isFull, setIsFull] = useState(false)

  useEffect(() => {
    const sync = () => setIsFull(current())
    sync()
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])

  const toggle = useCallback(() => {
    const d = document as any
    const el = document.documentElement as any
    // Both calls reject when the gesture is not trusted, or when the device
    // refuses outright. Nothing to recover: the browser stays as it was.
    if (current()) void (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())?.catch?.(() => {})
    else void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch?.(() => {})
  }, [])

  if (!available) return null

  return (
    <button
      type="button"
      className={`fullscreen${isFull ? ' is-on' : ''}`}
      onClick={toggle}
      title={isFull ? 'Leave full screen' : 'Fill the screen — hides the address bar'}
      aria-label={isFull ? 'Leave full screen' : 'Go full screen'}
      aria-pressed={isFull}
    >
      <span className="fullscreen__glyph" aria-hidden="true">
        {isFull ? '⇲' : '⛶'}
      </span>
    </button>
  )
}

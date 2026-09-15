import { useWakeLock } from '../state/useWakeLock'

/**
 * Keeps the tablet from sleeping mid-round.
 *
 * Shows what the browser is actually doing, not what was asked for: a lock can
 * be refused by battery saver, and a control that claims the screen will stay
 * on while it quietly sleeps is worse than no control.
 */
export function WakeToggle() {
  const { supported, wanted, held, toggle } = useWakeLock()
  if (!supported) return null

  const label = wanted ? (held ? 'Awake' : 'Asked') : 'Sleeps'
  const title = wanted
    ? held
      ? 'The screen is being kept on — tap to let it sleep'
      : 'Asked to keep the screen on, but the device refused. Battery saver is the usual reason.'
    : 'The screen may sleep — tap to keep it on'

  return (
    <button
      type="button"
      className={`wake${wanted ? (held ? ' is-on' : ' is-asked') : ''}`}
      onClick={toggle}
      title={title}
      aria-label={title}
      aria-pressed={wanted}
    >
      <span className="wake__glyph" aria-hidden="true">
        {wanted && held ? '●' : wanted ? '◍' : '○'}
      </span>
      <span className="wake__label">{label}</span>
    </button>
  )
}

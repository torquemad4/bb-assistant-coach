import { useTheme, type Theme } from '../state/useTheme'

const LABEL: Record<Theme, string> = { system: 'Auto', light: 'Light', dark: 'Dark' }
const GLYPH: Record<Theme, string> = { system: '◐', light: '☀', dark: '☾' }

/** Cycles Auto → Light → Dark. Auto follows the device. */
export function ThemeToggle() {
  const { theme, cycle } = useTheme()

  return (
    <button
      type="button"
      className="theme"
      onClick={cycle}
      title={`Theme: ${LABEL[theme]} — tap to change`}
      aria-label={`Theme: ${LABEL[theme]}. Tap to change.`}
    >
      <span className="theme__glyph" aria-hidden="true">
        {GLYPH[theme]}
      </span>
      <span className="theme__label">{LABEL[theme]}</span>
    </button>
  )
}

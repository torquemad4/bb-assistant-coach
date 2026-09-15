import { useCallback, useEffect, useState } from 'react'

/**
 * 'system' follows the device; the other two override it. Stored per device —
 * unlike the tournament selection, which is shared, the theme is a property of
 * the screen you are looking at.
 */
export type Theme = 'system' | 'light' | 'dark'

const KEY = 'bb-coordinator-theme'
const ORDER: Theme[] = ['system', 'light', 'dark']

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    // Private windows and blocked site data both throw here.
    return 'system'
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored)

  useEffect(() => {
    const root = document.documentElement
    // 'system' stamps nothing, leaving prefers-color-scheme to decide.
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* not being able to remember the choice is not worth failing over */
    }

    // Installed to a home screen, the system bars take their colour from this.
    // The two media-scoped tags in index.html cover 'system'; an explicit
    // choice has to be written here or the status bar contradicts the app.
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
    const tag = meta ?? document.head.appendChild(document.createElement('meta'))
    tag.name = 'theme-color'
    tag.content = resolved === 'dark' ? '#161b22' : '#ffffff'
  }, [theme])

  const cycle = useCallback(() => {
    setTheme((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length])
  }, [])

  return { theme, setTheme, cycle }
}

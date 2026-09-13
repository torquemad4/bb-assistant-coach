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
  }, [theme])

  const cycle = useCallback(() => {
    setTheme((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length])
  }, [])

  return { theme, setTheme, cycle }
}

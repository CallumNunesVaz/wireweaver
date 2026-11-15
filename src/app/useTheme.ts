import { useCallback, useEffect, useState } from 'react'
import type { ThemePreference } from '../ipc/contract'

const KEY = 'ww-theme'

function readPref(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

function systemDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

/**
 * Theme preference: follows the OS by default; the toggle cycles
 * system → light → dark. The resolved theme is applied to <html>.
 */
export function useTheme() {
  const [pref, setPref] = useState<ThemePreference>(readPref)
  const [osDark, setOsDark] = useState(systemDark)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const on = () => setOsDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const resolved: 'light' | 'dark' = pref === 'system' ? (osDark ? 'dark' : 'light') : pref

  useEffect(() => {
    if (resolved === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
  }, [resolved])

  const cycle = useCallback(() => {
    setPref((prev) => {
      const next: ThemePreference = prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'
      try {
        localStorage.setItem(KEY, next)
      } catch {
        /* ignore */
      }
      window.ww?.app.setTheme(next).catch(() => {})
      return next
    })
  }, [])

  return { pref, resolved, cycle }
}

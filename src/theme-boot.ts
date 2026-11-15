/**
 * Apply the stored/OS theme before React renders, so light-theme users don't
 * see a dark flash on launch. (An inline <script> would be blocked by the CSP.)
 */
try {
  const pref = localStorage.getItem('ww-theme')
  const light =
    pref === 'light' ||
    ((pref === null || pref === 'system') && window.matchMedia?.('(prefers-color-scheme: light)').matches)
  if (light) document.documentElement.setAttribute('data-theme', 'light')
} catch {
  /* storage unavailable — fall back to the dark default */
}

export {}

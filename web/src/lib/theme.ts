// Light, Dark or Auto (follow the system), for the panels. The light switch on
// the back wall flips between Light and Dark; the notice board can set it back
// to Auto. Daylight in the office follows the clock, not the theme.

export type Theme = 'system' | 'dark' | 'light'

export function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme
  return t === 'dark' || t === 'light' ? t : 'system'
}

export function isDark() {
  const t = currentTheme()
  return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
}

export function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  try {
    localStorage.setItem('hq.theme', t)
  } catch {
    // storage can be blocked; the choice still applies for this visit
  }
}

/** The light switch: up is the light theme, down is the dark one. */
export function flipLights() {
  applyTheme(isDark() ? 'light' : 'dark')
}

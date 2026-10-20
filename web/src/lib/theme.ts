// Day, Night or Auto (follow the system). The light switch by the entrance flips
// between Day and Night; the notice board can set it back to Auto.

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

/** The light switch: lights on is Day, lights off is Night. */
export function flipLights() {
  applyTheme(isDark() ? 'light' : 'dark')
}

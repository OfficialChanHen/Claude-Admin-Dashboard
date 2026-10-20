// What you were looking at, kept in this tab so a reload (from a code change,
// or F5) puts you back where you were instead of at the hub.

const PREFIX = 'hq:'

export function kept<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    return raw == null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

export function keep(key: string, value: unknown) {
  try {
    if (value == null) sessionStorage.removeItem(PREFIX + key)
    else sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: you just start at the hub next time.
  }
}

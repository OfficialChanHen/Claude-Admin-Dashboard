import fs from 'node:fs'
import { CLAUDE_CREDENTIALS, CLAUDE_STATE } from './config.js'
import { get, run } from './db.js'
import { bus } from './bus.js'

// Plan limits come from three places, newest wins:
// - the usage endpoint Claude Code itself reads, asked once a minute with the
//   login Claude Code saved. It reports usage only, so it uses no tokens.
// - the copy Claude Code keeps in ~/.claude.json (cachedUsageUtilization),
//   which only changes when Claude Code checks.
// - the status line script, which posts while a session is open.

type Window = { utilization: number | null; resets_at: string | null } | null
type Usage = {
  five_hour?: Window
  seven_day?: Window
  seven_day_opus?: Window
  seven_day_sonnet?: Window
  seven_day_breakdown?: { rows?: { key: string; display_name: string; percent: number }[] }
  extra_usage?: { is_enabled?: boolean } | null
}

export type Limits = {
  fetchedAt: number
  source: 'api' | 'cache' | 'statusline'
  fiveHour: { pct: number; resetsAt: string | null } | null
  sevenDay: { pct: number; resetsAt: string | null } | null
  sevenDayOpus: { pct: number; resetsAt: string | null } | null
  sevenDaySonnet: { pct: number; resetsAt: string | null } | null
  breakdown: { key: string; name: string; pct: number }[]
  extraUsage: boolean
}

let current: Limits | null = null

const win = (w: Window | undefined) => (w && w.utilization != null ? { pct: w.utilization, resetsAt: w.resets_at } : null)

/** Limits from a usage report, the shape both the endpoint and the saved copy use. */
export function fromUsage(u: Usage, fetchedAt: number, source: Limits['source']): Limits | null {
  if (!u || typeof u !== 'object' || (!u.five_hour && !u.seven_day)) return null
  return {
    fetchedAt,
    source,
    fiveHour: win(u.five_hour),
    sevenDay: win(u.seven_day),
    sevenDayOpus: win(u.seven_day_opus),
    sevenDaySonnet: win(u.seven_day_sonnet),
    breakdown: (u.seven_day_breakdown?.rows ?? []).map((r) => ({ key: r.key, name: r.display_name, pct: r.percent })),
    extraUsage: !!u.extra_usage?.is_enabled,
  }
}

function readCache(): Limits | null {
  try {
    const raw = JSON.parse(fs.readFileSync(CLAUDE_STATE, 'utf8')).cachedUsageUtilization
    if (!raw?.utilization) return null
    return fromUsage(raw.utilization, raw.fetchedAtMs ?? Date.now(), 'cache')
  } catch {
    return null
  }
}

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const POLL_MS = 60_000
const BACKOFF_MS = 5 * 60_000

function accessToken(): string | null {
  try {
    const creds = JSON.parse(fs.readFileSync(CLAUDE_CREDENTIALS, 'utf8'))
    const oauth = creds?.claudeAiOauth
    if (!oauth?.accessToken) return null
    // Claude Code refreshes an expired login on its next run; wait for it.
    if (oauth.expiresAt && oauth.expiresAt < Date.now()) return null
    return oauth.accessToken
  } catch {
    return null
  }
}

/** Ask the usage endpoint. Returns how long to wait before asking again. */
async function fetchUsage(): Promise<number> {
  const token = accessToken()
  if (!token) return POLL_MS
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 429) return BACKOFF_MS
    if (!res.ok) return POLL_MS
    const next = fromUsage((await res.json()) as Usage, Date.now(), 'api')
    if (next) accept(next)
  } catch {
    // Offline or the endpoint moved; the saved copy still works.
  }
  return POLL_MS
}

/**
 * Whether a new reading should replace the one on show. Newest wins, except
 * that a status line post doesn't beat a recent answer from the endpoint: the
 * status line repeats whatever its session last heard, which can be older than
 * the endpoint's answer even though it arrives later.
 */
export function shouldTake(cur: Limits | null, next: Limits, now: number): boolean {
  if (!cur) return true
  if (next.fetchedAt <= cur.fetchedAt) return false
  if (next.source === 'statusline' && cur.source === 'api' && now - cur.fetchedAt < 2 * POLL_MS) return false
  return true
}

function accept(next: Limits) {
  if (!shouldTake(current, next, Date.now())) return
  // Status line posts only carry the two main windows; keep the rest.
  current = current ? { ...current, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))) } as Limits : next
  run(
    `INSERT OR REPLACE INTO limits (fetched_at, source, five_hour_pct, five_hour_reset, seven_day_pct, seven_day_reset, raw) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    current.fetchedAt, current.source, current.fiveHour?.pct ?? null, current.fiveHour?.resetsAt ?? null,
    current.sevenDay?.pct ?? null, current.sevenDay?.resetsAt ?? null, JSON.stringify(current),
  )
  bus.publish({ kind: 'limits', limits: current })
}

export function getLimits() {
  return current
}

type StatusRateLimits = { five_hour?: { used_percentage?: number; resets_at?: number | string }; seven_day?: { used_percentage?: number; resets_at?: number | string } }

const toIso = (v: number | string | undefined) =>
  v == null ? null : typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v).toISOString() : v

export function acceptStatusLine(rl: StatusRateLimits | undefined) {
  if (!rl || (!rl.five_hour && !rl.seven_day)) return
  accept({
    fetchedAt: Date.now(),
    source: 'statusline',
    fiveHour: rl.five_hour?.used_percentage != null ? { pct: rl.five_hour.used_percentage, resetsAt: toIso(rl.five_hour.resets_at) } : null,
    sevenDay: rl.seven_day?.used_percentage != null ? { pct: rl.seven_day.used_percentage, resetsAt: toIso(rl.seven_day.resets_at) } : null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    breakdown: [],
    extraUsage: false,
  } as Limits)
}

/** The last reading HQ saved, so a restart doesn't fall back to an older copy. */
function readSaved(): Limits | null {
  try {
    const row = get<{ raw: string | null }>('SELECT raw FROM limits ORDER BY fetched_at DESC LIMIT 1')
    return row?.raw ? (JSON.parse(row.raw) as Limits) : null
  } catch {
    return null
  }
}

export function startLimits() {
  current = readSaved()
  const first = readCache()
  if (first) accept(first)
  // ~/.claude.json is rewritten in place by Claude Code; polling the mtime is the reliable way to see it.
  fs.watchFile(CLAUDE_STATE, { interval: 3000 }, () => {
    const next = readCache()
    if (next) accept(next)
  })
  const poll = async () => setTimeout(poll, await fetchUsage()).unref()
  void poll()
}

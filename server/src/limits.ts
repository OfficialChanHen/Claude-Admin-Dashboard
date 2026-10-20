import fs from 'node:fs'
import { CLAUDE_STATE } from './config.js'
import { run } from './db.js'
import { bus } from './bus.js'

// Plan limits come from the copy Claude Code keeps in ~/.claude.json
// (cachedUsageUtilization). Claude Code refreshes it on its own, so reading
// it costs nothing. The status line script can also post fresher numbers.

type Window = { utilization: number | null; resets_at: string | null } | null

export type Limits = {
  fetchedAt: number
  source: 'cache' | 'statusline'
  fiveHour: { pct: number; resetsAt: string | null } | null
  sevenDay: { pct: number; resetsAt: string | null } | null
  sevenDayOpus: { pct: number; resetsAt: string | null } | null
  sevenDaySonnet: { pct: number; resetsAt: string | null } | null
  breakdown: { key: string; name: string; pct: number }[]
  extraUsage: boolean
}

let current: Limits | null = null

const win = (w: Window) => (w && w.utilization != null ? { pct: w.utilization, resetsAt: w.resets_at } : null)

function readCache(): Limits | null {
  try {
    const raw = JSON.parse(fs.readFileSync(CLAUDE_STATE, 'utf8')).cachedUsageUtilization
    if (!raw?.utilization) return null
    const u = raw.utilization
    return {
      fetchedAt: raw.fetchedAtMs ?? Date.now(),
      source: 'cache',
      fiveHour: win(u.five_hour),
      sevenDay: win(u.seven_day),
      sevenDayOpus: win(u.seven_day_opus),
      sevenDaySonnet: win(u.seven_day_sonnet),
      breakdown: (u.seven_day_breakdown?.rows ?? []).map((r: { key: string; display_name: string; percent: number }) => ({
        key: r.key, name: r.display_name, pct: r.percent,
      })),
      extraUsage: !!u.extra_usage?.is_enabled,
    }
  } catch {
    return null
  }
}

function accept(next: Limits) {
  if (current && next.fetchedAt <= current.fetchedAt) return
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

export function startLimits() {
  const first = readCache()
  if (first) accept(first)
  // ~/.claude.json is rewritten in place by Claude Code; polling the mtime is the reliable way to see it.
  fs.watchFile(CLAUDE_STATE, { interval: 3000 }, () => {
    const next = readCache()
    if (next) accept(next)
  })
}

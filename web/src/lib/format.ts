export function tokens(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`
  return String(Math.round(n))
}

export function usd(n: number): string {
  if (n >= 100) return `$${Math.round(n).toLocaleString()}`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(2)}`
  if (n > 0) return '<$0.01'
  return '$0'
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function until(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (ms <= 0) return 'resetting now'
  const m = Math.round(ms / 60000)
  if (m < 60) return `resets in ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `resets in ${h}h ${m % 60}m`
  const d = new Date(iso)
  return `resets ${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

export function duration(ms: number | null): string {
  if (ms == null) return ''
  if (ms < 1000) return `${ms} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export function shortModel(m: string | null): string {
  if (!m) return 'unknown'
  return m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-(\d)-(\d)/, ' $1.$2').replace(/-(\d)$/, ' $1').replace(/^\w/, (c) => c.toUpperCase())
}

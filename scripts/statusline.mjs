#!/usr/bin/env node
// Claude Code status line. Passes the plan limits Claude Code hands us to HQ,
// then prints a short line. Runs locally, costs no tokens.
let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', async () => {
  let d = {}
  try {
    d = JSON.parse(input)
  } catch {}
  const port = process.env.HQ_PORT ?? 4317
  const post = fetch(`http://127.0.0.1:${port}/api/statusline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: d.session_id, rate_limits: d.rate_limits, context_window: d.context_window }),
    signal: AbortSignal.timeout(300),
  }).catch(() => {})
  const rl = d.rate_limits ?? {}
  const pct = (w) => (w?.used_percentage != null ? `${Math.round(w.used_percentage)}%` : '?')
  const parts = [d.model?.display_name ?? '', `5h ${pct(rl.five_hour)}`, `week ${pct(rl.seven_day)}`]
  if (d.context_window?.used_percentage != null) parts.push(`context ${Math.round(d.context_window.used_percentage)}%`)
  process.stdout.write(parts.filter(Boolean).join('   '))
  await post
})

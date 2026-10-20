import type { Limits, Window } from '../lib/api'
import { ago, until } from '../lib/format'
import { useNow } from '../lib/useLive'

function Meter({ label, w, now }: { label: string; w: Window; now: number }) {
  if (!w) return null
  const pct = Math.max(0, Math.min(100, w.pct))
  const level = pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : ''
  // The saved copy can be older than the window it describes.
  const stale = !!w.resetsAt && Date.parse(w.resetsAt) <= now
  return (
    <div className={`meter ${stale ? 'stale' : ''}`} role="group" aria-label={`${label} plan usage`}>
      <div className="meter-top">
        <span>{label}</span>
        <b>{Math.round(pct)}%</b>
      </div>
      <div className="meter-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`meter-fill ${level}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="meter-sub">
        {stale ? (
          'Reset since the last check'
        ) : (
          <>
            {level === 'bad' ? 'Almost out. ' : level === 'warn' ? 'Getting close. ' : ''}
            {until(w.resetsAt, now)}
          </>
        )}
      </div>
    </div>
  )
}

const SOURCE: Record<Limits['source'], string> = {
  api: 'Asked Anthropic directly, once a minute',
  cache: 'From Claude Code’s saved copy',
  statusline: 'From the Claude Code status line',
}

export function LimitsBar({ limits }: { limits: Limits | null }) {
  const now = useNow(10_000)
  if (!limits) return <div className="meter-sub">Plan limits show up after Claude Code checks them.</div>
  return (
    <div className="limits">
      <Meter label="5-hour limit" w={limits.fiveHour} now={now} />
      <Meter label="Weekly limit" w={limits.sevenDay} now={now} />
      {limits.sevenDayOpus && <Meter label="Weekly Opus" w={limits.sevenDayOpus} now={now} />}
      {limits.sevenDaySonnet && <Meter label="Weekly Sonnet" w={limits.sevenDaySonnet} now={now} />}
      <div className="meter-sub" title={SOURCE[limits.source]}>
        Checked {ago(limits.fetchedAt, now)}
      </div>
    </div>
  )
}

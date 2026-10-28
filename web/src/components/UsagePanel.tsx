import { useEffect, useState } from 'react'
import { api, type Limits, type Project, type Range, type Usage } from '../lib/api'
import { duration, shortModel, tokens, usd } from '../lib/format'
import { zoneColor } from './ProjectsPanel'

const MIX = [
  { key: 'input', label: 'New input', color: 'var(--series-1)' },
  { key: 'cacheWrite', label: 'Saved to cache', color: 'var(--series-2)' },
  { key: 'cacheRead', label: 'Read from cache', color: 'var(--series-3)' },
  { key: 'output', label: 'Written by Claude', color: 'var(--series-4)' },
] as const

type Tip = { x: number; y: number; text: string } | null

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Every day in the range gets a column, including quiet ones.
function fillDays(days: Usage['byDay'], count: number): Usage['byDay'] {
  const have = new Map(days.map((d) => [d.day, d]))
  const out: Usage['byDay'] = []
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - (count - 1))
  for (let i = 0; i < count; i++) {
    const k = dayKey(d)
    out.push(have.get(k) ?? { day: k, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 })
    d.setDate(d.getDate() + 1)
  }
  return out
}

function DayColumns({ days, onTip }: { days: Usage['byDay']; onTip: (t: Tip) => void }) {
  const max = Math.max(...days.map((d) => d.cost), 0.0001)
  const label = (d: string) => new Date(d + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' })
  return (
    <div>
      <div className="cols" role="img" aria-label="API value by day">
        {days.map((d) => (
          <div
            key={d.day}
            className="col-hit"
            onMouseMove={(e) => onTip({ x: e.clientX, y: e.clientY, text: `${label(d.day)}: ${usd(d.cost)}, ${tokens(d.output)} written, ${d.calls} calls` })}
            onMouseLeave={() => onTip(null)}
          >
            <div className="col-bar" style={{ height: `${(d.cost / max) * 100}%`, width: '100%' }} />
          </div>
        ))}
      </div>
      <div className="cols-axis">
        <span>{days[0] && label(days[0].day)}</span>
        <span>{days.length > 1 && label(days[days.length - 1].day)}</span>
      </div>
    </div>
  )
}

function Bars({ rows, onTip }: { rows: { key: string; label: React.ReactNode; value: number; tip: string }[]; onTip: (t: Tip) => void }) {
  const max = Math.max(...rows.map((r) => r.value), 0.0001)
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.key} className="bar-row" onMouseMove={(e) => onTip({ x: e.clientX, y: e.clientY, text: r.tip })} onMouseLeave={() => onTip(null)}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, display: 'block' }} /></span>
          <span className="bar-val">{usd(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function UsagePanel({
  projects,
  selected,
  limits,
  refreshKey,
  onOpenSession,
}: {
  projects: Map<string, Project>
  selected: string | null
  limits: Limits | null
  refreshKey: number
  onOpenSession: (id: string) => void
}) {
  const [range, setRange] = useState<Range>('today')
  const [data, setData] = useState<Usage | null>(null)
  const [tip, setTip] = useState<Tip>(null)

  useEffect(() => {
    let live = true
    api.usage(range, selected).then((d) => live && setData(d)).catch(() => {})
    return () => {
      live = false
    }
  }, [range, selected, refreshKey])

  const name = (id: string | null) => (id ? projects.get(id)?.name ?? id : 'Other folders')
  const t = data?.totals
  const mixTotal = t ? MIX.reduce((s, m) => s + t[m.key], 0) : 0
  const toolCost = data?.byTool.reduce((s, x) => s + x.cost, 0) ?? 0
  const context = t ? Math.max(0, t.cost - toolCost) : 0

  return (
    <section className="panel" style={{ flex: 1 }} aria-labelledby="usage-title">
      <div className="panel-head">
        <h2 className="panel-title" id="usage-title">Usage{selected ? `: ${name(selected)}` : ''}</h2>
        <div className="seg" role="group" aria-label="Time range">
          {(['today', '7d', '30d'] as Range[]).map((r) => (
            <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
              {r === 'today' ? 'Today' : r === '7d' ? '7 days' : '30 days'}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll panel-body">
        {!t ? (
          <div className="empty">Loading...</div>
        ) : (
          <>
            <div className="hero">
              <span className="hero-num">{tokens(mixTotal)}</span>
              <span className="hero-label">
                tokens across {t.calls.toLocaleString()} calls, worth {usd(t.cost)} at API prices
              </span>
            </div>

            <div className="section">
              <div className="mix" role="img" aria-label="Token mix">
                {MIX.map((m) => (
                  <span
                    key={m.key}
                    style={{ width: `${mixTotal ? (t[m.key] / mixTotal) * 100 : 0}%`, background: m.color, minWidth: t[m.key] ? 2 : 0 }}
                    onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${m.label}: ${tokens(t[m.key])}` })}
                    onMouseLeave={() => setTip(null)}
                  />
                ))}
              </div>
              <div className="tiles">
                {MIX.map((m) => (
                  <div key={m.key} className="tile">
                    <span className="tile-label"><i className="zone" style={{ background: m.color }} />{m.label}</span>
                    <span className="tile-num">{tokens(t[m.key])}</span>
                  </div>
                ))}
              </div>
              <p className="note">
                Re-reading the conversation each turn is {t.cost ? Math.round((context / t.cost) * 100) : 0}% of the value. Helpers are {t.cost ? Math.round((t.subagentCost / t.cost) * 100) : 0}%.
              </p>
            </div>

            {limits && limits.breakdown.length > 0 && !selected && (
              <div className="section">
                <h3>This week’s limit by product</h3>
                <div className="legend">
                  {limits.breakdown.filter((b) => b.pct > 0).map((b) => (
                    <span key={b.key}>{b.name} {b.pct}%</span>
                  ))}
                </div>
              </div>
            )}

            {range !== 'today' && data.byDay.length > 0 && (
              <div className="section">
                <h3>By day</h3>
                <DayColumns days={fillDays(data.byDay, range === '7d' ? 7 : 30)} onTip={setTip} />
              </div>
            )}

            {!selected && data.byProject.length > 0 && (
              <div className="section">
                <h3>By project</h3>
                <Bars
                  onTip={setTip}
                  rows={data.byProject.slice(0, 8).map((p) => ({
                    key: p.projectId ?? 'none',
                    label: <><span className="zone" style={{ background: zoneColor(p.projectId ? projects.get(p.projectId)?.color : undefined) }} />{name(p.projectId)}</>,
                    value: p.cost,
                    tip: `${name(p.projectId)}: ${tokens(p.output)} written, ${tokens(p.cacheRead)} cache reads, ${p.calls} calls`,
                  }))}
                />
              </div>
            )}

            {data.byModel.length > 1 && (
              <div className="section">
                <h3>By model</h3>
                <Bars
                  onTip={setTip}
                  rows={data.byModel.map((m) => ({ key: m.model, label: shortModel(m.model), value: m.cost, tip: `${shortModel(m.model)}: ${m.calls} calls, ${tokens(m.output)} written` }))}
                />
              </div>
            )}

            {data.byTool.length > 0 && (
              <div className="section">
                <h3>By action</h3>
                <div className="table-scroll">
                  <table className="t">
                    <thead>
                      <tr><th>Action</th><th className="num">Times</th><th className="num">Written</th><th className="num">Results</th><th className="num">Value</th></tr>
                    </thead>
                    <tbody>
                      {data.byTool.slice(0, 10).map((x) => (
                        <tr key={x.tool} title={x.avgMs != null ? `Takes ${duration(Math.round(x.avgMs))} on average${x.errors ? `, failed ${x.errors} times` : ''}` : undefined}>
                          <td>{x.tool}</td>
                          <td className="num">{x.count}</td>
                          <td className="num">{tokens(x.outputTokens)}</td>
                          <td className="num">{tokens(x.resultTokens)}</td>
                          <td className="num">{usd(x.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="note">Per-action numbers are estimates. When Claude does several things in one reply, the reply’s tokens are split between them.</p>
              </div>
            )}

            {data.topPrompts.length > 0 && (
              <div className="section">
                <h3>Biggest prompts</h3>
                <table className="t">
                  <tbody>
                    {data.topPrompts.slice(0, 8).map((p) => (
                      <tr key={p.id} className="click" onClick={() => onOpenSession(p.sessionId)}>
                        <td className="clip" title={p.text}>{p.text}</td>
                        <td className="num">{p.calls} calls</td>
                        <td className="num">{usd(p.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.topActions.length > 0 && (
              <div className="section">
                <h3>Biggest single actions</h3>
                <table className="t">
                  <tbody>
                    {data.topActions.slice(0, 8).map((a) => (
                      <tr key={a.id} className="click" onClick={() => onOpenSession(a.sessionId)}>
                        <td>{a.tool}</td>
                        <td className="clip" title={a.summary}>{a.summary}</td>
                        <td className="num">{tokens(a.outputTokens + a.resultTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      {tip && <div className="tip" style={{ left: Math.min(tip.x + 12, window.innerWidth - 300), top: tip.y + 12 }}>{tip.text}</div>}
    </section>
  )
}

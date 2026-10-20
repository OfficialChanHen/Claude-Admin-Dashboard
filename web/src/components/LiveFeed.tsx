import type { ActiveSession, Project } from '../lib/api'
import { ago, clock, tokens } from '../lib/format'
import { useNow } from '../lib/useLive'
import { zoneColor } from './ProjectsPanel'

export type FeedItem =
  | { type: 'prompt'; key: string; ts: number; sessionId: string; projectId: string | null; text: string }
  | { type: 'say'; key: string; ts: number; sessionId: string; projectId: string | null; agentId: string | null; text: string }
  | { type: 'agent'; key: string; ts: number; sessionId: string; projectId: string | null; agentId: string; description: string | null; agentType: string | null; model: string | null }
  | {
      type: 'action'; key: string; ts: number; sessionId: string; projectId: string | null; agentId: string | null
      tool: string; summary: string; requestId: string | null; done: boolean; isError: boolean; resultTokens: number
    }

const ICON: Record<string, string> = {
  Read: '▤', Edit: '✎', Write: '✚', NotebookEdit: '✎', Bash: '>_', Grep: '⌕', Glob: '⌕',
  WebSearch: '◎', WebFetch: '◎', Agent: '◆', Task: '◆', TodoWrite: '☑', Skill: '★',
}

export function LiveFeed({
  items,
  projects,
  active,
  outputShare,
  onOpenSession,
}: {
  items: FeedItem[]
  projects: Map<string, Project>
  active: ActiveSession[]
  outputShare: (requestId: string | null) => number | null
  onOpenSession: (id: string) => void
}) {
  const now = useNow(15_000)
  const name = (id: string | null) => (id ? projects.get(id)?.name ?? id : 'Other folders')
  const zone = (id: string | null) => zoneColor(id ? projects.get(id)?.color : undefined)

  return (
    <section className="panel" style={{ flex: 1 }} aria-labelledby="live-title">
      <div className="panel-head">
        <h2 className="panel-title" id="live-title">Live</h2>
        <span className="proj-meta">The world view goes here next. For now, every action as it happens.</span>
      </div>
      {active.length > 0 && (
        <div className="sessions" aria-label="Open sessions">
          {active.map((s) => (
            <button key={s.id} className={`session-card ${s.state}`} onClick={() => onOpenSession(s.id)}>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="zone" style={{ background: zone(s.projectId) }} />
                <span className="proj-meta" style={{ flex: 1 }}>{name(s.projectId)}</span>
                <span className={`chip state-${s.state} ${s.state === 'working' ? 'pulse' : ''}`}>
                  {s.state === 'waiting' ? 'Needs your OK' : s.state === 'working' ? 'Working' : s.state === 'ended' ? 'Closed' : 'Idle'}
                </span>
              </span>
              <span className="session-title">{s.title ?? 'Untitled session'}</span>
              <span className="proj-meta">{ago(s.lastAt, now)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="scroll" style={{ flex: 1 }}>
        {items.length === 0 ? (
          <div className="empty">Nothing yet. Start Claude Code in any project and its actions show up here.</div>
        ) : (
          <ol className="feed" aria-live="polite">
            {items.map((it) => {
              const head = (
                <div className="ev-sub">
                  <span className="zone" style={{ background: zone(it.projectId), display: 'inline-block', marginRight: 6, verticalAlign: -1 }} />
                  {name(it.projectId)}
                  {'agentId' in it && it.agentId && it.type !== 'agent' ? ' (helper)' : ''}
                </div>
              )
              if (it.type === 'prompt') {
                return (
                  <li key={it.key} className="ev">
                    <span className="ev-time">{clock(it.ts)}</span>
                    <span className="ev-icon" aria-hidden>?</span>
                    <div className="ev-main">
                      {head}
                      <div className="bubble you">{it.text}</div>
                    </div>
                    <span />
                  </li>
                )
              }
              if (it.type === 'say') {
                return (
                  <li key={it.key} className="ev">
                    <span className="ev-time">{clock(it.ts)}</span>
                    <span className="ev-icon" aria-hidden>“</span>
                    <div className="ev-main">
                      {head}
                      <div className="bubble">{it.text}</div>
                    </div>
                    <span />
                  </li>
                )
              }
              if (it.type === 'agent') {
                return (
                  <li key={it.key} className="ev">
                    <span className="ev-time">{clock(it.ts)}</span>
                    <span className="ev-icon" aria-hidden>◆</span>
                    <div className="ev-main">
                      {head}
                      <div className="ev-line"><span className="ev-tool">New helper</span>{it.description ?? it.agentType}</div>
                    </div>
                    <span className="ev-tokens">{it.model ?? ''}</span>
                  </li>
                )
              }
              const out = outputShare(it.requestId)
              return (
                <li key={it.key} className="ev">
                  <span className="ev-time">{clock(it.ts)}</span>
                  <span className="ev-icon" aria-hidden>{ICON[it.tool] ?? '•'}</span>
                  <div className="ev-main">
                    {head}
                    <div className="ev-line" title={it.summary}>
                      <span className="ev-tool">{it.tool}</span>
                      {it.summary}
                      {it.isError && <span className="chip err" style={{ marginLeft: 6 }}>Failed</span>}
                      {!it.done && <span className="chip state-working pulse" style={{ marginLeft: 6 }}>Running</span>}
                    </div>
                  </div>
                  <span className="ev-tokens" title="Tokens Claude wrote for this step, and tokens the result added">
                    {out != null ? `${tokens(out)} out` : ''}
                    {it.done ? ` ${tokens(it.resultTokens)} back` : ''}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}

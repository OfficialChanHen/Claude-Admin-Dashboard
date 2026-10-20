import { useEffect, useState } from 'react'
import { api, type Project, type SessionDetail } from '../lib/api'
import { PixelIcon } from './PixelIcon'
import { clock, duration, shortModel, tokens, usd } from '../lib/format'

export function SessionDrawer({ id, projects, onClose }: { id: string; projects: Map<string, Project>; onClose: () => void }) {
  const [d, setD] = useState<SessionDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.session(id).then(setD).catch((e) => setError(e.message))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, onClose])

  const agents = new Map(d?.agents.map((a) => [a.id, a]))
  const byPrompt = new Map<string, SessionDetail['actions']>()
  for (const a of d?.actions ?? []) {
    const k = a.promptId ?? ''
    byPrompt.set(k, [...(byPrompt.get(k) ?? []), a])
  }

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 className="panel-title" id="drawer-title">{d?.session.title ?? 'Session'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><PixelIcon name="close" size={12} /></button>
        </div>
        <div className="scroll panel-body">
          {error && <div className="chip err" role="alert">{error}</div>}
          {!d && !error && <div className="empty">Loading...</div>}
          {d && (
            <>
              <div className="tiles" style={{ marginBottom: 12 }}>
                <div className="tile"><span className="tile-label">Project</span><span className="tile-num">{d.session.projectId ? projects.get(d.session.projectId)?.name ?? d.session.projectId : 'Other'}</span></div>
                <div className="tile"><span className="tile-label">API value</span><span className="tile-num">{usd(d.session.costUsd ?? d.session.apiValue)}</span></div>
                <div className="tile"><span className="tile-label">Written by Claude</span><span className="tile-num">{tokens(d.session.tokens.output)}</span></div>
                <div className="tile"><span className="tile-label">Calls</span><span className="tile-num">{d.session.calls}</span></div>
              </div>
              {d.prompts.map((p) => {
                const acts = byPrompt.get(p.id) ?? []
                return (
                  <div key={p.id} className="prompt-block">
                    <div className="prompt-head">
                      <div className="prompt-text">{p.text}</div>
                      <div className="prompt-cost">
                        <b>{usd(p.cost)}</b>
                        {tokens(p.tokens.output)} written, {p.calls} calls
                        {p.subagentCost > 0 && <div>helpers {usd(p.subagentCost)}</div>}
                      </div>
                    </div>
                    {acts.length > 0 && (
                      <ul className="act-list">
                        {acts.map((a) => (
                          <li key={a.id} className="act">
                            <span>{clock(a.ts)}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.summary}>
                              <b>{a.tool}</b> {a.summary}
                              {a.agentId && <span className="proj-meta"> ({agents.get(a.agentId)?.agentType ?? 'helper'}, {shortModel(agents.get(a.agentId)?.model ?? a.model)})</span>}
                              {a.isError && <span className="chip err" style={{ marginLeft: 6 }}>Failed</span>}
                            </span>
                            <span className="num">{tokens(a.outputTokens)} out</span>
                            <span className="num hide-sm">{tokens(a.resultTokens)} back</span>
                            <span className="num hide-sm">{duration(a.ms)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
              {d.prompts.length === 0 && <div className="empty">No prompts recorded in this session.</div>}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

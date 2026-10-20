import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ActiveSession, type LiveEvent, type Project } from './lib/api'
import { useLive } from './lib/useLive'
import { LimitsBar } from './components/LimitsBar'
import { ProjectsPanel } from './components/ProjectsPanel'
import { LiveFeed, type FeedItem } from './components/LiveFeed'
import { UsagePanel } from './components/UsagePanel'
import { SessionDrawer } from './components/SessionDrawer'

const MAX_FEED = 300

function Logo() {
  // A tiny pixel house, drawn on an 8x8 grid.
  return (
    <svg className="brand-mark" viewBox="0 0 8 8" aria-hidden shapeRendering="crispEdges">
      <rect x="3" y="0" width="2" height="1" fill="var(--accent)" />
      <rect x="2" y="1" width="4" height="1" fill="var(--accent)" />
      <rect x="1" y="2" width="6" height="1" fill="var(--accent)" />
      <rect x="0" y="3" width="8" height="1" fill="var(--accent)" />
      <rect x="1" y="4" width="6" height="4" fill="var(--text-2)" />
      <rect x="3" y="5" width="2" height="3" fill="var(--bg)" />
    </svg>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme ?? 'system')
  const set = (t: string) => {
    setTheme(t)
    if (t === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = t
    try {
      localStorage.setItem('hq.theme', t)
    } catch {
      // storage can be blocked; the choice still applies for this visit
    }
  }
  return (
    <div className="seg" role="group" aria-label="Theme">
      {[['system', 'Auto'], ['dark', 'Night'], ['light', 'Day']].map(([k, l]) => (
        <button key={k} aria-pressed={theme === k} onClick={() => set(k)}>{l}</button>
      ))}
    </div>
  )
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [active, setActive] = useState<ActiveSession[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [openSession, setOpenSession] = useState<string | null>(null)
  const [usageTick, setUsageTick] = useState(0)
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null)
  const reqOutput = useRef(new Map<string, number>())
  const reqActions = useRef(new Map<string, number>())
  const seen = useRef(new Set<string>())

  const loadProjects = useCallback(() => api.projects().then(setProjects).catch(() => {}), [])
  const loadActive = useCallback(() => api.active().then(setActive).catch(() => {}), [])

  useEffect(() => {
    loadProjects()
    loadActive()
    const t = setInterval(loadActive, 60_000)
    let poll: ReturnType<typeof setTimeout>
    const check = () =>
      api.status().then((s) => {
        setBackfill(s.ready ? null : s.progress)
        if (!s.ready) poll = setTimeout(check, 1000)
        else setUsageTick((n) => n + 1)
      }).catch(() => {})
    check()
    return () => {
      clearInterval(t)
      clearTimeout(poll)
    }
  }, [loadProjects, loadActive])

  // Usage numbers refresh at most every few seconds while things are happening.
  const usageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bumpUsage = () => {
    if (usageTimer.current) return
    usageTimer.current = setTimeout(() => {
      usageTimer.current = null
      setUsageTick((n) => n + 1)
    }, 4000)
  }

  const onEvent = useCallback((ev: LiveEvent) => {
    const push = (item: FeedItem) => {
      if (seen.current.has(item.key)) return
      seen.current.add(item.key)
      setFeed((f) => [item, ...f].slice(0, MAX_FEED))
    }
    switch (ev.kind) {
      case 'projects':
        loadProjects()
        break
      case 'session':
        setActive((list) => {
          const found = list.find((s) => s.id === ev.sessionId)
          if (!found) {
            loadActive()
            return list
          }
          return list.map((s) => (s.id === ev.sessionId ? { ...s, state: ev.state, lastAt: ev.ts } : s))
        })
        break
      case 'prompt':
        push({ type: 'prompt', key: `p-${ev.sessionId}-${ev.ts}`, ts: ev.ts, sessionId: ev.sessionId, projectId: ev.projectId, text: ev.text })
        setActive((list) => (list.some((s) => s.id === ev.sessionId) ? list : (loadActive(), list)))
        break
      case 'say':
        push({ type: 'say', key: `s-${ev.sessionId}-${ev.ts}-${ev.text.length}`, ts: ev.ts, sessionId: ev.sessionId, projectId: ev.projectId, agentId: ev.agentId, text: ev.text })
        break
      case 'agent_start':
        push({ type: 'agent', key: `a-${ev.agentId}`, ts: ev.ts, sessionId: ev.sessionId, projectId: ev.projectId, agentId: ev.agentId, description: ev.description, agentType: ev.agentType, model: ev.model })
        break
      case 'action':
        if (ev.requestId) reqActions.current.set(ev.requestId, (reqActions.current.get(ev.requestId) ?? 0) + 1)
        push({
          type: 'action', key: ev.id, ts: ev.ts, sessionId: ev.sessionId, projectId: ev.projectId, agentId: ev.agentId,
          tool: ev.tool, summary: ev.summary, requestId: ev.requestId, done: false, isError: false, resultTokens: 0,
        })
        break
      case 'action_done':
        setFeed((f) => f.map((it) => (it.type === 'action' && it.key === ev.id ? { ...it, done: true, isError: ev.isError, resultTokens: ev.resultTokens } : it)))
        break
      case 'usage':
        reqOutput.current.set(ev.requestId, ev.output)
        bumpUsage()
        break
    }
  }, [loadProjects, loadActive])

  const { connected, limits } = useLive(onEvent)

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const hidden = useMemo(() => new Set(projects.filter((p) => !p.enabled).map((p) => p.id)), [projects])
  const visible = (pid: string | null) => !(pid && hidden.has(pid)) && (!selected || pid === selected)

  const outputShare = useCallback((rid: string | null) => {
    if (!rid) return null
    const out = reqOutput.current.get(rid)
    return out == null ? null : Math.round(out / Math.max(1, reqActions.current.get(rid) ?? 1))
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo />Claude HQ</div>
        <LimitsBar limits={limits} />
        <span className="conn"><span className={`dot ${connected ? 'on' : ''}`} />{connected ? 'Live' : 'Reconnecting'}</span>
        <ThemeToggle />
      </header>
      {backfill && (
        <div className="banner" role="status">Reading your past sessions: {backfill.done} of {backfill.total} logs.</div>
      )}
      <main className="main">
        <div className="col">
          <ProjectsPanel projects={projects} active={active} selected={selected} onSelect={setSelected} />
        </div>
        <div className="col">
          <LiveFeed
            items={feed.filter((f) => visible(f.projectId))}
            projects={projectMap}
            active={active.filter((s) => visible(s.projectId))}
            outputShare={outputShare}
            onOpenSession={setOpenSession}
          />
        </div>
        <div className="col usage">
          <UsagePanel projects={projectMap} selected={selected} limits={limits} refreshKey={usageTick} onOpenSession={setOpenSession} />
        </div>
      </main>
      {openSession && <SessionDrawer id={openSession} projects={projectMap} onClose={() => setOpenSession(null)} />}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type ActiveSession, type Limits, type LiveEvent, type Project } from './lib/api'
import { useLive } from './lib/useLive'
import { LimitsBar } from './components/LimitsBar'
import { ProjectEditor, ProjectsPanel } from './components/ProjectsPanel'
import { LiveFeed, type FeedItem } from './components/LiveFeed'
import { UsagePanel } from './components/UsagePanel'
import { SessionDrawer } from './components/SessionDrawer'
import { World, type WorldControl } from './components/World'
import { PromptBar, type SendOptions } from './components/PromptBar'
import { OTHER, WorldModel } from './world/model'
import { PixelIcon } from './components/PixelIcon'
import type { Hit } from './world/render'

const MAX_FEED = 300

type Win = { kind: 'projects' } | { kind: 'usage'; projectId: string | null } | { kind: 'limits' } | { kind: 'log' } | { kind: 'project'; projectId: string }

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

function MiniLimits({ limits, onOpen }: { limits: Limits | null; onOpen: () => void }) {
  const bar = (label: string, pct: number | undefined) => {
    const p = Math.max(0, Math.min(100, pct ?? 0))
    const level = p >= 90 ? 'bad' : p >= 75 ? 'warn' : ''
    return (
      <span className="mini-meter">
        <span className="mini-label">{label}</span>
        <span className="meter-bar"><span className={`meter-fill ${level}`} style={{ width: `${p}%` }} /></span>
        <b>{pct == null ? '?' : `${Math.round(p)}%`}</b>
      </span>
    )
  }
  return (
    <button className="hud-plate mini-limits" onClick={onOpen} aria-label="Plan limits">
      {bar('5h', limits?.fiveHour?.pct)}
      {bar('Week', limits?.sevenDay?.pct)}
    </button>
  )
}

function GameWindow({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="game-window" role="dialog" aria-label={title} ref={ref} tabIndex={-1}>
      <div className="game-window-head">
        <h2 className="panel-title">{title}</h2>
        <button className="icon-btn" aria-label="Close" onClick={onClose}><PixelIcon name="close" size={12} /></button>
      </div>
      <div className="game-window-body">{children}</div>
    </div>
  )
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [active, setActive] = useState<ActiveSession[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [focus, setFocus] = useState<string | null>(null)
  const [win, setWin] = useState<Win | null>(null)
  const [openSession, setOpenSession] = useState<string | null>(null)
  const [usageTick, setUsageTick] = useState(0)
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null)
  const reqOutput = useRef(new Map<string, number>())
  const reqActions = useRef(new Map<string, number>())
  const seen = useRef(new Set<string>())
  const world = useRef<WorldModel>()
  world.current ??= new WorldModel()
  const control = useRef<WorldControl | null>(null)
  const [promptFocus, setPromptFocus] = useState(0)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    world.current!.sync(active)
  }, [active])

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
    world.current!.ingest(ev)
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
          return list.map((s) => (s.id === ev.sessionId ? { ...s, state: ev.state, lastAt: ev.ts, title: ev.title ?? s.title } : s))
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
  const visible = (pid: string | null) => !(pid && hidden.has(pid))
  const waiting = active.filter((s) => visible(s.projectId) && s.state === 'waiting')

  const outputShare = useCallback((rid: string | null) => {
    if (!rid) return null
    const out = reqOutput.current.get(rid)
    return out == null ? null : Math.round(out / Math.max(1, reqActions.current.get(rid) ?? 1))
  }, [])

  const pct = (w: Limits['fiveHour'] | undefined) => (w ? `${Math.round(w.pct)}%` : '?')
  const clock = limits ? [`5h ${pct(limits.fiveHour)}`, `Week ${pct(limits.sevenDay)}`] : []

  const goToPod = (id: string) => {
    setFocus(id)
    control.current?.flyToPod(id)
    setPromptFocus((n) => n + 1)
  }

  const onHit = useCallback((h: Hit) => {
    switch (h.kind) {
      case 'sprite':
        setOpenSession(h.sessionId)
        break
      case 'facility':
        setWin(h.key === 'reception' ? { kind: 'projects' } : h.key === 'accounts' ? { kind: 'usage', projectId: null } : h.key === 'clock' ? { kind: 'limits' } : { kind: 'log' })
        break
      case 'plaque':
        setWin({ kind: 'project', projectId: h.podId })
        break
      case 'board':
        setWin({ kind: 'usage', projectId: h.podId })
        break
      case 'pod':
        if (h.podId === OTHER) break
        setFocus(h.podId)
        control.current?.flyToPod(h.podId)
        setPromptFocus((n) => n + 1)
        break
    }
  }, [])

  const closeWin = useCallback(() => setWin(null), [])
  const closeSession = useCallback(() => setOpenSession(null), [])

  let windowBody: ReactNode = null
  let windowTitle = ''
  if (win?.kind === 'projects') {
    windowTitle = 'Reception'
    windowBody = (
      <ProjectsPanel
        projects={projects}
        active={active}
        selected={focus}
        onSelect={(id) => {
          if (!id) return setFocus(null)
          goToPod(id)
          setWin(null)
        }}
      />
    )
  } else if (win?.kind === 'usage') {
    const p = win.projectId ? projectMap.get(win.projectId) : null
    windowTitle = p ? `${p.name} usage` : 'Accounts'
    windowBody = <UsagePanel projects={projectMap} selected={win.projectId} limits={limits} refreshKey={usageTick} onOpenSession={setOpenSession} />
  } else if (win?.kind === 'limits') {
    windowTitle = 'Clock'
    windowBody = (
      <div className="panel-body limits-window">
        <p className="note">How much of your Pro plan is used. Claude Code refreshes these numbers itself.</p>
        <LimitsBar limits={limits} />
      </div>
    )
  } else if (win?.kind === 'log') {
    windowTitle = 'Archive'
    windowBody = (
      <LiveFeed items={feed.filter((f) => visible(f.projectId))} projects={projectMap} active={[]} outputShare={outputShare} onOpenSession={setOpenSession} />
    )
  } else if (win?.kind === 'project') {
    const p = projectMap.get(win.projectId)
    windowTitle = p?.name ?? 'Other folders'
    windowBody = p ? (
      <div className="panel">
        <ProjectEditor key={p.id} p={p} onDone={closeWin} />
        <div className="proj-edit">
          <div className="row">
            <button className="btn small" onClick={() => setWin({ kind: 'usage', projectId: p.id })}>Usage</button>
            {p.prodUrl && <a className="btn small" href={p.prodUrl} target="_blank" rel="noreferrer">Live site</a>}
          </div>
        </div>
      </div>
    ) : (
      <p className="panel-body note">Sessions started outside your projects gather here.</p>
    )
  }

  const rooms: { label: string; hint: string; open: () => void }[] = [
    { label: 'Reception', hint: 'Projects', open: () => setWin({ kind: 'projects' }) },
    { label: 'Accounts', hint: 'Usage', open: () => setWin({ kind: 'usage', projectId: null }) },
    { label: 'Clock', hint: 'Plan limits', open: () => setWin({ kind: 'limits' }) },
    { label: 'Archive', hint: 'Action log', open: () => setWin({ kind: 'log' }) },
    { label: 'The hub', hint: 'Back to the middle', open: () => control.current?.home() },
  ]

  const send = async (text: string, opts: SendOptions) => {
    if (!focus) return
    await api.prompt({ projectId: focus, text, ...opts })
  }

  return (
    <div className="game">
      <World model={world.current!} projects={projects} clock={clock} focus={focus} onHit={onHit} control={control} />

      <header className="hud-top">
        <div className="hud-plate brand"><Logo />Claude HQ</div>
        <MiniLimits limits={limits} onOpen={() => setWin({ kind: 'limits' })} />
        <div className="rooms">
          <button className="hud-plate place" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>Rooms</button>
          {menu && (
            <div className="rooms-menu hud-plate" role="menu">
              {rooms.map((r) => (
                <button
                  key={r.label}
                  role="menuitem"
                  onClick={() => {
                    setMenu(false)
                    r.open()
                  }}
                >
                  <b>{r.label}</b>
                  <span>{r.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="hud-plate hud-right">
          <span className="conn"><span className={`dot ${connected ? 'on' : ''}`} />{connected ? 'Live' : 'Reconnecting'}</span>
          <ThemeToggle />
        </div>
      </header>

      {waiting.length > 0 && (
        <button className="hud-plate hud-waiting" onClick={() => control.current?.flyToSession(waiting[0].id)}>
          {waiting.length === 1 ? '1 session needs your OK' : `${waiting.length} sessions need your OK`}
        </button>
      )}

      <PromptBar project={focus ? projectMap.get(focus) ?? null : null} focusKey={promptFocus} onSend={send} onClear={() => setFocus(null)} />

      {backfill && (
        <div className="hud-toast" role="status">Reading your past sessions: {backfill.done} of {backfill.total} logs.</div>
      )}

      {win && (
        <GameWindow title={windowTitle} onClose={closeWin}>
          {windowBody}
        </GameWindow>
      )}
      {openSession && <SessionDrawer id={openSession} projects={projectMap} onClose={closeSession} />}
    </div>
  )
}

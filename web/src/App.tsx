import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type ActiveSession, type Approval, type LiveEvent, type Project } from './lib/api'
import { useLive } from './lib/useLive'
import { keep, kept } from './lib/keep'
import { Keep } from './components/Keep'
import { flipLights } from './lib/theme'
import { LimitsBar } from './components/LimitsBar'
import { BudgetPanel } from './components/BudgetPanel'
import { ProjectEditor, ProjectsPanel } from './components/ProjectsPanel'
import { LiveFeed, type FeedItem } from './components/LiveFeed'
import { UsagePanel } from './components/UsagePanel'
import { SessionDrawer } from './components/SessionDrawer'
import { ChatPanel } from './components/ChatPanel'
import { AskPopup } from './components/ApprovalCards'
import { World, type DoorDrop, type WorldControl } from './components/World'
import { PromptBar, type SendOptions } from './components/PromptBar'
import { OTHER, WorldModel } from './world/model'
import { HUB } from './world/office'
import { PixelIcon } from './components/PixelIcon'
import { KeyPanel } from './components/KeyPanel'
import { ClipboardPanel } from './components/ClipboardPanel'
import type { Hit } from './world/render'

const MAX_FEED = 300

type Win =
  | { kind: 'projects' } | { kind: 'usage'; projectId: string | null } | { kind: 'limits' } | { kind: 'log' } | { kind: 'project'; projectId: string }
  | { kind: 'key' } | { kind: 'clipboard'; projectId: string }

// Steps that change what is on a clipboard: a to-do list, or a helper sent off.
const PLAN_TOOLS = new Set(['TodoWrite', 'Agent', 'Task'])

/** Someone about to be sent home, waiting for you to confirm. From a drag to a door, or the button in their conversation. */
type Leaving = { key: string; sessionId: string; label: string; x: number | null; y: number | null; busy: boolean; error: string }

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

/** Asks before a session is ended. Sits by the door they were dropped at. */
function SendHomeCard({ leaving, onConfirm, onCancel }: { leaving: Leaving; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  const at = leaving.x != null && leaving.y != null
    ? { left: Math.max(12, Math.min(window.innerWidth - 332, leaving.x - 160)), top: Math.max(12, Math.min(window.innerHeight - 180, leaving.y + 24)) }
    : undefined
  return (
    <div className={`send-home ${at ? '' : 'centered'}`} style={at} role="alertdialog" aria-labelledby="send-home-title" aria-describedby="send-home-text">
      <h2 className="panel-title" id="send-home-title">Send {leaving.label} home?</h2>
      <p id="send-home-text">
        This stops the session, and any helpers it sent for. The conversation is kept, so you can carry on later with Continue last.
      </p>
      {leaving.error && <p className="chip err" role="alert">{leaving.error}</p>}
      <div className="row">
        <button ref={ref} className="btn danger" disabled={leaving.busy} onClick={onConfirm}>
          {leaving.busy ? 'Stopping...' : 'Send home'}
        </button>
        <button className="btn" onClick={onCancel}>Keep working</button>
      </div>
    </div>
  )
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [active, setActive] = useState<ActiveSession[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  // Where you were survives a reload, so a code change does not throw you back to the hub.
  const [focus, setFocus] = useState<string | null>(() => kept('focus'))
  const [room, setRoom] = useState<string | null>(() => kept('room'))
  const [win, setWin] = useState<Win | null>(null)
  // The person you clicked on: their conversation is open.
  const [selected, setSelected] = useState<string | null>(() => kept('selected'))
  // Usage details for a session, opened from its conversation or from a usage table.
  const [openSession, setOpenSession] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<Leaving | null>(null)
  const [usageTick, setUsageTick] = useState(0)
  const [budgetTick, setBudgetTick] = useState(0)
  const [clipTick, setClipTick] = useState(0)
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null)
  const reqOutput = useRef(new Map<string, number>())
  const reqActions = useRef(new Map<string, number>())
  const seen = useRef(new Set<string>())
  const planCalls = useRef(new Set<string>())
  const world = useRef<WorldModel>()
  if (!world.current) {
    world.current = new WorldModel()
    world.current.seated = new Set(kept<string[]>('people') ?? [])
  } else if (import.meta.env.DEV && Object.getPrototypeOf(world.current) !== WorldModel.prototype) {
    // A hot update to the model: everyone stays where they are and picks up the new code.
    Object.setPrototypeOf(world.current, WorldModel.prototype)
  }
  const control = useRef<WorldControl | null>(null)
  const [promptFocus, setPromptFocus] = useState(0)
  const [approvals, setApprovals] = useState<Approval[]>([])

  useEffect(() => {
    keep('room', room)
    keep('focus', focus)
    keep('selected', selected)
  }, [room, focus, selected])

  useEffect(() => {
    const save = () => keep('people', [...world.current!.sprites.values()].filter((s) => s.activity !== 'leave').map((s) => s.key))
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [])
  // The person whose "?" you clicked: their card sits over their head.
  const [asking, setAsking] = useState<{ sessionId: string; label: string } | null>(null)

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
  // Clipboards re-read soon after a plan or helper changes; a burst of changes reads once.
  const clipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bumpClip = () => {
    if (clipTimer.current) return
    clipTimer.current = setTimeout(() => {
      clipTimer.current = null
      setClipTick((n) => n + 1)
    }, 800)
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
      case 'budget':
        setBudgetTick((n) => n + 1)
        break
      case 'clipboard':
        bumpClip()
        break
      case 'hello':
        setApprovals(ev.approvals ?? [])
        break
      case 'approval':
        setApprovals((list) => [...list.filter((a) => a.id !== ev.approval.id), ev.approval])
        break
      case 'approval_done':
        setApprovals((list) => list.filter((a) => a.id !== ev.id))
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
        bumpClip()
        push({ type: 'agent', key: `a-${ev.agentId}`, ts: ev.ts, sessionId: ev.sessionId, projectId: ev.projectId, agentId: ev.agentId, description: ev.description, agentType: ev.agentType, model: ev.model })
        break
      case 'action':
        if (ev.requestId) reqActions.current.set(ev.requestId, (reqActions.current.get(ev.requestId) ?? 0) + 1)
        if (PLAN_TOOLS.has(ev.tool)) {
          planCalls.current.add(ev.id)
          bumpClip()
        }
        push({
          type: 'action', key: ev.id, ts: ev.ts, sessionId: ev.sessionId, projectId: ev.projectId, agentId: ev.agentId,
          tool: ev.tool, summary: ev.summary, requestId: ev.requestId, done: false, isError: false, resultTokens: 0,
        })
        break
      case 'action_done':
        // A helper reporting back ticks off its line.
        if (planCalls.current.delete(ev.id)) bumpClip()
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

  const outputShare = useCallback((rid: string | null) => {
    if (!rid) return null
    const out = reqOutput.current.get(rid)
    return out == null ? null : Math.round(out / Math.max(1, reqActions.current.get(rid) ?? 1))
  }, [])

  const meter = useMemo(() => ({ fiveHour: limits?.fiveHour?.pct ?? null, week: limits?.sevenDay?.pct ?? null }), [limits])

  /** Walks into a room. A project's room is also where the prompt bar sends to. */
  const enterRoom = useCallback((id: string | null) => {
    setRoom(id)
    if (id && id !== HUB && id !== OTHER) {
      setFocus(id)
      setPromptFocus((n) => n + 1)
    }
  }, [])

  // Escape steps out of a room, unless something else is open or you are typing.
  useEffect(() => {
    if (!room || win || openSession || selected || leaving || asking) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Escape' || t?.closest('input, textarea, select')) return
      setRoom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [room, win, openSession, selected, leaving, asking])

  const onHit = useCallback((h: Hit) => {
    switch (h.kind) {
      case 'sprite':
        setSelected(h.sessionId)
        break
      case 'ask':
        setAsking({ sessionId: h.sessionId, label: h.label })
        break
      case 'facility':
        if (h.key === 'lights') return flipLights()
        setWin(
          h.key === 'reception' ? { kind: 'projects' }
            : h.key === 'accounts' ? { kind: 'usage', projectId: null }
              : h.key === 'clock' || h.key === 'limits' ? { kind: 'limits' }
                : h.key === 'notice' ? { kind: 'key' }
                  : { kind: 'log' },
        )
        break
      case 'plaque':
        setWin({ kind: 'project', projectId: h.podId })
        break
      case 'board':
        setWin({ kind: 'usage', projectId: h.podId })
        break
      case 'clipboard':
        setWin({ kind: 'clipboard', projectId: h.podId })
        break
      case 'pod':
        enterRoom(h.podId)
        break
      case 'hub':
        enterRoom(HUB)
        break
    }
  }, [enterRoom])

  const closeWin = useCallback(() => setWin(null), [])
  const closeSession = useCallback(() => setOpenSession(null), [])
  const closeChat = useCallback(() => setSelected(null), [])
  const closeAsk = useCallback(() => setAsking(null), [])
  const askingId = asking?.sessionId
  const askHead = useCallback(() => (askingId ? control.current?.headOf(askingId) ?? null : null), [askingId])

  // ---- sending someone home -------------------------------------------------

  const onDoorDrop = useCallback((d: DoorDrop) => {
    setLeaving({ key: d.key, sessionId: d.sessionId, label: d.label, x: d.x, y: d.y, busy: false, error: '' })
  }, [])
  const cancelLeaving = useCallback(() => {
    // Back to work, if they were left standing at the door.
    const s = leaving ? world.current!.sprites.get(leaving.key) : undefined
    if (s?.held) world.current!.putDown(s)
    setLeaving(null)
  }, [leaving])
  const confirmLeaving = async () => {
    if (!leaving || leaving.busy) return
    setLeaving({ ...leaving, busy: true, error: '' })
    try {
      await api.stopSession(leaving.sessionId)
      world.current!.dismiss(leaving.key)
      setActive((list) => list.map((s) => (s.id === leaving.sessionId ? { ...s, state: 'ended' } : s)))
      setLeaving(null)
    } catch (e) {
      setLeaving({ ...leaving, busy: false, error: (e as Error).message })
    }
  }

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
          enterRoom(id)
          setWin(null)
        }}
      />
    )
  } else if (win?.kind === 'usage') {
    const p = win.projectId ? projectMap.get(win.projectId) : null
    windowTitle = p ? `${p.name} usage` : 'Accounts'
    windowBody = <UsagePanel projects={projectMap} selected={win.projectId} limits={limits} refreshKey={usageTick} onOpenSession={setOpenSession} />
  } else if (win?.kind === 'limits') {
    windowTitle = 'Plan meter'
    windowBody = (
      <div className="panel-body limits-window">
        <p className="note">How much of your Pro plan is used. Claude Code refreshes these numbers itself.</p>
        <LimitsBar limits={limits} />
        <BudgetPanel projects={projectMap} refreshKey={budgetTick} />
      </div>
    )
  } else if (win?.kind === 'log') {
    windowTitle = 'Archive'
    windowBody = (
      <LiveFeed items={feed.filter((f) => visible(f.projectId))} projects={projectMap} active={[]} outputShare={outputShare} onOpenSession={setSelected} />
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
            <button className="btn small" onClick={() => setWin({ kind: 'clipboard', projectId: p.id })}>Clipboard</button>
            {p.prodUrl && <a className="btn small" href={p.prodUrl} target="_blank" rel="noreferrer">Live site</a>}
          </div>
        </div>
      </div>
    ) : (
      <p className="panel-body note">Sessions started outside your projects gather here.</p>
    )
  } else if (win?.kind === 'key') {
    windowTitle = 'Notice board'
    windowBody = <KeyPanel />
  } else if (win?.kind === 'clipboard') {
    const p = projectMap.get(win.projectId)
    windowTitle = `${p?.name ?? 'Other folders'} clipboard`
    windowBody = <ClipboardPanel projectId={win.projectId} canSend={!!p} refreshKey={clipTick} onOpenSession={setSelected} />
  }

  // For keyboard and screen reader users: the same places, as a list that shows when focused.
  const roomList: { id: string; label: string }[] = [
    { id: HUB, label: 'Hub' },
    ...projects.filter((p) => p.enabled).map((p) => ({ id: p.id, label: p.name })),
    { id: OTHER, label: 'Other folders' },
  ]
  // The clipboard of the room you are in, or of the project the prompt box sends to.
  const clipFor = room && room !== HUB ? room : focus
  const services: { label: string; open: () => void }[] = [
    { label: 'Reception: projects', open: () => setWin({ kind: 'projects' }) },
    { label: 'Accounts: usage', open: () => setWin({ kind: 'usage', projectId: null }) },
    { label: 'Plan meter', open: () => setWin({ kind: 'limits' }) },
    { label: 'Archive: action log', open: () => setWin({ kind: 'log' }) },
    { label: 'Notice board: key and lighting', open: () => setWin({ kind: 'key' }) },
    ...(clipFor ? [{ label: `Clipboard: ${projectMap.get(clipFor)?.name ?? 'Other folders'} to-do list and plans`, open: () => setWin({ kind: 'clipboard', projectId: clipFor }) }] : []),
  ]
  const people = active.filter((s) => s.state !== 'ended' && visible(s.projectId))

  const send = async (text: string, opts: SendOptions) => {
    if (!focus) return
    await api.prompt({ projectId: focus, text, ...opts })
  }

  const chatSession = selected ? active.find((s) => s.id === selected) : undefined
  const chatTitle = chatSession?.title ?? world.current!.sprites.get(selected ?? '')?.label ?? 'Session'
  const chatProject = chatSession?.projectId ? projectMap.get(chatSession.projectId) ?? null : null

  return (
    <div className="game">
      <Keep name="The office">
        <World
          model={world.current!}
          projects={projects}
          focus={focus}
          room={room}
          selected={selected}
          limits={meter}
          connected={connected}
          loading={backfill ? backfill.done / Math.max(1, backfill.total) : null}
          onHit={onHit}
          onRoom={enterRoom}
          onDoorDrop={onDoorDrop}
          control={control}
        />
      </Keep>

      <nav className="sr-nav" aria-label="Places in the office">
        {roomList.map((r) => (
          <button key={r.id} aria-current={room === r.id ? 'location' : undefined} onClick={() => enterRoom(r.id)}>Go to {r.label}</button>
        ))}
        {room && <button onClick={() => setRoom(null)}>Step out to the whole floor</button>}
        {services.map((s) => <button key={s.label} onClick={s.open}>{s.label}</button>)}
        {people.map((s) => (
          <button key={s.id} onClick={() => setSelected(s.id)}>Talk to {s.title ?? 'Untitled session'}</button>
        ))}
        {people.filter((s) => approvals.some((a) => a.sessionId === s.id)).map((s) => (
          <button key={`ask-${s.id}`} onClick={() => setAsking({ sessionId: s.id, label: s.title ?? 'Untitled session' })}>
            Answer {s.title ?? 'Untitled session'}, who needs your OK
          </button>
        ))}
        <button onClick={flipLights}>Flip the lights</button>
      </nav>

      {focus && (
        <Keep name="The prompt box">
          <PromptBar project={projectMap.get(focus) ?? null} focusKey={promptFocus} onSend={send} onClear={() => setFocus(null)} />
        </Keep>
      )}

      {selected && (
        <Keep name="The conversation">
          <ChatPanel
            sessionId={selected}
            title={chatTitle}
            project={chatProject}
            feed={feed}
            model={world.current!}
            onDetails={() => setOpenSession(selected)}
            onSendHome={() => setLeaving({ key: selected, sessionId: selected, label: chatTitle, x: null, y: null, busy: false, error: '' })}
            onClose={closeChat}
          />
        </Keep>
      )}

      {asking && (
        <Keep key={asking.sessionId} name="The question">
          <AskPopup
            label={asking.label}
            approvals={approvals.filter((a) => a.sessionId === asking.sessionId)}
            headOf={askHead}
            onOpenChat={() => {
              setSelected(asking.sessionId)
              setAsking(null)
            }}
            onClose={closeAsk}
          />
        </Keep>
      )}

      {win && (
        <GameWindow title={windowTitle} onClose={closeWin}>
          <Keep key={windowTitle} name={windowTitle}>{windowBody}</Keep>
        </GameWindow>
      )}
      {leaving && <Keep name="Send home"><SendHomeCard leaving={leaving} onConfirm={confirmLeaving} onCancel={cancelLeaving} /></Keep>}
      {openSession && <Keep name="Session details"><SessionDrawer id={openSession} projects={projectMap} onClose={closeSession} /></Keep>}
    </div>
  )
}

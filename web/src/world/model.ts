import type { ActiveSession, LiveEvent, SessionState } from '../lib/api'
import { JUNIOR_SLOTS, SENIOR_SLOTS, route, type BreakSpot, type Facing, type Office, type Pod, type Point } from './office'
import { TASKS, taskOf, type Station, type TaskKind } from './tasks'

export type { Station } from './tasks'

// The people in the office. Each open session is a senior employee with a
// desk in their project's area; each subagent is a junior who comes in the
// door, gets briefed, works at a junior desk, reports back and leaves. When
// nothing is happening they take breaks, look around and doze off. The canvas
// reads this every frame; it holds no React state.

export type Bubble = { text: string; until: number; you: boolean }
export type Emote = 'idea' | 'done' | 'error' | 'ask' | 'coffee' | 'music'
export type Rank = 'senior' | 'junior'
export type Activity = 'arrive' | 'brief' | 'work' | 'break' | 'report' | 'leave'

/** What someone is busy with at a piece of furniture right now. */
export type Use = {
  at: Station | BreakSpot['kind'] | 'handoff'
  /** Doing something there, not just standing by it. */
  active: boolean
  task: TaskKind | null
}

export type Sprite = {
  key: string
  sessionId: string
  agentId: string | null
  zone: string
  rank: Rank
  x: number
  y: number
  path: Point[]
  facing: Facing
  speed: number
  seed: number
  label: string
  state: SessionState
  activity: Activity
  station: Station
  tool: string | null
  /** What the current tool is working on: a file, a command, a search. */
  summary: string
  actionId: string | null
  running: boolean
  /** When the current action started, for its animation. */
  actAt: number
  bubble: Bubble | null
  emote: { kind: Emote; until: number; since: number } | null
  lastAt: number
  /** Next time an idle person decides what to do. */
  restUntil: number
  /** Looking away from the desk until then. */
  lookUntil: number
  lookDir: Facing
  slot: number | null
  /** Juniors: the Agent call that started them, the senior, and their last line. */
  toolUseId: string | null
  bossKey: string | null
  lastSay: string
  placed: boolean
  /** Picked up by you and being carried, or waiting at the door for you to confirm. */
  held: boolean
}

export const OTHER = '_other'
export const MAX_JUNIORS_PER_SESSION = 3

const RECENT_MS = 20_000 // older events update state but show no bubbles
const HELPER_MAX_AGE_MS = 120_000
const SESSION_MAX_AGE_MS = 10 * 60_000 // matches the server's active window
const JUNIOR_DONE_MS = 25_000 // a junior with nothing running this long reports back
export const BRIEF_MS = 2200
export const REPORT_MS = 3800
const BREAK_AFTER_MS = 4000
const DOZE_AFTER_MS = 4 * 60_000

/** Where a tool is used. Most work happens at the desk. */
export function stationFor(tool: string): Station {
  return TASKS[taskOf(tool)].station
}

const DELEGATE = new Set(['Agent', 'Task'])

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function bubbleMs(text: string) {
  return Math.min(12_000, 3500 + text.length * 45)
}

export function clip(text: string, max = 160) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** What you typed, without the context blocks editors wrap around it. */
export function promptText(text: string) {
  return text.replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?(<\/\1>|$)/gi, ' ').trim()
}

export class WorldModel {
  sprites = new Map<string, Sprite>()
  office: Office | null = null
  /** Subagents past the cap, per session: shown as a count, not as people. */
  hidden = new Map<string, Map<string, number>>()
  /** People who were already in before a reload: they come back at their desks instead of walking in again. */
  seated = new Set<string>()
  private seniorDesks = new Map<string, (string | null)[]>()
  private juniorDesks = new Map<string, (string | null)[]>()
  private rand: () => number

  constructor(rand: () => number = Math.random) {
    this.rand = rand
  }

  // ---- placement -------------------------------------------------------

  setOffice(office: Office, now = Date.now()) {
    this.office = office
    this.seniorDesks.clear()
    this.juniorDesks.clear()
    for (const s of this.sprites.values()) {
      s.slot = null
      s.placed = false
    }
    // Seniors first, so juniors can find their boss.
    const all = [...this.sprites.values()].sort((a, b) => (a.rank === b.rank ? 0 : a.rank === 'senior' ? -1 : 1))
    for (const s of all) this.place(s, false, now)
  }

  pod(zone: string): Pod | null {
    return this.office?.pods.find((p) => p.id === zone) ?? null
  }

  private claim(s: Sprite) {
    const pod = this.pod(s.zone)
    if (!pod) return
    const table = s.rank === 'senior' ? this.seniorDesks : this.juniorDesks
    const size = s.rank === 'senior' ? SENIOR_SLOTS : JUNIOR_SLOTS
    const desks = table.get(pod.id) ?? Array<string | null>(size).fill(null)
    table.set(pod.id, desks)
    const i = desks.indexOf(null)
    if (i >= 0) {
      desks[i] = s.key
      s.slot = i
    }
  }

  private release(s: Sprite) {
    const table = s.rank === 'senior' ? this.seniorDesks : this.juniorDesks
    const desks = table.get(s.zone)
    if (desks && s.slot != null && desks[s.slot] === s.key) desks[s.slot] = null
    s.slot = null
  }

  /** The chair this person works from. Seniors without a free desk use the hub table. */
  seat(s: Sprite): Point | null {
    const pod = this.pod(s.zone)
    if (!pod) return null
    if (s.slot == null) {
      const spots = this.office!.breakSpots.filter((b) => b.kind === 'table')
      return spots[s.seed % spots.length] ?? pod.board
    }
    return s.rank === 'senior' ? pod.seniorSeats[s.slot] : pod.juniorSeats[s.slot]
  }

  private spotFor(s: Sprite, st: Station): Point | null {
    const pod = this.pod(s.zone)
    if (!pod) return null
    if (st === 'board') return { x: pod.board.x + ((s.seed % 3) - 1) * 10, y: pod.board.y }
    if (st === 'cabinet') return { x: pod.cabinet.x - (s.seed % 2) * 12, y: pod.cabinet.y }
    return this.seat(s)
  }

  /** Beside the boss's desk, where juniors get briefed and report back. */
  private besideBoss(s: Sprite): Point | null {
    const boss = s.bossKey ? this.sprites.get(s.bossKey) : null
    const seat = boss ? this.seat(boss) : null
    return seat ? { x: seat.x + 14, y: seat.y + 2 } : null
  }

  private walk(s: Sprite, to: Point | null) {
    if (!to || !this.office || s.held) return
    const end =s.path.length ? s.path[s.path.length - 1] : s
    if (Math.abs(end.x - to.x) < 1 && Math.abs(end.y - to.y) < 1) return
    s.path = route(this.office, { x: s.x, y: s.y }, to)
  }

  private place(s: Sprite, fromDoor: boolean, now: number) {
    if (!this.office || s.placed || !this.pod(s.zone)) return
    s.placed = true
    this.claim(s)
    const seat = this.seat(s)
    if (fromDoor) {
      s.x = this.office.door.x
      s.y = this.office.door.y
      s.path = []
      this.walk(s, s.rank === 'junior' ? this.besideBoss(s) ?? seat : seat)
    } else if (seat) {
      s.x = seat.x
      s.y = seat.y
      s.path = []
      s.facing = 'up'
      if (s.activity === 'arrive' || s.activity === 'brief' || s.activity === 'break') s.activity = 'work'
    }
    s.restUntil = now + BREAK_AFTER_MS + this.rand() * 4000
  }

  // ---- people -----------------------------------------------------------

  private make(o: { sessionId: string; agentId: string | null; zone: string; atDoor: boolean; state: SessionState; ts: number; label: string; now: number }): Sprite {
    const key = o.agentId ?? o.sessionId
    const seed = hash(key)
    const rank: Rank = o.agentId ? 'junior' : 'senior'
    const s: Sprite = {
      key, sessionId: o.sessionId, agentId: o.agentId, zone: o.zone, rank,
      x: 0, y: 0, path: [], facing: 'down', speed: rank === 'junior' ? 56 + (seed % 8) : 36 + (seed % 10),
      seed, label: o.label, state: o.state, activity: o.atDoor ? 'arrive' : 'work', station: 'desk',
      tool: null, summary: '', actionId: null, running: false, actAt: 0, bubble: null, emote: null, lastAt: o.ts,
      restUntil: 0, lookUntil: 0, lookDir: 'down', slot: null,
      toolUseId: null, bossKey: rank === 'junior' ? o.sessionId : null, lastSay: '', placed: false, held: false,
    }
    this.sprites.set(key, s)
    const back = this.seated.delete(key)
    if (back) s.activity = 'work'
    this.place(s, o.atDoor && !back, o.now)
    return s
  }

  /** Keeps one senior per open session. */
  sync(active: ActiveSession[], now = Date.now()) {
    const ids = new Set(active.map((a) => a.id))
    for (const a of active) {
      const s = this.sprites.get(a.id)
      if (s) {
        s.label = a.title ?? 'Untitled session'
        const zone = a.projectId ?? OTHER
        if (s.zone !== zone) {
          this.release(s)
          s.zone = zone
          s.placed = false
          this.place(s, false, now)
        }
        if (s.state !== a.state) this.setState(s, a.state, now)
      } else if (a.state !== 'ended') {
        this.make({ sessionId: a.id, agentId: null, zone: a.projectId ?? OTHER, atDoor: now - a.lastAt < RECENT_MS, state: a.state, ts: a.lastAt, label: a.title ?? 'Untitled session', now })
      }
    }
    for (const s of this.sprites.values()) {
      // A brand-new session can be live before the active list catches up.
      if (s.rank === 'senior' && !ids.has(s.sessionId) && s.activity !== 'leave' && now - s.lastAt > 60_000) this.setState(s, 'ended', now)
    }
  }

  private leave(s: Sprite) {
    if (s.activity === 'leave') return
    s.activity = 'leave'
    s.running = false
    s.bubble = null
    this.release(s)
    if (!this.office || !s.placed) {
      this.sprites.delete(s.key)
      return
    }
    s.path = []
    this.walk(s, this.office.door)
  }

  private setState(s: Sprite, state: SessionState, now: number) {
    const was = s.state
    s.state = state
    if (state === 'ended') {
      this.leave(s)
      for (const j of this.sprites.values()) if (j.bossKey === s.key) this.leave(j)
      return
    }
    if (state === 'idle') {
      // Finished the turn: a small cheer before the break.
      if (was === 'working' && now - s.lastAt < RECENT_MS) this.emote(s, 'done', now, 2000)
      s.running = false
      s.restUntil = now + BREAK_AFTER_MS + this.rand() * 4000
    }
    if (state === 'working' || state === 'waiting') this.backToWork(s)
  }

  private backToWork(s: Sprite) {
    if (s.activity === 'break') {
      s.activity = 'work'
      this.walk(s, this.spotFor(s, s.station))
    }
  }

  private spriteFor(ev: { sessionId: string; projectId: string | null; agentId: string | null; ts: number }, live: boolean, now: number) {
    const key = ev.agentId ?? ev.sessionId
    let s = this.sprites.get(key)
    if (!s && live) {
      if (ev.agentId && !this.roomForJunior(ev.sessionId, ev.projectId ?? OTHER)) {
        this.hide(ev.sessionId, ev.agentId, ev.ts)
        return undefined
      }
      s = this.make({
        sessionId: ev.sessionId, agentId: ev.agentId, zone: ev.projectId ?? OTHER, atDoor: true,
        state: 'working', ts: ev.ts, label: ev.agentId ? 'Junior' : 'Session', now,
      })
    }
    return s
  }

  private roomForJunior(sessionId: string, zone: string) {
    const mine = [...this.sprites.values()].filter((s) => s.rank === 'junior' && s.sessionId === sessionId && s.activity !== 'leave').length
    if (mine >= MAX_JUNIORS_PER_SESSION) return false
    const desks = this.juniorDesks.get(zone)
    return !desks || desks.includes(null)
  }

  private hide(sessionId: string, agentId: string, ts: number) {
    const m = this.hidden.get(sessionId) ?? new Map<string, number>()
    m.set(agentId, Math.max(m.get(agentId) ?? 0, ts))
    this.hidden.set(sessionId, m)
  }

  /** How many juniors a session has beyond the ones on the floor. */
  hiddenCount(sessionId: string) {
    return this.hidden.get(sessionId)?.size ?? 0
  }

  private emote(s: Sprite, kind: Emote, now: number, ms = 2500) {
    s.emote = { kind, until: now + ms, since: now }
  }

  private say(s: Sprite, text: string, now: number, you = false) {
    s.bubble = { text: clip(text), until: now + bubbleMs(text), you }
  }

  ingest(ev: LiveEvent, now = Date.now()) {
    if (!('sessionId' in ev)) return
    // Replayed history may be old: old helpers stay gone and old lines stay quiet.
    const age = now - ev.ts
    const agentId = 'agentId' in ev ? ev.agentId : null
    const live = age < (agentId ? HELPER_MAX_AGE_MS : SESSION_MAX_AGE_MS)
    const fresh = age < RECENT_MS
    if (agentId && this.hidden.get(ev.sessionId)?.has(agentId)) {
      this.hide(ev.sessionId, agentId, ev.ts)
      return
    }
    switch (ev.kind) {
      case 'agent_start': {
        if (!live) return
        const s = this.spriteFor(ev, true, now)
        if (!s) return
        s.label = ev.description ?? ev.agentType ?? 'Junior'
        s.toolUseId = ev.toolUseId ?? null
        return
      }
      case 'action': {
        const s = this.spriteFor(ev, live, now)
        if (!s) return
        s.tool = ev.tool
        s.summary = ev.summary ?? ''
        s.actionId = ev.id
        s.running = true
        s.actAt = now
        s.lastAt = Math.max(s.lastAt, ev.ts)
        if (s.rank === 'senior' && s.state !== 'waiting') s.state = 'working'
        if (ev.tool === 'AskUserQuestion') this.emote(s, 'ask', now, 6000)
        if (DELEGATE.has(ev.tool)) {
          // The senior hands out the task, out loud.
          if (fresh && ev.summary) this.say(s, ev.summary, now)
          return
        }
        s.station = stationFor(ev.tool)
        if (s.activity === 'break') s.activity = 'work'
        if (s.activity === 'work') this.walk(s, this.spotFor(s, s.station))
        return
      }
      case 'action_done': {
        const s = this.sprites.get(ev.agentId ?? ev.sessionId)
        if (s && s.actionId === ev.id) {
          s.running = false
          if (ev.isError && now - ev.ts < RECENT_MS) this.emote(s, 'error', now)
        }
        if (s) s.lastAt = Math.max(s.lastAt, ev.ts)
        // A finished Agent call means that junior's work is handed back.
        for (const j of this.sprites.values()) {
          if (j.rank === 'junior' && j.toolUseId === ev.id && j.activity !== 'report' && j.activity !== 'leave') this.report(j, now)
        }
        return
      }
      case 'say': {
        const s = this.spriteFor(ev, live, now)
        if (!s) return
        s.lastAt = Math.max(s.lastAt, ev.ts)
        if (s.rank === 'junior') s.lastSay = ev.text
        if (fresh) this.say(s, ev.text, now)
        return
      }
      case 'think': {
        // The log gets a thinking block once the thought is finished: a light bulb moment.
        const s = this.sprites.get(ev.agentId ?? ev.sessionId)
        if (s && fresh && !s.bubble) this.emote(s, 'idea', now, 1600)
        return
      }
      case 'prompt': {
        const s = this.spriteFor(ev, live, now)
        if (!s) return
        s.lastAt = Math.max(s.lastAt, ev.ts)
        if (s.state !== 'waiting') s.state = 'working'
        this.backToWork(s)
        const text = promptText(ev.text)
        if (fresh && text) this.say(s, text, now, true)
        return
      }
      case 'session': {
        const s = this.sprites.get(ev.sessionId)
        if (s && s.rank === 'senior') {
          if (ev.title) s.label = ev.title
          if (s.state !== ev.state) this.setState(s, ev.state, now)
        }
        if (ev.state === 'ended') {
          for (const j of this.sprites.values()) if (j.sessionId === ev.sessionId && j.rank === 'junior') this.leave(j)
          this.hidden.delete(ev.sessionId)
        }
        return
      }
    }
  }

  private report(j: Sprite, now: number) {
    j.activity = 'report'
    j.running = false
    j.restUntil = 0
    j.path = []
    this.walk(j, this.besideBoss(j) ?? this.office?.door ?? null)
    if (!j.path.length) this.deliver(j, now)
  }

  private deliver(j: Sprite, now: number) {
    j.facing = 'left'
    j.restUntil = now + REPORT_MS
    this.emote(j, 'done', now, REPORT_MS)
    if (j.lastSay) this.say(j, j.lastSay, now)
  }

  // ---- picking people up ------------------------------------------------------

  /** You pick someone up. Only seniors: a helper's work belongs to its session. */
  grab(key: string) {
    const s = this.sprites.get(key)
    if (!s || !s.placed || s.rank !== 'senior' || s.activity === 'leave') return null
    s.held = true
    s.path = []
    s.facing = 'down'
    return s
  }

  /** Carrying them: their feet follow the pointer. */
  carry(s: Sprite, x: number, y: number) {
    s.x = x
    s.y = y
  }

  /** Put down anywhere but the door: they walk back to what they were doing. */
  putDown(s: Sprite) {
    if (!s.held) return
    s.held = false
    s.path = []
    if (s.activity === 'break') s.activity = 'work'
    this.walk(s, this.spotFor(s, s.station))
  }

  /** Sent home: they leave through the door, and their helpers go with them. */
  dismiss(key: string, now = Date.now()) {
    const s = this.sprites.get(key)
    if (!s) return
    s.held = false
    this.setState(s, 'ended', now)
  }

  /** Waiting on the model: working, but not using a tool, saying anything or walking. */
  thinking(s: Sprite, now = Date.now()) {
    if (!s.placed || s.held || s.path.length || s.running || s.bubble || s.activity !== 'work') return false
    if (s.rank === 'senior') return s.state === 'working'
    return now - s.lastAt < JUNIOR_DONE_MS
  }

  // ---- the clock -----------------------------------------------------------

  tick(dt: number, now = Date.now()) {
    for (const s of [...this.sprites.values()]) {
      if (s.bubble && s.bubble.until < now) s.bubble = null
      if (s.emote && s.emote.until < now) s.emote = null
      if (s.held) continue
      if (!s.placed) {
        this.place(s, false, now)
        if (!s.placed) continue
      }
      const arrived = this.move(s, dt)
      this.behave(s, arrived, now)
    }
    // Forget hidden juniors that have gone quiet.
    for (const [sid, m] of this.hidden) {
      for (const [aid, ts] of m) if (now - ts > HELPER_MAX_AGE_MS) m.delete(aid)
      if (!m.size) this.hidden.delete(sid)
    }
  }

  /** Steps along the path. Returns true on the frame the person arrives. */
  private move(s: Sprite, dt: number) {
    if (!s.path.length) return false
    let budget = s.speed * dt
    while (budget > 0 && s.path.length) {
      const t = s.path[0]
      const dx = t.x - s.x
      const dy = t.y - s.y
      const d = Math.hypot(dx, dy)
      if (Math.abs(dx) > Math.abs(dy)) s.facing = dx > 0 ? 'right' : 'left'
      else if (Math.abs(dy) > 0.1) s.facing = dy > 0 ? 'down' : 'up'
      if (d <= budget) {
        s.x = t.x
        s.y = t.y
        s.path.shift()
        budget -= d
      } else {
        s.x += (dx / d) * budget
        s.y += (dy / d) * budget
        budget = 0
      }
    }
    return s.path.length === 0
  }

  private behave(s: Sprite, arrived: boolean, now: number) {
    const walking = s.path.length > 0
    switch (s.activity) {
      case 'leave':
        if (!walking) this.sprites.delete(s.key)
        return
      case 'arrive':
        if (walking) return
        if (s.rank === 'junior' && this.besideBoss(s)) {
          s.activity = 'brief'
          s.facing = 'left'
          s.restUntil = now + BRIEF_MS
        } else {
          s.activity = 'work'
          this.walk(s, this.spotFor(s, s.station))
        }
        return
      case 'brief':
        if (now < s.restUntil) return
        s.activity = 'work'
        // The walk in does not count against their quiet time.
        s.lastAt = Math.max(s.lastAt, now)
        this.walk(s, this.spotFor(s, s.station))
        return
      case 'report':
        if (walking) return
        if (arrived) return this.deliver(s, now)
        if (now >= s.restUntil) this.leave(s)
        return
      case 'work':
        if (walking) return
        if (s.rank === 'junior') {
          s.facing = 'up'
          if (!s.running && now - s.lastAt > JUNIOR_DONE_MS) this.report(s, now)
          return
        }
        if (s.state === 'waiting') {
          s.facing = 'down' // turned round to ask you
          return
        }
        if (s.state === 'idle' && now >= s.restUntil && now - s.lastAt < DOZE_AFTER_MS) {
          this.takeBreak(s, now)
          return
        }
        this.fidget(s, now)
        return
      case 'break':
        if (walking) return
        if (arrived) {
          // The break starts on arrival, so a long walk to the lounge doesn't use it up.
          s.restUntil = now + 10_000 + this.rand() * 15_000
          const spot = this.breakSpotAt(s)
          s.facing = spot?.face ?? 'down'
          if (spot?.kind === 'coffee' || spot?.kind === 'vending') this.emote(s, 'coffee', now, 3500)
          else if (this.rand() < 0.3) this.emote(s, 'music', now, 2500)
        }
        this.faceCompany(s)
        if (now >= s.restUntil) {
          if (now - s.lastAt > DOZE_AFTER_MS || this.rand() < 0.5) {
            s.activity = 'work'
            s.restUntil = now + 15_000 + this.rand() * 25_000
            this.walk(s, this.seat(s))
          } else {
            this.takeBreak(s, now)
          }
        }
        return
    }
  }

  private takeBreak(s: Sprite, now: number) {
    const spots = this.office?.breakSpots ?? []
    if (!spots.length) return
    const end = (o: Sprite) => o.path[o.path.length - 1] ?? o
    const taken = new Set([...this.sprites.values()].filter((o) => o !== s && o.activity === 'break').map((o) => `${end(o).x},${end(o).y}`))
    const free = spots.filter((b) => !taken.has(`${b.x},${b.y}`))
    const pool = free.length ? free : spots
    s.activity = 'break'
    s.restUntil = now + 10_000 + this.rand() * 15_000
    this.walk(s, pool[Math.floor(this.rand() * pool.length)])
  }

  private breakSpotAt(s: Sprite): BreakSpot | undefined {
    return this.office?.breakSpots.find((b) => Math.abs(b.x - s.x) < 1 && Math.abs(b.y - s.y) < 1)
  }

  /** Two people on a break near each other turn to chat. */
  private faceCompany(s: Sprite) {
    let best: Sprite | null = null
    let bestD = 40
    for (const o of this.sprites.values()) {
      if (o === s || o.activity !== 'break' || o.path.length) continue
      const d = Math.hypot(o.x - s.x, o.y - s.y)
      if (d < bestD) {
        best = o
        bestD = d
      }
    }
    if (!best) return
    const dx = best.x - s.x
    const dy = best.y - s.y
    s.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
  }

  /** At the desk with nothing running: glance around now and then. */
  private fidget(s: Sprite, now: number) {
    if (s.running) {
      s.facing = 'up'
      return
    }
    if (now < s.lookUntil) {
      s.facing = s.lookDir
      return
    }
    s.facing = 'up'
    if (this.rand() < 0.004) {
      const dirs: Facing[] = ['left', 'right', 'down']
      s.lookDir = dirs[Math.floor(this.rand() * dirs.length)]
      s.lookUntil = now + 900 + this.rand() * 1600
    }
  }

  /** The furniture someone is at and what they are doing there, or null while walking. */
  using(s: Sprite): Use | null {
    if (!s.placed || s.held || s.path.length) return null
    if (s.activity === 'brief' || (s.activity === 'report' && s.restUntil > 0)) return { at: 'handoff', active: true, task: null }
    if (s.activity === 'break') {
      const spot = this.breakSpotAt(s)
      return spot ? { at: spot.kind, active: true, task: null } : null
    }
    if (s.activity !== 'work') return null
    const task = s.running && s.tool ? taskOf(s.tool) : null
    // A senior without a desk of their own works from the hub table.
    if (s.station === 'desk' && s.slot == null) return null
    return { at: s.station, active: s.running, task }
  }

  /** Dozing: idle at the desk for a long time. */
  asleep(s: Sprite, now = Date.now()) {
    return s.rank === 'senior' && !s.held && s.state === 'idle' && s.activity === 'work' && !s.path.length && now - s.lastAt > DOZE_AFTER_MS
  }
}

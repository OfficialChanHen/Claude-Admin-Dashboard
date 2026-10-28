// Things that happen around the staff, from the same live events and from
// each project's git state, so watching them costs no tokens:
//
// - A commit puts a parcel on the committer's desk. The mail clerk walks in,
//   picks it up and stacks it by the front door. A push sends a delivery van
//   to collect the stack.
// - A web fetch or search brings a courier in off the street with a parcel.
//   A tool from an MCP server brings a contractor, whose van waits outside.
// - Tests that fail light a red lamp and smoke on the desk, and three in a row
//   bring out the fire extinguisher. Tests that pass light it green.
// - How lived-in a room looks: trophies for commits, dust for neglect.
// - The office cat sleeps on whichever desk is busiest.
//
// The canvas reads this every frame, like the WorldModel. Nothing here is React state.

import type { GitInfo, LiveEvent } from '../lib/api'
import { HUB, TILE, route, type Facing, type Office, type Pod, type Point, type Rect } from './office'
import type { Sprite, WorldModel } from './model'
import { ROAD, WALK } from './street'
import { Weather } from './weather'

export type NpcKind = 'clerk' | 'courier' | 'contractor' | 'cat'
export type NpcPhase = 'in' | 'hand' | 'out' | 'walk' | 'nap' | 'sit'

export type Npc = {
  id: number
  kind: NpcKind
  x: number
  y: number
  path: Point[]
  facing: Facing
  speed: number
  phase: NpcPhase
  /** When the current pause ends. */
  until: number
  carry: 'box' | 'parcel' | 'tools' | null
  /** The person they came to see, by sprite key. */
  visit: string | null
  /** The parcel they came for, for the clerk. */
  box: number | null
  /** Where the cat curls up: on a desk, or on the sofa. */
  perch: Point | null
  say: { text: string; until: number } | null
  /** The MCP server a contractor works for. */
  server: string | null
  seed: number
}

/** A parcel waiting on a desk for the clerk: one per commit. */
export type Parcel = { id: number; zone: string; x: number; y: number; subject: string | null; since: number }

export type Van = {
  id: number
  kind: 'delivery' | 'company'
  x: number
  y: number
  /** Where it parks, and where it drives off to. */
  stop: number
  state: 'arrive' | 'park' | 'leave'
  until: number
  server: string | null
  color: number
}

export type Drama = { kind: 'fail' | 'pass' | 'fixed'; since: number; streak: number }

/** How lived-in a room looks: trophies for commits, dust and dim lights for neglect. */
export type RoomAge = { trophies: 0 | 1 | 2 | 3; dust: 0 | 1 | 2 }

const FRESH_MS = 20_000 // older events are history: no visitors for them
const WALK_SPEED = 34
const CAT_SPEED = 26
const HAND_MS = 1800
const DRAMA_MS = 6000
const VAN_SPEED = 70
const PARK_MS = 3500
const MAX_VISITORS = 6
const MAX_STACK = 6
export const TROPHY_AT = [10, 100, 500] as const
export const DUSTY_DAYS = 14
export const ABANDONED_DAYS = 45

/** Shell commands that look like a test run, from the step's description or command. */
export const TEST_RE = /\b(tests?|vitest|jest|pytest|mocha|spec|e2e)\b/i
const VISIT_TOOLS = new Set(['WebFetch', 'WebSearch'])
const OWN_SERVER = 'claude_hq'

/** The TV on a room's back wall, right of the name plate. */
export function tvRect(pod: Pick<Pod, 'plate'>): Rect {
  return { x: pod.plate.x + pod.plate.w + 3, y: pod.plate.y, w: 22, h: pod.plate.h }
}

/** The trophy shelf on a room's back wall, left of the name plate. */
export function shelfRect(pod: Pick<Pod, 'rect' | 'plate'>): Rect {
  return { x: pod.rect.x + 2, y: pod.plate.y, w: 10, h: pod.plate.h }
}

export function roomAge(info: Pick<GitInfo, 'commits' | 'lastActiveAt'> | undefined, now: number): RoomAge {
  if (!info) return { trophies: 0, dust: 0 }
  const trophies = TROPHY_AT.filter((n) => info.commits >= n).length as RoomAge['trophies']
  const days = info.lastActiveAt ? (now - info.lastActiveAt) / 86_400_000 : 0
  return { trophies, dust: days > ABANDONED_DAYS ? 2 : days > DUSTY_DAYS ? 1 : 0 }
}

/** The MCP server a tool belongs to: `mcp__github__create_issue` is from `github`. */
export function serverOf(tool: string) {
  if (!tool.startsWith('mcp__')) return null
  const name = tool.split('__')[1]
  return name && name !== OWN_SERVER ? name : null
}

/** What a visitor says when they hand something over. */
export function visitLine(tool: string, summary: string) {
  const s = summary.replace(/\s+/g, ' ').trim()
  const short = s.length > 34 ? `${s.slice(0, 33)}…` : s
  if (tool === 'WebSearch') return short ? `Results for "${short}"` : 'Search results'
  if (tool === 'WebFetch') return short ? `Delivery from ${short}` : 'A delivery'
  const server = serverOf(tool)
  return server ? `${server} here, on the job` : 'On the job'
}

function hashOf(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export class Extras {
  npcs: Npc[] = []
  parcels: Parcel[] = []
  /** Parcels stacked by the front door, waiting for a push. */
  stack = 0
  vans: Van[] = []
  drama = new Map<string, Drama>()
  git = new Map<string, GitInfo>()
  weather = new Weather()
  cat: Npc | null = null
  private nextId = 1
  private tests = new Map<string, string>() // action id -> sprite key
  private streaks = new Map<string, number>()
  private rand: () => number

  constructor(rand: () => number = Math.random) {
    this.rand = rand
  }

  setGit(list: GitInfo[]) {
    this.git = new Map(list.map((g) => [g.projectId, g]))
    // The stack by the door is the commits not pushed yet, unless the clerk or the van is busy with it.
    if (!this.npcs.some((n) => n.kind === 'clerk') && !this.vans.some((v) => v.kind === 'delivery')) {
      this.stack = Math.min(MAX_STACK, list.reduce((n, g) => n + (g.ahead ?? 0), 0))
    }
  }

  /** The lane in front of the building where vans pull up. */
  laneY(office: Office) {
    return office.h + WALK * TILE + (ROAD * TILE) / 4
  }

  /** Where the outbox stack stands, on the sidewalk by the front door. */
  stackAt(office: Office): Point {
    return { x: office.door.x + 20, y: office.door.y + 2 }
  }

  // ---- events ----------------------------------------------------------------

  ingest(ev: LiveEvent, model: WorldModel, now = Date.now()) {
    if (ev.kind === 'git') {
      if (now - ev.ts > FRESH_MS) return
      if (ev.change === 'commit') this.commit(ev.projectId, ev.subject, model, now)
      else this.push(model, now)
      return
    }
    if (!('sessionId' in ev) || !('ts' in ev)) return
    const fresh = now - ev.ts < FRESH_MS
    const key = ('agentId' in ev && ev.agentId) || ev.sessionId
    if (ev.kind === 'action') {
      if (ev.tool === 'Bash' && TEST_RE.test(ev.summary)) {
        if (this.tests.size > 200) this.tests.clear()
        this.tests.set(ev.id, key)
      }
      if (!fresh) return
      const server = serverOf(ev.tool)
      if (VISIT_TOOLS.has(ev.tool) || server) this.visitor(key, ev.tool, ev.summary, server, model, now)
      return
    }
    if (ev.kind === 'action_done') {
      const who = this.tests.get(ev.id)
      if (!who) return
      this.tests.delete(ev.id)
      if (!fresh) return
      const streak = ev.isError ? (this.streaks.get(who) ?? 0) + 1 : 0
      const before = this.streaks.get(who) ?? 0
      this.streaks.set(who, streak)
      this.drama.set(who, { kind: ev.isError ? 'fail' : before > 0 ? 'fixed' : 'pass', since: now, streak })
    }
  }

  /** The senior in a room who worked last: their desk gets the parcel. */
  private committer(zone: string, model: WorldModel): Sprite | null {
    let best: Sprite | null = null
    for (const s of model.sprites.values()) {
      if (s.zone !== zone || s.rank !== 'senior' || s.slot == null || !s.placed || s.activity === 'leave') continue
      if (!best || s.lastAt > best.lastAt) best = s
    }
    return best
  }

  commit(zone: string, subject: string | null, model: WorldModel, now: number) {
    const office = model.office
    const pod = model.pod(zone)
    if (!office || !pod) return
    const s = this.committer(zone, model)
    const slot = s?.slot ?? 0
    const desk = pod.seniorDesks[slot]
    const seat = pod.seniorSeats[slot]
    const id = this.nextId++
    // Parcels on one desk sit side by side.
    const onDesk = this.parcels.filter((p) => p.zone === zone && Math.abs(p.y - (desk.y + 4)) < 1).length
    this.parcels.push({ id, zone, x: desk.x + 3 + (onDesk % 3) * 6, y: desk.y + 4, subject, since: now })
    if (this.visitors() >= MAX_VISITORS) return
    const clerk = this.spawn('clerk', office.door, now)
    clerk.box = id
    clerk.visit = s?.key ?? null
    this.walk(clerk, office, { x: seat.x + 12, y: seat.y })
  }

  push(model: WorldModel, now: number) {
    const office = model.office
    if (!office) return
    // One van at a time collects; a second push while it is here rides along.
    if (this.vans.some((v) => v.kind === 'delivery' && v.state !== 'leave')) return
    this.vans.push({
      id: this.nextId++, kind: 'delivery', x: office.w + 240, y: this.laneY(office), stop: office.door.x + 34,
      state: 'arrive', until: 0, server: null, color: 0,
    })
  }

  private visitor(key: string, tool: string, summary: string, server: string | null, model: WorldModel, now: number) {
    const office = model.office
    const s = model.sprites.get(key)
    if (!office || !s?.placed || s.activity === 'leave' || s.zone === HUB) return
    // One visitor per person at a time, and only so many in the building.
    if (this.npcs.some((n) => n.visit === key && n.kind !== 'clerk') || this.visitors() >= MAX_VISITORS) return
    const seat = model.seat(s)
    if (!seat) return
    const v = this.spawn(server ? 'contractor' : 'courier', office.door, now)
    v.visit = key
    v.carry = server ? 'tools' : 'parcel'
    v.server = server
    v.say = { text: visitLine(tool, summary), until: 0 } // said on arrival
    this.walk(v, office, { x: seat.x + 12, y: seat.y })
    if (server && !this.vans.some((x) => x.kind === 'company' && x.server === server && x.state !== 'leave')) {
      this.vans.push({
        id: this.nextId++, kind: 'company', x: office.w + 240, y: this.laneY(office), stop: office.door.x - 40,
        state: 'arrive', until: 0, server, color: hashOf(server) % 5,
      })
    }
  }

  /** You clicked the cat. */
  pet(now = Date.now()) {
    if (!this.cat) return
    this.cat.say = { text: this.rand() < 0.5 ? 'Mrrp' : 'Purr', until: now + 2200 }
  }

  private visitors() {
    return this.npcs.filter((n) => n.kind !== 'cat').length
  }

  private spawn(kind: NpcKind, at: Point, now: number): Npc {
    const n: Npc = {
      id: this.nextId++, kind, x: at.x, y: at.y, path: [], facing: 'up', speed: kind === 'cat' ? CAT_SPEED : WALK_SPEED + this.rand() * 8,
      phase: 'in', until: now, carry: null, visit: null, box: null, perch: null, say: null, server: null, seed: Math.floor(this.rand() * 1e9),
    }
    if (kind === 'cat') this.cat = n
    else this.npcs.push(n)
    return n
  }

  private walk(n: Npc, office: Office, to: Point) {
    n.path = route(office, { x: n.x, y: n.y }, to)
  }

  // ---- the clock ---------------------------------------------------------------

  tick(dt: number, model: WorldModel, now = Date.now()) {
    const office = model.office
    if (!office) return
    for (const n of [...this.npcs]) {
      if (n.say && n.say.until && n.say.until < now) n.say = null
      const arrived = this.move(n, dt)
      this.behave(n, arrived, office, model, now)
    }
    for (const [k, d] of this.drama) if (now - d.since > DRAMA_MS) this.drama.delete(k)
    // Parcels nobody came for (too many visitors) go out with the next clerk round.
    this.parcels = this.parcels.filter((p) => now - p.since < 5 * 60_000)
    this.tickVans(dt, office, now)
    this.tickCat(dt, office, model, now)
  }

  /** Steps along the path. Returns true on the frame they arrive. */
  private move(n: Npc, dt: number) {
    if (!n.path.length) return false
    let budget = n.speed * dt
    while (budget > 0 && n.path.length) {
      const t = n.path[0]
      const dx = t.x - n.x
      const dy = t.y - n.y
      const d = Math.hypot(dx, dy)
      if (Math.abs(dx) > Math.abs(dy)) n.facing = dx > 0 ? 'right' : 'left'
      else if (Math.abs(dy) > 0.1) n.facing = dy > 0 ? 'down' : 'up'
      if (d <= budget) {
        n.x = t.x
        n.y = t.y
        n.path.shift()
        budget -= d
      } else {
        n.x += (dx / d) * budget
        n.y += (dy / d) * budget
        budget = 0
      }
    }
    return n.path.length === 0
  }

  private behave(n: Npc, arrived: boolean, office: Office, model: WorldModel, now: number) {
    if (n.path.length) return
    switch (n.phase) {
      case 'in':
        if (!arrived) return
        n.phase = 'hand'
        n.facing = 'left'
        n.until = now + HAND_MS
        if (n.kind === 'clerk') {
          // Picks the parcel up off the desk and says what is being shipped.
          const p = this.parcels.find((x) => x.id === n.box)
          this.parcels = this.parcels.filter((x) => x.id !== n.box)
          n.carry = 'box'
          n.say = { text: p?.subject ? `Shipping "${clipText(p.subject, 34)}"` : 'Shipping it', until: now + 3200 }
        } else if (n.say) {
          n.say.until = now + 3200
          n.carry = n.kind === 'contractor' ? 'tools' : null
        }
        return
      case 'hand':
        if (now < n.until) return
        n.phase = 'out'
        this.walk(n, office, office.door)
        if (!n.path.length) this.gone(n)
        return
      case 'out':
        if (arrived) this.gone(n)
        return
    }
  }

  private gone(n: Npc) {
    if (n.kind === 'clerk' && n.carry === 'box') this.stack = Math.min(MAX_STACK, this.stack + 1)
    this.npcs = this.npcs.filter((x) => x !== n)
    // The contractor's van leaves with the last of its people.
    if (n.kind === 'contractor' && !this.npcs.some((x) => x.server === n.server)) {
      for (const v of this.vans) if (v.kind === 'company' && v.server === n.server && v.state !== 'leave') v.state = 'leave'
    }
  }

  private tickVans(dt: number, office: Office, now: number) {
    for (const v of this.vans) {
      if (v.state === 'arrive') {
        v.x = Math.max(v.stop, v.x - VAN_SPEED * dt)
        if (v.x === v.stop) {
          v.state = 'park'
          v.until = now + PARK_MS
        }
      } else if (v.state === 'park') {
        if (v.kind === 'delivery') {
          // Loads the stack a parcel at a time, after any clerk still on the way out.
          const coming = this.npcs.some((n) => n.kind === 'clerk' && n.carry === 'box')
          if (this.stack > 0 && Math.floor((v.until - now) / 500) < this.stack) this.stack--
          if (now >= v.until && (!coming || now > v.until + 8000)) {
            v.state = 'leave'
            this.stack = 0
          }
        } else if (!this.npcs.some((n) => n.server === v.server) && now >= v.until) v.state = 'leave'
      } else {
        v.x -= VAN_SPEED * dt
      }
    }
    this.vans = this.vans.filter((v) => v.x > -300)
  }

  // ---- the cat -------------------------------------------------------------------

  /** The desk of the senior working hardest right now: working, with the latest step. */
  busiestDesk(model: WorldModel): { desk: Rect; seat: Point; key: string } | null {
    let best: Sprite | null = null
    for (const s of model.sprites.values()) {
      if (s.rank !== 'senior' || s.state !== 'working' || s.slot == null || !s.placed || s.activity === 'leave') continue
      if (!best || s.lastAt > best.lastAt) best = s
    }
    const pod = best ? model.pod(best.zone) : null
    if (!best || !pod || best.slot == null) return null
    return { desk: pod.seniorDesks[best.slot], seat: pod.seniorSeats[best.slot], key: best.key }
  }

  private tickCat(dt: number, office: Office, model: WorldModel, now: number) {
    let c = this.cat
    if (!c) {
      const sofa = office.breakSpots.find((b) => b.kind === 'sofa') ?? office.door
      c = this.spawn('cat', sofa, now)
      c.phase = 'nap'
      c.perch = { x: sofa.x, y: sofa.y }
      c.until = now + 4000
    }
    if (c.say && c.say.until < now) c.say = null
    if (c.phase === 'walk') {
      if (this.move(c, dt) || !c.path.length) {
        // At the foot of the desk or sofa: hop up and curl up.
        if (c.perch) {
          c.x = c.perch.x
          c.y = c.perch.y
        }
        c.phase = 'nap'
        c.facing = 'down'
        c.until = now + 20_000 + this.rand() * 40_000
      }
      return
    }
    if (now < c.until) return
    // Time to move on: to the busiest desk if there is one, else the sofa, now and then a stroll.
    const busy = this.busiestDesk(model)
    let perch: Point
    let foot: Point
    if (busy && this.rand() < 0.8) {
      perch = { x: busy.desk.x + busy.desk.w - 5, y: busy.desk.y + 9 }
      foot = { x: busy.seat.x + 10, y: busy.seat.y }
    } else {
      const spots = office.breakSpots.filter((b) => b.kind === 'sofa' || (!busy && this.rand() < 0.3))
      const b = spots[Math.floor(this.rand() * spots.length)] ?? office.breakSpots[0]
      if (!b) return
      perch = { x: b.x, y: b.y }
      foot = perch
    }
    if (c.perch && Math.abs(c.perch.x - perch.x) < 1 && Math.abs(c.perch.y - perch.y) < 1) {
      c.until = now + 20_000 + this.rand() * 30_000
      return
    }
    c.perch = perch
    c.phase = 'walk'
    c.path = route(office, { x: c.x, y: c.y }, foot)
  }
}

function clipText(s: string, max: number) {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

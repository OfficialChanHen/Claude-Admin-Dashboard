import { describe, expect, it } from 'vitest'
import type { ActiveSession, LiveEvent } from '../lib/api'
import { BOSS, buildOffice } from './office'
import { MAX_JUNIORS_PER_SESSION, OTHER, WorldModel, clip, helperName, promptText, stationFor, type Sprite } from './model'

const NOW = 1_800_000_000_000
const office = buildOffice([
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
  { id: OTHER, name: 'Other folders' },
])
const pod = office.pods[0]

/** A model with a predictable coin, already moved into the office. */
function world(coin = 0.5) {
  const m = new WorldModel(() => coin)
  m.setOffice(office, NOW)
  return m
}

function session(id: string, over: Partial<ActiveSession> = {}): ActiveSession {
  return { id, projectId: 'p1', title: 'A session', state: 'working', lastAt: NOW, entrypoint: 'cli', cwd: '/x', ...over }
}

function action(over: Partial<Extract<LiveEvent, { kind: 'action' }>> = {}): LiveEvent {
  return { kind: 'action', sessionId: 's1', projectId: 'p1', agentId: null, id: 'a1', requestId: 'r1', tool: 'Bash', summary: 'ls', ts: NOW, ...over }
}

function agentStart(agentId: string, toolUseId = `t-${agentId}`, sessionId = 's1'): LiveEvent {
  return { kind: 'agent_start', sessionId, projectId: 'p1', agentId, agentType: 'Explore', description: `Task ${agentId}`, model: null, toolUseId, ts: NOW }
}

/** Runs the clock forward in small steps, like the canvas does. Returns the end time. */
function run(m: WorldModel, seconds: number, start = NOW) {
  const step = 0.05
  let t = start
  for (let i = 0; i < seconds / step; i++) {
    t = start + i * step * 1000
    m.tick(step, t)
  }
  return t
}

const at = (s: Sprite, p: { x: number; y: number }) => Math.abs(s.x - p.x) < 0.5 && Math.abs(s.y - p.y) < 0.5

/** Nobody shares a spot: where each person is, or is walking to, is theirs alone. */
function spread(m: WorldModel) {
  const ends = [...m.sprites.values()].filter((s) => s.placed && s.activity !== 'leave').map((s) => s.path[s.path.length - 1] ?? s)
  return ends.every((a, i) => ends.every((b, j) => i === j || Math.abs(a.x - b.x) >= 1 || Math.abs(a.y - b.y) >= 1))
}

describe('stationFor', () => {
  it.each([
    ['Read', 'cabinet'], ['Grep', 'cabinet'], ['Glob', 'cabinet'],
    ['TodoWrite', 'board'], ['Skill', 'board'], ['AskUserQuestion', 'board'],
    ['Edit', 'desk'], ['Write', 'desk'], ['Bash', 'desk'], ['WebFetch', 'desk'], ['mcp__x__y', 'desk'], ['SomethingNew', 'desk'],
  ])('%s happens at the %s', (tool, station) => {
    expect(stationFor(tool)).toBe(station)
  })
})

describe('promptText and clip', () => {
  it('drops editor context blocks and keeps what was typed', () => {
    expect(promptText('<ide_selection>lines 1-4</ide_selection>\nfix the bug')).toBe('fix the bug')
    expect(promptText('<ide_opened_file>a.ts</ide_opened_file>')).toBe('')
    expect(promptText('is 3 < 4 and 5 > 2')).toBe('is 3 < 4 and 5 > 2')
  })
  it('collapses whitespace and cuts long text', () => {
    expect(clip('  a \n b  ')).toBe('a b')
    expect(clip('x'.repeat(300), 20)).toHaveLength(20)
  })
})

describe('seniors', () => {
  it('sit one open session at each senior desk in its project area', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 }), session('s2', { lastAt: NOW - 5 * 60_000 })], NOW)
    const [a, b] = [m.sprites.get('s1')!, m.sprites.get('s2')!]
    expect(a.rank).toBe('senior')
    expect(at(a, pod.seniorSeats[0])).toBe(true)
    expect(at(b, pod.seniorSeats[1])).toBe(true)
  })

  it('walk in from the door when the session is new', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 1000 })], NOW)
    const s = m.sprites.get('s1')!
    expect(at(s, office.door)).toBe(true)
    run(m, 30)
    expect(at(s, pod.seniorSeats[0])).toBe(true)
  })

  it('come back at their desks after a reload instead of walking in again', () => {
    const m = world()
    m.seated = new Set(['s1', 'j1'])
    m.sync([session('s1', { lastAt: NOW - 1000 })], NOW)
    m.ingest(agentStart('j1'), NOW)
    expect(at(m.sprites.get('s1')!, pod.seniorSeats[0])).toBe(true)
    expect(at(m.sprites.get('j1')!, office.door)).toBe(false)
    expect(m.sprites.get('j1')!.activity).toBe('work')
    expect(m.seated.size).toBe(0)
  })

  it('use a spare seat in the hub when every senior desk is taken, then stand', () => {
    const m = world()
    const ids = Array.from({ length: 3 + office.hubSeats.length + 2 }, (_, i) => `s${i}`)
    m.sync(ids.map((id) => session(id, { lastAt: NOW - 5 * 60_000 })), NOW)
    const extra = m.sprites.get('s3')!
    expect(extra.slot).toBeNull()
    expect(at(extra, office.hubSeats[0])).toBe(true)
    expect(m.using(extra)).toEqual({ at: 'desk', active: false, task: null })
    expect(m.deskFor(extra)).toEqual(office.hubSeats[0].desk)
    // Past the hub's seats, they stand at the back of their own room.
    const standing = m.sprites.get(ids[ids.length - 1])!
    expect(standing.y).toBe(pod.aisles[pod.aisles.length - 1])
  })

  it('never share a seat, even with more people than chairs', () => {
    const m = world()
    const ids = Array.from({ length: 3 + office.hubSeats.length + 4 }, (_, i) => `s${i}`)
    m.sync(ids.map((id) => session(id, { lastAt: NOW - 5 * 60_000 })), NOW)
    run(m, 30)
    expect(spread(m)).toBe(true)
  })

  it('move up into a seat that comes free: their own room first, then the hub', () => {
    const m = world()
    const ids = Array.from({ length: 3 + office.hubSeats.length + 1 }, (_, i) => `s${i}`)
    m.sync(ids.map((id) => session(id, { lastAt: NOW - 5 * 60_000 })), NOW)
    const [hubbed, standing] = [m.sprites.get('s3')!, m.sprites.get(ids[ids.length - 1])!]
    m.ingest({ kind: 'session', sessionId: 's0', projectId: 'p1', state: 'ended', ts: NOW }, NOW)
    expect(hubbed.slot).toBe(0)
    run(m, 30)
    expect(at(hubbed, pod.seniorSeats[0])).toBe(true)
    expect(at(standing, office.hubSeats[0])).toBe(true)
  })

  it('free their desk when they leave', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest({ kind: 'session', sessionId: 's1', projectId: 'p1', state: 'ended', ts: NOW }, NOW)
    run(m, 60)
    expect(m.sprites.has('s1')).toBe(false)
    m.sync([session('s2', { lastAt: NOW - 5 * 60_000 })], NOW)
    expect(m.sprites.get('s2')!.slot).toBe(0)
  })

  it('go to the cabinet to read and the whiteboard to plan', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    const s = m.sprites.get('s1')!
    m.ingest(action({ tool: 'Read' }), NOW)
    run(m, 20)
    expect(Math.abs(s.y - pod.cabinet.y)).toBeLessThan(0.5)
    m.ingest(action({ id: 'a2', tool: 'TodoWrite' }), NOW)
    run(m, 20)
    expect(Math.abs(s.y - pod.board.y)).toBeLessThan(0.5)
    m.ingest(action({ id: 'a3', tool: 'Edit' }), NOW)
    run(m, 20)
    expect(at(s, pod.seniorSeats[0])).toBe(true)
  })

  it('say the task out loud when they hand it to a junior', () => {
    const m = world()
    m.ingest(action({ tool: 'Agent', summary: 'Find where the login fails' }), NOW)
    expect(m.sprites.get('s1')!.bubble?.text).toBe('Find where the login fails')
  })

  it('turn round to you while waiting, and are not pulled away by tool events', () => {
    const m = world()
    m.sync([session('s1', { state: 'waiting', lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest(action(), NOW)
    run(m, 1)
    const s = m.sprites.get('s1')!
    expect(s.state).toBe('waiting')
    expect(s.facing).toBe('down')
  })

  it('take a break when idle, and come back when you prompt them', () => {
    const m = world(0.1)
    m.sync([session('s1', { state: 'idle', lastAt: NOW - 30_000 })], NOW)
    const s = m.sprites.get('s1')!
    run(m, 10)
    expect(s.activity).toBe('break')
    const t = NOW + 10_000
    m.ingest({ kind: 'prompt', sessionId: 's1', projectId: 'p1', agentId: null, text: 'next step', ts: t }, t)
    expect(s.activity).toBe('work')
    expect(s.bubble).toMatchObject({ text: 'next step', you: true })
    run(m, 30, t)
    expect(at(s, pod.seniorSeats[0])).toBe(true)
  })

  it('doze at the desk after a long quiet spell instead of wandering', () => {
    const m = world(0.1)
    m.sync([session('s1', { state: 'idle', lastAt: NOW - 10 * 60_000 })], NOW)
    const s = m.sprites.get('s1')!
    run(m, 20)
    expect(s.activity).toBe('work')
    expect(m.asleep(s, NOW + 20_000)).toBe(true)
  })

  it('stay at the desk while a brand-new session is missing from the active list', () => {
    const m = world()
    m.ingest(action(), NOW)
    m.sync([], NOW + 30_000)
    expect(m.sprites.get('s1')!.activity).not.toBe('leave')
    m.sync([], NOW + 61_000)
    expect(m.sprites.get('s1')!.activity).toBe('leave')
  })
})

describe('the boss', () => {
  it('works from the corner office, facing the room, while managers stay with their projects', () => {
    const m = world()
    m.sync([
      session('boss', { projectId: null, role: 'boss', state: 'idle', lastAt: NOW - 5 * 60_000 }),
      session('mgr', { role: 'manager', state: 'idle', lastAt: NOW - 5 * 60_000 }),
    ], NOW)
    const boss = m.sprites.get('boss')!
    expect(boss.zone).toBe(BOSS)
    expect(at(boss, office.boss.seniorSeats[0])).toBe(true)
    expect(boss.facing).toBe('down')
    expect(m.sprites.get('mgr')!.zone).toBe('p1')
  })

  it("brings the boss's helpers into the office, to the chairs across the desk", () => {
    const m = world()
    m.sync([session('boss', { projectId: null, role: 'boss', lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest(agentStart('h1', 't1', 'boss'), NOW)
    const h = m.sprites.get('h1')!
    expect(h.zone).toBe(BOSS)
    m.ingest(action({ sessionId: 'boss', projectId: null, agentId: 'h1', id: 'a2', tool: 'Edit' }), NOW)
    run(m, 20)
    expect(office.boss.juniorSeats.some((p) => at(h, p))).toBe(true)
    expect(h.facing).toBe('up')
  })
})

describe('juniors', () => {
  it('come in, get briefed beside their senior, then sit at a junior desk', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest(agentStart('j1'), NOW)
    const j = m.sprites.get('j1')!
    expect(j.rank).toBe('junior')
    expect(j.label).toBe('Task j1')
    expect(at(j, office.door)).toBe(true)
    let t = NOW
    let briefed = false
    for (let i = 0; i < 600 && !briefed; i++) {
      t += 50
      m.tick(0.05, t)
      briefed = j.activity === 'brief'
    }
    expect(briefed).toBe(true)
    expect(Math.abs(j.x - (pod.seniorSeats[0].x + 14))).toBeLessThan(0.5)
    t = run(m, 20, t)
    expect(j.activity).toBe('work')
    expect(at(j, pod.juniorSeats[0])).toBe(true)
  })

  it('are capped per session, with the rest counted', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    for (let i = 0; i < MAX_JUNIORS_PER_SESSION + 4; i++) m.ingest(agentStart(`j${i}`), NOW)
    const juniors = [...m.sprites.values()].filter((s) => s.rank === 'junior')
    expect(juniors).toHaveLength(MAX_JUNIORS_PER_SESSION)
    expect(m.hiddenCount('s1')).toBe(4)
  })

  it('wait for their brief side by side, not on top of each other', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    for (let i = 0; i < MAX_JUNIORS_PER_SESSION; i++) m.ingest(agentStart(`j${i}`), NOW)
    const juniors = [...m.sprites.values()].filter((s) => s.rank === 'junior')
    let t = NOW
    for (let i = 0; i < 600 && !juniors.every((j) => j.activity === 'brief'); i++) {
      t += 50
      m.tick(0.05, t)
    }
    expect(juniors.every((j) => j.activity === 'brief')).toBe(true)
    expect(spread(m)).toBe(true)
  })

  it('never take more desks than the area has', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 }), session('s2', { lastAt: NOW - 5 * 60_000 })], NOW)
    for (let i = 0; i < 3; i++) m.ingest(agentStart(`a${i}`, `ta${i}`, 's1'), NOW)
    for (let i = 0; i < 3; i++) m.ingest(agentStart(`b${i}`, `tb${i}`, 's2'), NOW)
    const juniors = [...m.sprites.values()].filter((s) => s.rank === 'junior')
    expect(juniors.length).toBe(4)
    expect(new Set(juniors.map((j) => j.slot)).size).toBe(4)
    expect(m.hiddenCount('s2')).toBe(2)
  })

  it('talk while they work, and report their last line when the Agent call finishes', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest(agentStart('j1', 'tool-9'), NOW)
    let t = run(m, 30)
    m.ingest({ kind: 'say', sessionId: 's1', projectId: 'p1', agentId: 'j1', text: 'Found it in auth.ts', ts: t }, t)
    const j = m.sprites.get('j1')!
    expect(j.bubble?.text).toBe('Found it in auth.ts')
    m.ingest({ kind: 'action_done', sessionId: 's1', projectId: 'p1', agentId: null, id: 'tool-9', isError: false, resultTokens: 10, ts: t }, t)
    expect(j.activity).toBe('report')
    t = run(m, 20, t)
    expect(j.emote?.kind === 'done' || j.activity === 'leave' || !m.sprites.has('j1')).toBe(true)
    run(m, 40, t)
    expect(m.sprites.has('j1')).toBe(false)
  })

  it('report back on their own after a quiet spell', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest(agentStart('j1'), NOW)
    const j = m.sprites.get('j1')!
    const t = run(m, 30)
    expect(j.activity).toBe('work') // the walk in does not count
    run(m, 30, t)
    expect(['report', 'leave']).toContain(j.activity)
  })

  it('stay gone when replayed from long ago', () => {
    const m = world()
    m.ingest({ ...agentStart('j1'), ts: NOW - 3 * 60_000 } as LiveEvent, NOW)
    expect(m.sprites.has('j1')).toBe(false)
  })

  it('leave with their senior when the session ends', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest(agentStart('j1'), NOW)
    m.ingest({ kind: 'session', sessionId: 's1', projectId: 'p1', state: 'ended', ts: NOW }, NOW)
    expect(m.sprites.get('j1')!.activity).toBe('leave')
    run(m, 60)
    expect(m.sprites.size).toBe(0)
  })
})

describe('reactions', () => {
  it('show a mistake when a tool fails', () => {
    const m = world()
    m.ingest(action({ id: 'a1' }), NOW)
    m.ingest({ kind: 'action_done', sessionId: 's1', projectId: 'p1', agentId: null, id: 'a1', isError: true, resultTokens: 1, ts: NOW }, NOW)
    expect(m.sprites.get('s1')!.emote?.kind).toBe('error')
  })

  it('stop running only when their own action finishes', () => {
    const m = world()
    m.ingest(action({ id: 'a1' }), NOW)
    m.ingest(action({ id: 'a2' }), NOW)
    const s = m.sprites.get('s1')!
    m.ingest({ kind: 'action_done', sessionId: 's1', projectId: 'p1', agentId: null, id: 'a1', isError: false, resultTokens: 5, ts: NOW }, NOW)
    expect(s.running).toBe(true)
    m.ingest({ kind: 'action_done', sessionId: 's1', projectId: 'p1', agentId: null, id: 'a2', isError: false, resultTokens: 5, ts: NOW }, NOW)
    expect(s.running).toBe(false)
  })

  it('stay quiet for replayed lines and let fresh ones expire', () => {
    const m = world()
    m.ingest({ kind: 'say', sessionId: 's1', projectId: 'p1', agentId: null, text: 'Old', ts: NOW - 30_000 }, NOW)
    expect(m.sprites.get('s1')!.bubble).toBeNull()
    m.ingest({ kind: 'say', sessionId: 's1', projectId: 'p1', agentId: null, text: 'Done.', ts: NOW }, NOW)
    expect(m.sprites.get('s1')!.bubble?.text).toBe('Done.')
    m.tick(0.01, NOW + 13_000)
    expect(m.sprites.get('s1')!.bubble).toBeNull()
  })

  it('show no bubble for a prompt that is only editor context', () => {
    const m = world()
    m.ingest({ kind: 'prompt', sessionId: 's1', projectId: 'p1', agentId: null, text: '<ide_selection>x</ide_selection>', ts: NOW }, NOW)
    // At most a hello on the way in, never the prompt.
    expect(m.sprites.get('s1')!.bubble?.chatter ?? true).toBe(true)
  })

  it('glance around at the desk now and then', () => {
    let n = 0
    const coin = () => (n++ % 50 === 0 ? 0.001 : 0.5)
    const m = new WorldModel(coin)
    m.setOffice(office, NOW)
    m.sync([session('s1', { state: 'working', lastAt: NOW - 5 * 60_000 })], NOW)
    const seen = new Set<string>()
    let t = NOW
    for (let i = 0; i < 400; i++) {
      t += 50
      m.tick(0.05, t)
      seen.add(m.sprites.get('s1')!.facing)
    }
    expect(seen.has('up')).toBe(true)
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('using', () => {
  it('says which furniture someone is at, and what for, once they get there', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    const s = m.sprites.get('s1')!
    expect(m.using(s)).toEqual({ at: 'desk', active: false, task: null })
    m.ingest(action({ tool: 'Grep', summary: 'TODO' }), NOW)
    expect(s.summary).toBe('TODO')
    expect(s.actAt).toBe(NOW)
    expect(m.using(s)).toBeNull() // still walking over
    run(m, 20)
    expect(m.using(s)).toEqual({ at: 'cabinet', active: true, task: 'search' })
    m.ingest({ kind: 'action_done', sessionId: 's1', projectId: 'p1', agentId: null, id: 'a1', isError: false, resultTokens: 1, ts: NOW }, NOW)
    expect(m.using(s)).toEqual({ at: 'cabinet', active: false, task: null })
    m.ingest(action({ id: 'a2', tool: 'Bash' }), NOW)
    run(m, 20)
    expect(m.using(s)).toEqual({ at: 'desk', active: true, task: 'run' })
  })

  it('is the whiteboard while planning or asking you', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    const s = m.sprites.get('s1')!
    m.ingest(action({ tool: 'TodoWrite' }), NOW)
    run(m, 20)
    expect(m.using(s)).toMatchObject({ at: 'board', task: 'plan' })
  })

  it('is the break spot on a break, and nothing for a senior working from the hub table', () => {
    const m = world(0.1)
    m.sync([session('s1', { state: 'idle', lastAt: NOW - 30_000 })], NOW)
    const s = m.sprites.get('s1')!
    let t = NOW
    for (let i = 0; i < 1200 && !(s.activity === 'break' && !s.path.length); i++) {
      t += 50
      m.tick(0.05, t)
    }
    expect(s.activity).toBe('break')
    expect(office.breakSpots.map((b) => b.kind)).toContain(m.using(s)?.at)
    const m2 = world()
    const ids = Array.from({ length: 3 + office.hubSeats.length + 1 }, (_, i) => `s${i}`)
    m2.sync(ids.map((id) => session(id, { lastAt: NOW - 5 * 60_000 })), NOW)
    // Hot desks are desks; the work table is a table; standing in the room is nothing.
    expect(m2.using(m2.sprites.get('s3')!)?.at).toBe('desk')
    expect(m2.using(m2.sprites.get(`s${2 + office.hubSeats.length}`)!)?.at).toBe('table')
    expect(m2.using(m2.sprites.get(ids[ids.length - 1])!)).toBeNull()
  })

  it('never puts two people on one break spot, and keeps the rest at their desks', () => {
    const m = world(0.1)
    const n = office.breakSpots.length + 3
    const ids = Array.from({ length: n }, (_, i) => `s${i}`)
    m.sync(ids.map((id, i) => session(id, { projectId: ['p1', 'p2', OTHER][i % 3], state: 'idle', lastAt: NOW - 30_000 })), NOW)
    let t = NOW
    let most = 0
    for (let i = 0; i < 40; i++) {
      t = run(m, 1, t)
      expect(spread(m)).toBe(true)
      most = Math.max(most, [...m.sprites.values()].filter((s) => s.activity === 'break').length)
    }
    expect(most).toBe(office.breakSpots.length)
  })

  it('is a hand-off while a junior is briefed', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest(agentStart('j1'), NOW)
    const j = m.sprites.get('j1')!
    let t = NOW
    for (let i = 0; i < 600 && j.activity !== 'brief'; i++) {
      t += 50
      m.tick(0.05, t)
    }
    expect(m.using(j)).toEqual({ at: 'handoff', active: true, task: null })
  })
})

describe('finishing a turn', () => {
  it('cheers when a working session goes idle, but not for old news', () => {
    const m = world()
    m.ingest(action(), NOW)
    m.ingest({ kind: 'session', sessionId: 's1', projectId: 'p1', state: 'idle', ts: NOW }, NOW + 1000)
    const s = m.sprites.get('s1')!
    expect(s.emote).toMatchObject({ kind: 'done', since: NOW + 1000 })
    const m2 = world()
    m2.sync([session('s2', { lastAt: NOW - 5 * 60_000 })], NOW)
    m2.ingest({ kind: 'session', sessionId: 's2', projectId: 'p1', state: 'idle', ts: NOW }, NOW)
    expect(m2.sprites.get('s2')!.emote).toBeNull()
  })
})

describe('moving offices', () => {
  it('re-seat everyone when the floor plan changes', () => {
    const m = world()
    m.sync([session('s1', { projectId: 'p2', lastAt: NOW - 5 * 60_000 })], NOW)
    const bigger = buildOffice([
      { id: 'p0', name: 'New' },
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
    ])
    m.setOffice(bigger, NOW)
    const s = m.sprites.get('s1')!
    expect(at(s, bigger.pods[2].seniorSeats[0])).toBe(true)
  })

  it('waits to place people whose project has no area yet', () => {
    const m = world()
    m.sync([session('s1', { projectId: 'nowhere', lastAt: NOW - 5 * 60_000 })], NOW)
    expect(m.sprites.get('s1')!.placed).toBe(false)
  })
})

describe('picking people up', () => {
  it('only picks up seniors', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest(agentStart('h1'), NOW)
    expect(m.grab('h1')).toBeNull()
    expect(m.grab('s1')?.held).toBe(true)
  })

  it('holds them still while carried, then they walk back to work', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    const s = m.grab('s1')!
    m.carry(s, office.door.x, office.door.y)
    run(m, 2)
    expect(at(s, office.door)).toBe(true)
    expect(m.using(s)).toBeNull()
    m.putDown(s)
    expect(s.held).toBe(false)
    run(m, 60, NOW + 2000)
    expect(at(s, m.seat(s)!)).toBe(true)
  })

  it('sends a dismissed senior and their helpers out of the door', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest(agentStart('h1'), NOW)
    m.grab('s1')
    m.dismiss('s1', NOW)
    expect(m.sprites.get('s1')!.activity).toBe('leave')
    expect(m.sprites.get('h1')!.activity).toBe('leave')
    run(m, 120)
    expect(m.sprites.size).toBe(0)
  })
})

describe('thinking', () => {
  it('is a working senior at the desk with no tool running and nothing to say', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    const s = m.sprites.get('s1')!
    expect(m.thinking(s, NOW)).toBe(true)
    m.ingest(action(), NOW)
    expect(m.thinking(s, NOW)).toBe(false) // running a command
    m.ingest({ kind: 'action_done', sessionId: 's1', projectId: 'p1', agentId: null, id: 'a1', isError: false, resultTokens: 0, ts: NOW }, NOW)
    expect(m.thinking(s, NOW)).toBe(true)
    m.ingest({ kind: 'session', sessionId: 's1', projectId: 'p1', state: 'idle', ts: NOW }, NOW)
    expect(m.thinking(s, NOW)).toBe(false)
  })

  it('shows a light bulb when a thought is finished', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 5 * 60_000 })], NOW)
    m.ingest({ kind: 'think', sessionId: 's1', projectId: 'p1', agentId: null, ts: NOW }, NOW)
    expect(m.sprites.get('s1')!.emote?.kind).toBe('idea')
  })
})

describe('small talk', () => {
  it('says a line now and then, quieter than real words', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 60_000 })], NOW)
    const s = m.sprites.get('s1')!
    expect(s.bubble).toBeNull()
    m.tick(0.01, s.chatAt)
    expect(s.bubble?.chatter).toBe(true)
    expect(s.bubble?.you).toBe(false)
  })

  it('never talks over what the session said', () => {
    const m = world()
    m.ingest({ kind: 'say', sessionId: 's1', projectId: 'p1', agentId: null, text: 'Done.', ts: NOW }, NOW)
    const s = m.sprites.get('s1')!
    s.chatAt = NOW + 1000
    m.tick(0.01, NOW + 1000)
    expect(s.bubble?.text).toBe('Done.')
    expect(s.bubble?.chatter).toBe(false)
  })

  it('takes turns across the floor', () => {
    const m = world()
    m.sync([session('s1', { lastAt: NOW - 60_000 }), session('s2', { lastAt: NOW - 60_000 })], NOW)
    const [a, b] = [m.sprites.get('s1')!, m.sprites.get('s2')!]
    const t = Math.max(a.chatAt, b.chatAt)
    m.tick(0.01, t)
    expect([a, b].filter((s) => s.bubble).length).toBe(1)
  })

  it('stays quiet while dozing', () => {
    const m = world()
    m.sync([session('s1', { state: 'idle', lastAt: NOW - 10 * 60_000 })], NOW)
    const s = m.sprites.get('s1')!
    s.lastAt = NOW - 5 * 60_000
    m.tick(0.01, s.chatAt)
    expect(m.asleep(s, s.chatAt)).toBe(true)
    expect(s.bubble).toBeNull()
  })
})

describe('helperName', () => {
  it('calls a helper by its task, or else by a readable kind', () => {
    expect(helperName('Commit and push office world', 'general-purpose')).toBe('Commit and push office world')
    expect(helperName(null, 'general-purpose')).toBe('Helper')
    expect(helperName('  ', 'Explore')).toBe('Explorer')
    expect(helperName(null, 'code-reviewer')).toBe('Code reviewer')
    expect(helperName(null, null)).toBe('Helper')
  })
})

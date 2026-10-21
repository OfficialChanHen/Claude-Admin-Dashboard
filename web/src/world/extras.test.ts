import { describe, expect, it } from 'vitest'
import type { ActiveSession, GitInfo, LiveEvent } from '../lib/api'
import { buildOffice } from './office'
import { OTHER, WorldModel } from './model'
import { Extras, TROPHY_AT, roomAge, serverOf, tvRect, visitLine } from './extras'

const NOW = 1_800_000_000_000
const DAY = 86_400_000
const office = buildOffice([
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
  { id: OTHER, name: 'Other folders' },
])

/** A model with one senior at their desk in p1, working. */
function setup(state: ActiveSession['state'] = 'working') {
  const m = new WorldModel(() => 0.5)
  m.setOffice(office, NOW)
  m.sync([{ id: 's1', projectId: 'p1', title: 'A session', state, lastAt: NOW - 60_000, entrypoint: 'cli', cwd: '/x' }], NOW)
  return { m, x: new Extras(() => 0.5) }
}

function run(x: Extras, m: WorldModel, seconds: number, start = NOW) {
  let t = start
  for (let i = 0; i < seconds / 0.05; i++) {
    t = start + i * 50
    x.tick(0.05, m, t)
  }
  return t
}

const action = (over: Partial<Extract<LiveEvent, { kind: 'action' }>> = {}): LiveEvent =>
  ({ kind: 'action', sessionId: 's1', projectId: 'p1', agentId: null, id: 'a1', requestId: null, tool: 'Bash', summary: 'Run the unit tests', ts: NOW, ...over })
const done = (id: string, isError: boolean, ts = NOW): LiveEvent =>
  ({ kind: 'action_done', sessionId: 's1', projectId: 'p1', agentId: null, id, isError, resultTokens: 0, ts })
const git = (over: Partial<GitInfo> = {}): GitInfo => ({
  projectId: 'p1', branch: 'main', head: 'a', subject: 'x', lastCommitAt: NOW, commits: 0, ahead: 0, files: 0, added: 0, removed: 0, lastActiveAt: NOW, ...over,
})

describe('roomAge', () => {
  it('gives a trophy at each commit milestone', () => {
    expect(roomAge(git({ commits: TROPHY_AT[0] - 1 }), NOW).trophies).toBe(0)
    expect(roomAge(git({ commits: TROPHY_AT[0] }), NOW).trophies).toBe(1)
    expect(roomAge(git({ commits: TROPHY_AT[1] }), NOW).trophies).toBe(2)
    expect(roomAge(git({ commits: 10_000 }), NOW).trophies).toBe(3)
  })

  it('gathers dust after two weeks quiet, and goes dark after six', () => {
    expect(roomAge(git({ lastActiveAt: NOW - 3 * DAY }), NOW).dust).toBe(0)
    expect(roomAge(git({ lastActiveAt: NOW - 20 * DAY }), NOW).dust).toBe(1)
    expect(roomAge(git({ lastActiveAt: NOW - 60 * DAY }), NOW).dust).toBe(2)
  })

  it('leaves a room it knows nothing about as it is', () => {
    expect(roomAge(undefined, NOW)).toEqual({ trophies: 0, dust: 0 })
    expect(roomAge(git({ lastActiveAt: null }), NOW).dust).toBe(0)
  })
})

describe('serverOf and visitLine', () => {
  it('names the MCP server a tool is from, but not HQ itself', () => {
    expect(serverOf('mcp__github__create_issue')).toBe('github')
    expect(serverOf('mcp__claude_hq__report')).toBeNull()
    expect(serverOf('WebFetch')).toBeNull()
  })

  it('says where a delivery is from', () => {
    expect(visitLine('WebFetch', 'example.com')).toBe('Delivery from example.com')
    expect(visitLine('WebSearch', 'vite config')).toBe('Results for "vite config"')
    expect(visitLine('mcp__github__x', '')).toBe('github here, on the job')
  })
})

describe('tvRect', () => {
  it('hangs the TV inside the room, right of the name plate', () => {
    for (const p of office.pods) {
      const tv = tvRect(p)
      expect(tv.x).toBeGreaterThanOrEqual(p.plate.x + p.plate.w)
      expect(tv.x + tv.w).toBeLessThanOrEqual(p.rect.x + p.rect.w)
    }
  })
})

describe('test runs', () => {
  it('lights red on a failed run and green on a pass, and a pass after a failure is a fix', () => {
    const { m, x } = setup()
    x.ingest(action({ id: 't1' }), m, NOW)
    x.ingest(done('t1', true), m, NOW)
    expect(x.drama.get('s1')).toMatchObject({ kind: 'fail', streak: 1 })
    x.ingest(action({ id: 't2' }), m, NOW)
    x.ingest(done('t2', false), m, NOW)
    expect(x.drama.get('s1')).toMatchObject({ kind: 'fixed', streak: 0 })
    x.ingest(action({ id: 't3' }), m, NOW)
    x.ingest(done('t3', false), m, NOW)
    expect(x.drama.get('s1')?.kind).toBe('pass')
  })

  it('counts failures in a row, for the extinguisher', () => {
    const { m, x } = setup()
    for (const id of ['a', 'b', 'c']) {
      x.ingest(action({ id }), m, NOW)
      x.ingest(done(id, true), m, NOW)
    }
    expect(x.drama.get('s1')?.streak).toBe(3)
  })

  it('ignores other shell steps and old results', () => {
    const { m, x } = setup()
    x.ingest(action({ id: 'b1', summary: 'List files' }), m, NOW)
    x.ingest(done('b1', true), m, NOW)
    expect(x.drama.size).toBe(0)
    x.ingest(action({ id: 'b2' }), m, NOW)
    x.ingest(done('b2', true, NOW - 60_000), m, NOW)
    expect(x.drama.size).toBe(0)
  })

  it('lets the lamp go out after a while', () => {
    const { m, x } = setup()
    x.ingest(action({ id: 't1' }), m, NOW)
    x.ingest(done('t1', true), m, NOW)
    run(x, m, 7)
    expect(x.drama.size).toBe(0)
  })
})

describe('commits and pushes', () => {
  const commit = (ts = NOW): LiveEvent => ({ kind: 'git', projectId: 'p1', change: 'commit', subject: 'Ship the TV', ts })
  const push = (ts = NOW): LiveEvent => ({ kind: 'git', projectId: 'p1', change: 'push', subject: null, ts })

  it('puts a parcel on the committer’s desk, and the clerk carries it to the stack by the door', () => {
    const { m, x } = setup()
    x.ingest(commit(), m, NOW)
    const desk = m.pod('p1')!.seniorDesks[m.sprites.get('s1')!.slot!]
    expect(x.parcels).toHaveLength(1)
    expect(x.parcels[0].y).toBeGreaterThanOrEqual(desk.y)
    expect(x.npcs.map((n) => n.kind)).toEqual(['clerk'])
    run(x, m, 120)
    expect(x.parcels).toHaveLength(0)
    expect(x.npcs).toHaveLength(0)
    expect(x.stack).toBe(1)
  })

  it('sends a van for a push that drives off with the stack', () => {
    const { m, x } = setup()
    x.stack = 3
    x.ingest(push(), m, NOW)
    expect(x.vans.map((v) => v.kind)).toEqual(['delivery'])
    const end = run(x, m, 20)
    expect(x.stack).toBe(0)
    run(x, m, 40, end)
    expect(x.vans).toHaveLength(0)
  })

  it('sends one van for two pushes close together', () => {
    const { m, x } = setup()
    x.ingest(push(), m, NOW)
    x.ingest(push(), m, NOW)
    expect(x.vans).toHaveLength(1)
  })

  it('ignores old git news', () => {
    const { m, x } = setup()
    x.ingest(commit(NOW - 60_000), m, NOW)
    expect(x.parcels).toHaveLength(0)
  })

  it('stacks the commits not pushed yet when nothing is on the move', () => {
    const { x } = setup()
    x.setGit([git({ ahead: 2 }), git({ projectId: 'p2', ahead: 1 }), git({ projectId: 'p3', ahead: null })])
    expect(x.stack).toBe(3)
  })
})

describe('visitors', () => {
  it('sends a courier for a web fetch, who hands it over and leaves', () => {
    const { m, x } = setup()
    x.ingest(action({ id: 'w1', tool: 'WebFetch', summary: 'example.com' }), m, NOW)
    expect(x.npcs).toHaveLength(1)
    expect(x.npcs[0]).toMatchObject({ kind: 'courier', visit: 's1', carry: 'parcel' })
    run(x, m, 120)
    expect(x.npcs).toHaveLength(0)
  })

  it('sends a contractor and their van for an MCP tool, and the van leaves with them', () => {
    const { m, x } = setup()
    x.ingest(action({ id: 'g1', tool: 'mcp__github__list_issues', summary: '' }), m, NOW)
    expect(x.npcs[0]).toMatchObject({ kind: 'contractor', server: 'github' })
    expect(x.vans.map((v) => [v.kind, v.server])).toEqual([['company', 'github']])
    run(x, m, 180)
    expect(x.npcs).toHaveLength(0)
    expect(x.vans).toHaveLength(0)
  })

  it('sends one visitor per person at a time, and none for old steps or HQ’s own tools', () => {
    const { m, x } = setup()
    x.ingest(action({ id: 'w1', tool: 'WebFetch' }), m, NOW)
    x.ingest(action({ id: 'w2', tool: 'WebSearch' }), m, NOW)
    expect(x.npcs).toHaveLength(1)
    const y = setup().x
    y.ingest(action({ id: 'w3', tool: 'WebFetch', ts: NOW - 60_000 }), m, NOW)
    y.ingest(action({ id: 'w4', tool: 'mcp__claude_hq__report' }), m, NOW)
    expect(y.npcs).toHaveLength(0)
  })
})

describe('the cat', () => {
  it('curls up on the busiest desk', () => {
    const { m, x } = setup('working')
    run(x, m, 120)
    const desk = m.pod('p1')!.seniorDesks[m.sprites.get('s1')!.slot!]
    const c = x.cat!
    expect(c.phase).toBe('nap')
    expect(c.x).toBeGreaterThanOrEqual(desk.x)
    expect(c.x).toBeLessThanOrEqual(desk.x + desk.w)
    expect(c.y).toBeGreaterThanOrEqual(desk.y)
    expect(c.y).toBeLessThanOrEqual(desk.y + desk.h)
  })

  it('stays on the sofa when nobody is working', () => {
    const { m, x } = setup('idle')
    run(x, m, 120)
    const sofa = office.breakSpots.filter((b) => b.kind === 'sofa')
    expect(sofa.some((b) => Math.abs(b.x - x.cat!.x) < 1 && Math.abs(b.y - x.cat!.y) < 1)).toBe(true)
  })

  it('purrs when you pet it', () => {
    const { m, x } = setup()
    x.tick(0.05, m, NOW)
    x.pet(NOW)
    expect(x.cat!.say?.text).toMatch(/Mrrp|Purr/)
  })
})

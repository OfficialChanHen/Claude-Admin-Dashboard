import { describe, expect, it } from 'vitest'
import { Camera } from './camera'
import { buildOffice, TILE } from './office'
import { WorldModel, type Sprite } from './model'
import { ART, doorAt, hitFloor, hitRect, hitTest, isGreyHair, lampFor, lookOf, roleTag, swapColors, BOSS, MANAGER, SENIORS, JUNIORS, YOU, podCenter, podStatus, sameHit, skyAt, darkness, LAMPS_ON, statusText, wrap, fitLine, type Frame } from './render'

const office = buildOffice([
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
])
const alpha = office.pods[0]

function camera() {
  const c = new Camera()
  c.setWorld(office.w, office.h)
  c.setViewport(1200, 800, 1)
  c.P = 2
  c.x = podCenter(alpha).x
  c.y = podCenter(alpha).y
  c.clamp()
  return c
}

describe('hitFloor', () => {
  it('finds each office service', () => {
    for (const f of office.facilities) expect(hitFloor(office, f.rect.x + 2, f.rect.y + 2)).toMatchObject({ kind: 'facility', key: f.key })
  })

  it('finds an area’s whiteboard and the rest of the area', () => {
    expect(hitFloor(office, alpha.boardRect.x + 20, alpha.rect.y + 6)).toEqual({ kind: 'board', podId: 'a', label: 'Alpha usage' })
    expect(hitFloor(office, alpha.rect.x + 68, alpha.aisles[1])).toEqual({ kind: 'pod', podId: 'a', label: 'Alpha' })
  })

  it('names the cabinets and desks, so hovering says what they are for', () => {
    const c = alpha.cabinetRect
    expect(hitFloor(office, c.x + 4, c.y + 8)).toEqual({ kind: 'pod', podId: 'a', label: 'Alpha', thing: 'cabinet', rect: c })
    const d = alpha.juniorDesks[2]
    expect(hitFloor(office, d.x + 8, d.y + 8)).toMatchObject({ kind: 'pod', podId: 'a', thing: 'desk', rect: d })
    const s = alpha.seniorDesks[0]
    expect(hitFloor(office, s.x + 20, s.y - 2)).toMatchObject({ thing: 'desk', rect: s }) // the monitor over the desk
  })

  it('finds the hub, and its break furniture', () => {
    const sofa = office.lounge.find((l) => l.thing === 'sofa')!
    expect(hitFloor(office, sofa.rect.x + 4, sofa.rect.y + 4)).toEqual({ kind: 'hub', label: 'Hub', thing: 'sofa', rect: sofa.rect })
    expect(hitFloor(office, office.hub.rect.x + 4 * TILE + 8, office.hub.aisles[1])).toEqual({ kind: 'hub', label: 'Hub' })
  })

  it('finds nothing in the aisles between areas', () => {
    expect(hitFloor(office, alpha.exitX, alpha.rect.y + 40)).toBeNull()
    expect(hitFloor(office, 1, 1)).toBeNull()
  })
})

describe('hitTest', () => {
  const c = camera()
  const p = c.toScreen(alpha.rect.x + 80, alpha.rect.y + 90)
  const sprite = { sessionId: 's1', label: 'Fix login' } as Sprite

  it('reads the floor when nothing is drawn on top', () => {
    expect(hitTest(c, office, { sprites: [], plaques: [], asks: [] }, p.x, p.y)).toMatchObject({ kind: 'pod', podId: 'a' })
  })

  it('prefers a person over a plaque over the floor', () => {
    const plaque: Frame['plaques'][number] = { x: p.x - 20, y: p.y - 20, w: 40, h: 40, hit: { kind: 'plaque', podId: 'a', label: 'Alpha' } }
    const person: Frame['sprites'][number] = { x: p.x - 10, y: p.y - 10, w: 20, h: 20, s: sprite }
    expect(hitTest(c, office, { sprites: [], plaques: [plaque], asks: [] }, p.x, p.y)).toEqual(plaque.hit)
    expect(hitTest(c, office, { sprites: [person], plaques: [plaque], asks: [] }, p.x, p.y)).toEqual({ kind: 'sprite', sessionId: 's1', label: 'Fix login' })
  })

  it('answers the "?" over a head before the person under it', () => {
    const person: Frame['sprites'][number] = { x: p.x - 10, y: p.y - 10, w: 20, h: 20, s: sprite }
    const ask: Frame['asks'][number] = { x: p.x - 5, y: p.y - 5, w: 10, h: 10, s: sprite }
    expect(hitTest(c, office, { sprites: [person], plaques: [], asks: [ask] }, p.x, p.y)).toEqual({ kind: 'ask', sessionId: 's1', label: 'Fix login' })
  })

  it('takes the front one of two overlapping people', () => {
    const back: Frame['sprites'][number] = { x: 0, y: 0, w: 50, h: 50, s: { ...sprite, sessionId: 'back' } }
    const front: Frame['sprites'][number] = { x: 10, y: 10, w: 50, h: 50, s: { ...sprite, sessionId: 'front' } }
    expect(hitTest(c, office, { sprites: [back, front], plaques: [], asks: [] }, 20, 20)).toMatchObject({ sessionId: 'front' })
  })

  it('inside a room, treats the rest of the floor as the way into other rooms', () => {
    const c2 = new Camera()
    c2.setWorld(office.w, office.h)
    c2.setViewport(4000, 4000, 1)
    c2.P = 1
    c2.x = office.w / 2
    c2.y = office.h / 2
    const empty = { sprites: [], plaques: [], asks: [] }
    const at = (x: number, y: number) => c2.toScreen(x, y)
    // The clock is in the hub: from Alpha it takes you to the hub, not to plan limits.
    const clock = office.facilities.find((f) => f.key === 'clock')!.rect
    let p = at(clock.x + 2, clock.y + 2)
    expect(hitTest(c2, office, empty, p.x, p.y, alpha)).toEqual({ kind: 'hub', label: 'Hub' })
    expect(hitTest(c2, office, empty, p.x, p.y, office.hub)).toMatchObject({ kind: 'facility', key: 'clock' })
    const beta = office.pods[1]
    p = at(beta.cabinetRect.x + 4, beta.cabinetRect.y + 8)
    expect(hitTest(c2, office, empty, p.x, p.y, alpha)).toEqual({ kind: 'pod', podId: 'b', label: 'Beta' })
    p = at(alpha.cabinetRect.x + 4, alpha.cabinetRect.y + 8)
    expect(hitTest(c2, office, empty, p.x, p.y, alpha)).toMatchObject({ kind: 'pod', podId: 'a', thing: 'cabinet' })
    p = at(1, office.h - 2)
    expect(hitTest(c2, office, empty, p.x, p.y, alpha)).toBeNull()
  })
})

describe('hitRect', () => {
  it('outlines services and whiteboards, not whole areas', () => {
    expect(hitRect(office, { kind: 'board', podId: 'a', label: '' })).toEqual({ x: alpha.boardRect.x, y: alpha.rect.y, w: TILE * 3, h: TILE })
    expect(hitRect(office, { kind: 'facility', key: 'clock', label: '' })).toEqual(office.facilities.find((f) => f.key === 'clock')!.rect)
    expect(hitRect(office, { kind: 'pod', podId: 'a', label: '' })).toBeNull()
    expect(hitRect(office, { kind: 'pod', podId: 'a', label: '', thing: 'cabinet', rect: alpha.cabinetRect })).toEqual(alpha.cabinetRect)
  })
})

describe('sameHit', () => {
  it('matches on identity, not on label', () => {
    expect(sameHit({ kind: 'pod', podId: 'a', label: 'x' }, { kind: 'pod', podId: 'a', label: 'y' })).toBe(true)
    expect(sameHit({ kind: 'pod', podId: 'a', label: 'x' }, { kind: 'board', podId: 'a', label: 'x' })).toBe(false)
    expect(sameHit({ kind: 'facility', key: 'archive', label: '' }, { kind: 'facility', key: 'clock', label: '' })).toBe(false)
    expect(sameHit(null, { kind: 'facility', key: 'clock', label: '' })).toBe(false)
    expect(sameHit({ kind: 'hub', label: 'Hub' }, { kind: 'hub', label: 'Hub' })).toBe(true)
  })

  it('tells two desks in the same area apart', () => {
    const [d0, d1] = alpha.juniorDesks
    const desk = (rect: typeof d0) => ({ kind: 'pod' as const, podId: 'a', label: 'Alpha', thing: 'desk' as const, rect })
    expect(sameHit(desk(d0), desk(d0))).toBe(true)
    expect(sameHit(desk(d0), desk(d1))).toBe(false)
    expect(sameHit(desk(d0), { kind: 'pod', podId: 'a', label: 'Alpha' })).toBe(false)
  })
})

describe('area status', () => {
  const NOW = Date.now()
  const m = new WorldModel(() => 0.5)
  m.setOffice(office, NOW)
  m.sync(
    [
      { id: 's1', projectId: 'a', title: null, state: 'working', lastAt: NOW - 300_000, entrypoint: null, cwd: null },
      { id: 's2', projectId: 'a', title: null, state: 'waiting', lastAt: NOW - 300_000, entrypoint: null, cwd: null },
      { id: 's3', projectId: 'b', title: null, state: 'idle', lastAt: NOW - 300_000, entrypoint: null, cwd: null },
    ],
    NOW,
  )
  m.ingest({ kind: 'agent_start', sessionId: 's1', projectId: 'a', agentId: 'h1', agentType: null, description: null, model: null, ts: NOW }, NOW)

  it('counts seniors and juniors per area', () => {
    expect(podStatus(m, 'a')).toEqual({ waiting: 1, working: 1, open: 2, juniors: 1 })
    expect(podStatus(m, 'b')).toEqual({ waiting: 0, working: 0, open: 1, juniors: 0 })
  })

  it('puts a session that needs you first', () => {
    expect(statusText(podStatus(m, 'a'))).toBe('Needs your OK, 1 helper')
    expect(statusText(podStatus(m, 'b'))).toBe('Idle')
    expect(statusText({ waiting: 0, working: 3, open: 3, juniors: 2 })).toBe('3 working, 2 helpers')
    expect(statusText({ waiting: 0, working: 0, open: 0, juniors: 0 })).toBe('')
  })
})

describe('isGreyHair', () => {
  it('picks out grey and white hair', () => {
    expect(isGreyHair(200, 200, 205, 255)).toBe(true)
    expect(isGreyHair(150, 148, 152, 255)).toBe(true)
  })

  it('leaves skin, coloured hair, outlines and empty pixels alone', () => {
    expect(isGreyHair(240, 190, 150, 255)).toBe(false) // skin
    expect(isGreyHair(200, 110, 50, 255)).toBe(false) // ginger
    expect(isGreyHair(71, 45, 60, 255)).toBe(false) // outline
    expect(isGreyHair(200, 200, 200, 0)).toBe(false)
  })
})

describe('fitLine', () => {
  const ctx = { measureText: (t: string) => ({ width: t.length }) as TextMetrics }

  it('leaves text that fits alone', () => {
    expect(fitLine(ctx, 'Find auth', 10)).toBe('Find auth')
  })

  it('cuts text that does not fit and marks it', () => {
    expect(fitLine(ctx, 'Find auth callers', 10)).toBe('Find auth…')
    expect(fitLine(ctx, 'Supercalifragilistic', 6)).toBe('Super…')
  })

  it('drops a trailing space before the mark', () => {
    expect(fitLine(ctx, 'Find a thing', 8)).toBe('Find a…')
    expect(fitLine(ctx, 'Find  auth', 6)).toBe('Find…')
  })
})

describe('wrap', () => {
  // Every character is 1 unit wide, so widths are easy to reason about.
  const ctx = { measureText: (t: string) => ({ width: t.length }) as TextMetrics }

  it('keeps short text on one line', () => {
    expect(wrap(ctx, 'hello there', 20, 3)).toEqual(['hello there'])
  })

  it('breaks on spaces and never exceeds the width', () => {
    const lines = wrap(ctx, 'one two three four five six', 10, 5)
    expect(lines).toEqual(['one two', 'three four', 'five six'])
  })

  it('ends with an ellipsis when it runs out of lines', () => {
    const lines = wrap(ctx, 'one two three four five six seven eight', 10, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
    expect(lines[1].length).toBeLessThanOrEqual(10)
  })

  it('does not add an ellipsis when everything fits exactly', () => {
    expect(wrap(ctx, 'aaaa bbbb', 4, 2)).toEqual(['aaaa', 'bbbb'])
  })
})

describe('things on the walls', () => {
  it('opens a room’s settings from its name plate', () => {
    expect(hitFloor(office, alpha.plate.x + 20, alpha.plate.y + 4)).toEqual({ kind: 'plaque', podId: 'a', label: 'Alpha' })
    expect(hitRect(office, { kind: 'plaque', podId: 'a', label: 'Alpha' })).toEqual(alpha.plate)
  })

  it('lights the lamp by how the room is doing', () => {
    expect(lampFor({ waiting: 1, working: 1, open: 2, juniors: 0 })).toEqual({ color: ART.lampRed, blink: true })
    expect(lampFor({ waiting: 0, working: 1, open: 1, juniors: 0 }).color).toBe(ART.lampGreen)
    expect(lampFor({ waiting: 0, working: 0, open: 1, juniors: 0 }).color).toBe(ART.lampAmber)
    expect(lampFor({ waiting: 0, working: 0, open: 0, juniors: 0 }).color).toBe(ART.lampOff)
  })

  it('shows the sky for the time of day', () => {
    expect(skyAt(2).stars).toBe(true)
    expect(skyAt(12).clouds).toBe(true)
    expect(skyAt(12).stars).toBe(false)
    expect(skyAt(22).stars).toBe(true)
  })

  it('gets dark by the clock, lighting the lamps after dusk', () => {
    expect(darkness(12)).toBe(0)
    expect(darkness(2)).toBe(1)
    expect(darkness(23.5)).toBe(1)
    expect(darkness(6)).toBeCloseTo(0.5)
    // Darkening all evening, never lighter later on.
    for (let h = 17; h < 24; h += 0.25) expect(darkness(h + 0.25)).toBeGreaterThanOrEqual(darkness(h))
    expect(darkness(18)).toBeLessThan(LAMPS_ON)
    expect(darkness(20)).toBeGreaterThanOrEqual(LAMPS_ON)
  })
})

describe('doorAt', () => {
  it('finds the entrance and every doorway', () => {
    expect(doorAt(office, office.door.x, office.door.y)).toBe(true)
    expect(doorAt(office, office.entrance.x + 4, office.entrance.y + 10)).toBe(true)
    for (const d of alpha.doors) expect(doorAt(office, d.x + 1, d.y + d.h / 2)).toBe(true)
  })

  it('is not a door in the middle of a room', () => {
    expect(doorAt(office, podCenter(alpha).x, podCenter(alpha).y)).toBe(false)
    expect(doorAt(office, alpha.seniorSeats[0].x, alpha.seniorSeats[0].y)).toBe(false)
  })
})

describe('roleTag', () => {
  it('names the boss, managers, agents and helpers', () => {
    expect(roleTag({ rank: 'senior', role: 'boss' })).toEqual({ text: 'Boss', tone: 'boss' })
    expect(roleTag({ rank: 'senior', role: 'manager' })).toEqual({ text: 'Manager', tone: 'manager' })
    expect(roleTag({ rank: 'senior', role: null })).toEqual({ text: 'Agent', tone: 'agent' })
    expect(roleTag({ rank: 'junior' })).toEqual({ text: 'Helper', tone: 'helper' })
  })

  it('names agents and helpers by their task', () => {
    expect(roleTag({ rank: 'senior', role: null, label: 'Fix the login redirect' })).toEqual({ text: 'Fix the login redirect', tone: 'agent' })
    expect(roleTag({ rank: 'junior', label: 'Find auth callers' })).toEqual({ text: 'Find auth callers', tone: 'helper' })
    expect(roleTag({ rank: 'senior', role: 'boss', label: 'Weekly plan' }).text).toBe('Boss')
    expect(roleTag({ rank: 'senior', role: 'manager', label: 'Morning report' }).text).toBe('Manager')
  })

  it('keeps the plain role when there is no task name yet', () => {
    expect(roleTag({ rank: 'senior', role: null, label: 'Untitled session' }).text).toBe('Agent')
    expect(roleTag({ rank: 'senior', role: null, label: 'Session' }).text).toBe('Agent')
    expect(roleTag({ rank: 'junior', label: 'Helper' }).text).toBe('Helper')
    expect(roleTag({ rank: 'junior', label: '  ' }).text).toBe('Helper')
  })

  it('shortens long task names', () => {
    const t = roleTag({ rank: 'junior', label: 'Review the whole payments module for race conditions' }).text
    expect(t.length).toBeLessThanOrEqual(24)
    expect(t.endsWith('…')).toBe(true)
  })
})

describe('lookOf', () => {
  it('gives each rank its own people', () => {
    expect(lookOf({ rank: 'senior', role: 'boss', seed: 4 })).toBe(BOSS)
    expect(lookOf({ rank: 'senior', role: 'manager', seed: 4 })).toBe(MANAGER)
    const agents = new Set([0, 1, 2, 3].map((seed) => lookOf({ rank: 'senior', role: null, seed })))
    const helpers = new Set([0, 1, 2, 3].map((seed) => lookOf({ rank: 'junior', seed })))
    expect([...agents].sort()).toEqual([...SENIORS].sort())
    expect([...helpers].sort()).toEqual([...JUNIORS].sort())
    for (const a of agents) expect([BOSS, MANAGER, ...JUNIORS]).not.toContain(a)
  })

  it('keeps your look in the chat for you alone', () => {
    for (const role of ['boss', 'manager', null] as const) {
      for (const rank of ['senior', 'junior'] as const) {
        for (const seed of [0, 1, 2, 3]) expect(lookOf({ rank, role, seed })).not.toBe(YOU)
      }
    }
  })
})

describe('swapColors', () => {
  it('changes only the exact colours asked for', () => {
    const d = new Uint8ClampedArray([0xff, 0x71, 0x43, 255, 0xff, 0x71, 0x44, 255, 0xff, 0x71, 0x43, 0])
    swapColors(d, { '#ff7143': '#f2c14e' })
    expect([...d]).toEqual([0xf2, 0xc1, 0x4e, 255, 0xff, 0x71, 0x44, 255, 0xff, 0x71, 0x43, 0])
  })
})

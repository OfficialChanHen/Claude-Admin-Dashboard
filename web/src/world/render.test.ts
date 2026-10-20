import { describe, expect, it } from 'vitest'
import { Camera } from './camera'
import { buildOffice, TILE } from './office'
import { WorldModel, type Sprite } from './model'
import { hitFloor, hitRect, hitTest, podCenter, podStatus, sameHit, statusText, wrap, type Frame } from './render'

const office = buildOffice([
  { id: 'a', name: 'Alpha', color: 'sage' },
  { id: 'b', name: 'Beta', color: 'sky' },
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
    expect(hitFloor(office, alpha.rect.x + 20, alpha.rect.y + 6)).toEqual({ kind: 'board', podId: 'a', label: 'Alpha usage' })
    expect(hitFloor(office, alpha.rect.x + 80, alpha.rect.y + 90)).toEqual({ kind: 'pod', podId: 'a', label: 'Alpha' })
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
    expect(hitTest(c, office, { sprites: [], plaques: [] }, p.x, p.y)).toMatchObject({ kind: 'pod', podId: 'a' })
  })

  it('prefers a person over a plaque over the floor', () => {
    const plaque: Frame['plaques'][number] = { x: p.x - 20, y: p.y - 20, w: 40, h: 40, hit: { kind: 'plaque', podId: 'a', label: 'Alpha' } }
    const person: Frame['sprites'][number] = { x: p.x - 10, y: p.y - 10, w: 20, h: 20, s: sprite }
    expect(hitTest(c, office, { sprites: [], plaques: [plaque] }, p.x, p.y)).toEqual(plaque.hit)
    expect(hitTest(c, office, { sprites: [person], plaques: [plaque] }, p.x, p.y)).toEqual({ kind: 'sprite', sessionId: 's1', label: 'Fix login' })
  })

  it('takes the front one of two overlapping people', () => {
    const back: Frame['sprites'][number] = { x: 0, y: 0, w: 50, h: 50, s: { ...sprite, sessionId: 'back' } }
    const front: Frame['sprites'][number] = { x: 10, y: 10, w: 50, h: 50, s: { ...sprite, sessionId: 'front' } }
    expect(hitTest(c, office, { sprites: [back, front], plaques: [] }, 20, 20)).toMatchObject({ sessionId: 'front' })
  })
})

describe('hitRect', () => {
  it('outlines services and whiteboards, not whole areas', () => {
    expect(hitRect(office, { kind: 'board', podId: 'a', label: '' })).toEqual({ x: alpha.rect.x, y: alpha.rect.y, w: TILE * 3, h: TILE })
    expect(hitRect(office, { kind: 'facility', key: 'clock', label: '' })).toEqual(office.facilities.find((f) => f.key === 'clock')!.rect)
    expect(hitRect(office, { kind: 'pod', podId: 'a', label: '' })).toBeNull()
  })
})

describe('sameHit', () => {
  it('matches on identity, not on label', () => {
    expect(sameHit({ kind: 'pod', podId: 'a', label: 'x' }, { kind: 'pod', podId: 'a', label: 'y' })).toBe(true)
    expect(sameHit({ kind: 'pod', podId: 'a', label: 'x' }, { kind: 'board', podId: 'a', label: 'x' })).toBe(false)
    expect(sameHit({ kind: 'facility', key: 'archive', label: '' }, { kind: 'facility', key: 'clock', label: '' })).toBe(false)
    expect(sameHit(null, { kind: 'facility', key: 'clock', label: '' })).toBe(false)
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

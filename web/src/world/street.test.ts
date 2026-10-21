import { describe, expect, it } from 'vitest'
import { TILE } from './office'
import { carsIn, groundAt, hash, propAt, walkersIn, ROAD, WALK, OUTER_WALK } from './street'

const COLS = 20
const ROWS = 12

describe('groundAt', () => {
  it('rings the building with sidewalk, then road, then sidewalk, then park', () => {
    expect(groundAt(5, 5, COLS, ROWS)).toBe('building')
    expect(groundAt(5, -1, COLS, ROWS)).toBe('walk')
    expect(groundAt(5, -WALK - 1, COLS, ROWS)).toBe('road')
    expect(groundAt(5, -WALK - ROAD, COLS, ROWS)).toBe('road')
    expect(groundAt(5, -WALK - ROAD - 1, COLS, ROWS)).toBe('walk')
    expect(groundAt(5, -WALK - ROAD - OUTER_WALK - 1, COLS, ROWS)).toBe('grass')
    expect(groundAt(COLS, 5, COLS, ROWS)).toBe('walk')
    expect(groundAt(COLS + WALK, 5, COLS, ROWS)).toBe('road')
  })

  it('carries the roads on past the corners as cross streets', () => {
    expect(groundAt(-WALK - 1, -40, COLS, ROWS)).toBe('road')
    expect(groundAt(80, ROWS + WALK, COLS, ROWS)).toBe('road')
    expect(groundAt(80, 5, COLS, ROWS)).toBe('grass')
  })
})

describe('propAt', () => {
  it('never puts anything on the road or in the building', () => {
    for (let tx = -30; tx < COLS + 30; tx++)
      for (let ty = -30; ty < ROWS + 30; ty++) {
        const g = groundAt(tx, ty, COLS, ROWS)
        if (g === 'road' || g === 'building') expect(propAt(tx, ty, COLS, ROWS)).toBeNull()
      }
  })

  it('plants a park with trees and lines the kerbs with lamps', () => {
    const kinds = new Set<string>()
    for (let tx = -30; tx < COLS + 30; tx++) for (let ty = -30; ty < ROWS + 30; ty++) {
      const p = propAt(tx, ty, COLS, ROWS)
      if (p) kinds.add(p.kind)
    }
    expect(kinds).toContain('tree')
    expect(kinds).toContain('lamp')
    expect(kinds).toContain('bench')
  })

  it('is the same every time', () => {
    expect(propAt(-15, -15, COLS, ROWS)).toEqual(propAt(-15, -15, COLS, ROWS))
    expect(hash(3, 4)).toBe(hash(3, 4))
  })
})

describe('carsIn', () => {
  const W = COLS * TILE
  const H = ROWS * TILE
  const view = { x: -400, y: -300, w: W + 800, h: H + 600 }

  it('keeps every car on the road', () => {
    for (const t of [0, 5_000, 61_000]) {
      for (const c of carsIn(view, W, H, t)) {
        expect(groundAt(Math.floor(c.x / TILE), Math.floor(c.y / TILE), COLS, ROWS)).toBe('road')
      }
    }
  })

  it('never has two cars driving through each other at a crossing', () => {
    for (let t = 0; t < 60_000; t += 250) {
      const cars = carsIn(view, W, H, t)
      for (const a of cars) for (const b of cars) {
        if (a === b || (a.dir === 'left' || a.dir === 'right') === (b.dir === 'left' || b.dir === 'right')) continue
        expect(Math.abs(a.x - b.x) < 28 && Math.abs(a.y - b.y) < 26).toBe(false)
      }
    }
  })

  it('moves them along over time', () => {
    const a = carsIn(view, W, H, 0)
    const b = carsIn(view, W, H, 1000)
    expect(a.length).toBeGreaterThan(0)
    expect(b).not.toEqual(a)
  })
})

describe('walkersIn', () => {
  it('keeps people on the sidewalk', () => {
    const W = COLS * TILE
    const H = ROWS * TILE
    const people = walkersIn({ x: -400, y: -300, w: W + 800, h: H + 600 }, W, H, 12_345)
    expect(people.length).toBeGreaterThan(0)
    for (const p of people) {
      const g = groundAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE), COLS, ROWS)
      expect(g === 'walk' || g === 'road').toBe(true) // crossing the end of a street is fine
    }
  })
})

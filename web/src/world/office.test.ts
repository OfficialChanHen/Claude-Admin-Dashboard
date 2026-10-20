import { describe, expect, it } from 'vitest'
import { JUNIOR_SLOTS, SENIOR_SLOTS, areaAt, buildOffice, gridFor, route, type Point, type Rect } from './office'

const infos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Project ${i}`, color: 'sage' }))
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

/** Does the segment a-b pass through the inside of r? Segments are straight lines across or down. */
function crosses(a: Point, b: Point, r: Rect) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y))
  for (let i = 1; i < steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }
    if (p.x > r.x + 1 && p.x < r.x + r.w - 1 && p.y > r.y + 1 && p.y < r.y + r.h - 1) return true
  }
  return false
}

describe('gridFor', () => {
  it.each([0, 1, 2, 5, 11, 12, 30])('has room for %i areas and the hub', (n) => {
    const g = gridFor(n)
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(n + 1)
    expect(g.cols).toBeGreaterThanOrEqual(g.rows)
  })
})

describe('buildOffice', () => {
  it.each([0, 1, 4, 12, 25])('gives %i projects their own area on the floor', (n) => {
    const o = buildOffice(infos(n))
    expect(o.pods).toHaveLength(n)
    const rects = [...o.pods.map((p) => p.rect), o.hub.rect]
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(o.w)
      expect(r.y + r.h).toBeLessThanOrEqual(o.h)
    }
    rects.forEach((a, i) => rects.forEach((b, j) => i !== j && expect(overlaps(a, b)).toBe(false)))
  })

  it('puts the hub in the middle and the first projects next to it', () => {
    const o = buildOffice(infos(12))
    const center = { c: Math.floor((o.grid.cols - 1) / 2), r: Math.floor((o.grid.rows - 1) / 2) }
    expect(o.hub.cell).toEqual(center)
    const dist = (c: { c: number; r: number }) => Math.abs(c.c - center.c) + Math.abs(c.r - center.r)
    expect(dist(o.pods[0].cell)).toBe(1)
    for (let i = 1; i < o.pods.length; i++) expect(dist(o.pods[i].cell)).toBeGreaterThanOrEqual(dist(o.pods[i - 1].cell))
  })

  it('gives every area its senior and junior desks, inside the area', () => {
    const o = buildOffice(infos(3))
    for (const p of o.pods) {
      expect(p.seniorSeats).toHaveLength(SENIOR_SLOTS)
      expect(p.juniorSeats).toHaveLength(JUNIOR_SLOTS)
      for (const s of [...p.seniorSeats, ...p.juniorSeats, p.board, p.cabinet]) expect(inside(s, p.rect)).toBe(true)
    }
  })

  it('has the four office services in the hub', () => {
    const o = buildOffice(infos(3))
    expect(o.facilities.map((f) => f.key).sort()).toEqual(['accounts', 'archive', 'clock', 'reception'])
    for (const f of o.facilities) expect(overlaps(f.rect, o.hub.rect)).toBe(true)
  })

  it('has break spots in the hub and a door on the bottom edge', () => {
    const o = buildOffice(infos(3))
    expect(o.breakSpots.length).toBeGreaterThan(3)
    for (const b of o.breakSpots) expect(areaAt(o, b)).toBe(o.hub)
    expect(o.door.y).toBeGreaterThan(Math.max(...[...o.pods, o.hub].map((a) => a.rect.y + a.rect.h)))
  })

  it('is the same every time for the same projects', () => {
    expect(buildOffice(infos(6))).toEqual(buildOffice(infos(6)))
  })
})

describe('route', () => {
  const o = buildOffice(infos(8))
  const desks = o.pods.flatMap((p) => [...p.seniorDesks, ...p.juniorDesks])
  const spots: Point[] = [
    ...o.pods.flatMap((p) => [...p.seniorSeats, ...p.juniorSeats, p.board, p.cabinet]),
    ...o.breakSpots,
    o.door,
  ]

  it('ends where it was asked to go', () => {
    const r = route(o, o.door, o.pods[3].seniorSeats[1])
    expect(r[r.length - 1]).toEqual(o.pods[3].seniorSeats[1])
  })

  it('only walks straight across or straight down', () => {
    for (let i = 0; i < spots.length; i += 3) {
      for (let j = 1; j < spots.length; j += 5) {
        const pts = [spots[i], ...route(o, spots[i], spots[j])]
        for (let k = 1; k < pts.length; k++) {
          const flat = Math.abs(pts[k].x - pts[k - 1].x) < 0.01 || Math.abs(pts[k].y - pts[k - 1].y) < 0.01
          expect(flat).toBe(true)
        }
      }
    }
  })

  it('never walks through a desk', () => {
    for (let i = 0; i < spots.length; i += 2) {
      for (let j = 1; j < spots.length; j += 3) {
        const pts = [spots[i], ...route(o, spots[i], spots[j])]
        for (let k = 1; k < pts.length; k++) for (const d of desks) expect(crosses(pts[k - 1], pts[k], d)).toBe(false)
      }
    }
  })

  it('stays put when already there', () => {
    expect(route(o, o.pods[0].board, o.pods[0].board)).toEqual([])
  })
})

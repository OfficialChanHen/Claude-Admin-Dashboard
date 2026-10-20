import { describe, expect, it } from 'vitest'
import {
  FIXTURE_H, FLOORS, HUB, JUNIOR_SLOTS, ROOM_WALL, SENIOR_SLOTS, TILE, WALL, areaAt, buildOffice, gridFor, looksFor, neighbor, outerRect, roomBounds, roomById,
  rooms, route, wallBand,
  type Area, type Point, type Rect,
} from './office'

const infos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Project ${i}` }))
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

  it.each([3, 12])('has the office services in and on the walls of the hub, with %i projects', (n) => {
    const o = buildOffice(infos(n))
    expect(o.facilities.map((f) => f.key).sort()).toEqual(['accounts', 'archive', 'clock', 'lights', 'limits', 'notice', 'reception'])
    for (const f of o.facilities) if (f.key !== 'lights') expect(overlaps(f.rect, roomBounds(o.hub))).toBe(true)
    // Fixtures never overlap each other.
    o.facilities.forEach((a, i) => o.facilities.forEach((b, j) => i !== j && expect(overlaps(a.rect, b.rect)).toBe(false)))
  })

  it.each([3, 12])('hangs the clock and name plates on back walls, not on the floor, with %i projects', (n) => {
    const o = buildOffice(infos(n))
    const onWall = (r: Rect, a: Area) => {
      const w = outerRect(a)
      return r.y + r.h <= a.rect.y && r.y >= Math.min(w.y, a.rect.y - ROOM_WALL - FIXTURE_H - 1) && r.x >= w.x && r.x + r.w <= w.x + w.w
    }
    expect(onWall(o.facilities.find((f) => f.key === 'clock')!.rect, o.hub)).toBe(true)
    for (const p of o.pods) expect(onWall(p.plate, p)).toBe(true)
    for (const p of o.pods) {
      expect(onWall(p.clipboard, p)).toBe(true)
      expect(overlaps(p.clipboard, p.plate)).toBe(false)
    }
    for (const a of rooms(o)) expect(wallBand(a)).toBeGreaterThanOrEqual(0)
  })

  it('has break spots in the hub and a way in through the back wall', () => {
    const o = buildOffice(infos(3))
    expect(o.breakSpots.length).toBeGreaterThan(3)
    for (const b of o.breakSpots) expect(areaAt(o, b)).toBe(o.hub)
    expect(o.entrance.y + o.entrance.h).toBe(WALL * TILE)
    expect(areaAt(o, o.door)).toBeNull()
    expect(o.corridorXs).toContain(o.door.x)
  })

  it('keeps the windows clear of the sign and the entrance', () => {
    const o = buildOffice(infos(12))
    expect(o.windows.length).toBeGreaterThan(0)
    for (const w of o.windows) {
      expect(overlaps(w, o.sign)).toBe(false)
      expect(overlaps(w, o.entrance)).toBe(false)
    }
  })

  it('is the same every time for the same projects', () => {
    expect(buildOffice(infos(6))).toEqual(buildOffice(infos(6)))
  })

  it('keeps the whiteboard and cabinets inside the area whichever way round it is', () => {
    const o = buildOffice(infos(20))
    expect(new Set(o.pods.map((p) => p.look.mirror)).size).toBe(2)
    for (const p of o.pods) {
      for (const s of [p.board, p.cabinet, { x: p.cabinet.x - 12, y: p.cabinet.y }]) expect(inside(s, p.rect)).toBe(true)
      expect(inside(p.boardRect, p.rect)).toBe(true)
      expect(Math.abs(p.board.x - (p.boardRect.x + p.boardRect.w / 2))).toBeLessThanOrEqual(TILE)
    }
  })
})

describe('looksFor', () => {
  const key = (l: { floor: string; tone: number; mirror: boolean; decor: number }) => `${l.floor}${l.tone}${l.mirror}${l.decor}`

  it('never gives two areas the same look', () => {
    const looks = looksFor(Array.from({ length: 60 }, (_, i) => `/home/me/project-${i}`))
    expect(new Set(looks.map(key)).size).toBe(60)
  })

  it('gives the first areas all different floors', () => {
    const looks = looksFor(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(new Set(looks.map((l) => l.floor)).size).toBe(FLOORS.length)
  })

  it('keeps an area’s look when another is added after it', () => {
    const ids = ['/x/alpha', '/x/beta', '/x/gamma']
    expect(looksFor([...ids, '/x/delta']).slice(0, 3)).toEqual(looksFor(ids))
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

  it('only goes in and out of a room through its doors', () => {
    const inRoom = (p: Point, a: Area) => p.x > a.rect.x && p.x < a.rect.x + a.rect.w && p.y > a.rect.y && p.y < a.rect.y + a.rect.h
    const atDoor = (p: Point, a: Area) => a.doors.some((d) => Math.abs(p.x - d.x) <= 2 && p.y >= d.y && p.y <= d.y + d.h)
    for (let i = 0; i < spots.length; i += 2) {
      for (let j = 1; j < spots.length; j += 3) {
        const pts = [spots[i], ...route(o, spots[i], spots[j])]
        for (let k = 1; k < pts.length; k++) {
          const [a, b] = [pts[k - 1], pts[k]]
          const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y))
          for (let n = 1; n <= steps; n++) {
            const p = { x: a.x + ((b.x - a.x) * (n - 1)) / steps, y: a.y + ((b.y - a.y) * (n - 1)) / steps }
            const q = { x: a.x + ((b.x - a.x) * n) / steps, y: a.y + ((b.y - a.y) * n) / steps }
            for (const r of rooms(o)) if (inRoom(p, r) !== inRoom(q, r)) expect(atDoor(q, r) || atDoor(p, r)).toBe(true)
          }
        }
      }
    }
  })
})

describe('rooms', () => {
  const o = buildOffice(infos(8))

  it('has a door at the end of every aisle, in the right-hand wall', () => {
    for (const a of rooms(o)) {
      expect(a.doors).toHaveLength(a.aisles.length)
      a.doors.forEach((d, i) => {
        expect(d.x).toBe(a.rect.x + a.rect.w)
        expect(a.aisles[i]).toBeGreaterThan(d.y)
        expect(a.aisles[i]).toBeLessThan(d.y + d.h)
      })
    }
  })

  it('keeps every room and its walls apart from the others and from the walkways', () => {
    const walls = rooms(o).map(outerRect)
    walls.forEach((a, i) => walls.forEach((b, j) => i !== j && expect(overlaps(a, b)).toBe(false)))
    for (const w of walls) {
      for (const x of o.corridorXs) expect(x > w.x && x < w.x + w.w).toBe(false)
      for (const y of o.corridorYs) expect(y > w.y && y < w.y + w.h).toBe(false)
    }
  })

  it('frames each room with its walls and its name plaque', () => {
    for (const a of rooms(o)) {
      const b = roomBounds(a)
      const w = outerRect(a)
      expect(b.x).toBeLessThan(w.x)
      expect(b.y).toBeLessThan(w.y)
      expect(b.x + b.w).toBeGreaterThan(w.x + w.w)
      expect(b.y + b.h).toBeGreaterThan(w.y + w.h)
    }
  })

  it('finds rooms by id, the hub included', () => {
    expect(roomById(o, HUB)).toBe(o.hub)
    expect(roomById(o, 'p3')).toBe(o.pods[3])
    expect(roomById(o, 'nope')).toBeNull()
  })

  it('knows the room next door in each direction', () => {
    const at = (c: number, r: number) => rooms(o).find((a) => a.cell.c === c && a.cell.r === r)
    for (const a of rooms(o)) {
      const right = at(a.cell.c + 1, a.cell.r)
      if (right) expect(neighbor(o, a.id, 'right')).toBe(right)
      const down = at(a.cell.c, a.cell.r + 1)
      if (down) expect(neighbor(o, a.id, 'down')).toBe(down)
    }
    const corner = rooms(o).find((a) => a.cell.c === 0 && a.cell.r === 0)!
    expect(neighbor(o, corner.id, 'left')).toBeNull()
    expect(neighbor(o, corner.id, 'up')).toBeNull()
  })

  it('skips a gap to the nearest room that way', () => {
    // Nine projects and the hub on a 4 by 3 grid: rooms fill outward from the
    // hub at (1, 1), so the two far corners on the right stay empty.
    const big = buildOffice(infos(9))
    expect(big.grid).toEqual({ cols: 4, rows: 3 })
    const at = (c: number, r: number) => rooms(big).find((a) => a.cell.c === c && a.cell.r === r)
    expect(at(3, 0)).toBeUndefined()
    expect(at(3, 2)).toBeUndefined()
    expect(neighbor(big, at(3, 1)!.id, 'down')?.cell).toEqual({ c: 2, r: 2 })
    expect(neighbor(big, at(2, 2)!.id, 'right')?.cell).toEqual({ c: 3, r: 1 })
    expect(neighbor(big, at(3, 1)!.id, 'right')).toBeNull()
  })

  it('puts the cabinets where people stand to read', () => {
    for (const p of buildOffice(infos(12)).pods) {
      expect(p.cabinet.x).toBeGreaterThanOrEqual(p.cabinetRect.x)
      expect(p.cabinet.x - 12).toBeLessThanOrEqual(p.cabinetRect.x + p.cabinetRect.w)
      expect(overlaps(p.cabinetRect, p.boardRect)).toBe(false)
    }
  })

  it('has its break furniture in the hub', () => {
    expect(o.lounge.map((l) => l.thing).sort()).toEqual(['coffee', 'sofa', 'table', 'vending'])
    for (const l of o.lounge) expect(areaAt(o, { x: l.rect.x + 1, y: l.rect.y + 1 })).toBe(o.hub)
  })
})

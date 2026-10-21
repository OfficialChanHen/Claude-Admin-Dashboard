// The city block around the office, seen when you zoom out: a sidewalk round
// the building, a two-lane road on every side that carries on as cross
// streets, another sidewalk, then park. Cars drive the roads and people walk
// the sidewalks. Everything here is worked out from a tile's position and the
// clock, so nothing is stored and the street goes on as far as you can zoom.
//
// Positions are art pixels with the office's top-left corner at (0, 0).

import { TILE } from './office'

/** Bands outward from the building, in tiles. */
export const WALK = 2
export const ROAD = 4
export const OUTER_WALK = 2
const ROAD_FROM = WALK
const ROAD_TO = WALK + ROAD
const PARK_FROM = ROAD_TO + OUTER_WALK

export type Ground = 'building' | 'walk' | 'road' | 'grass'

/** How many tiles outside the building a coordinate is along one axis, or -1 inside its span. */
function out(t: number, n: number) {
  return t < 0 ? -t - 1 : t >= n ? t - n : -1
}

function band(d: number): Ground | null {
  if (d < 0) return null
  if (d < ROAD_FROM) return 'walk'
  if (d < ROAD_TO) return 'road'
  if (d < PARK_FROM) return 'walk'
  return 'grass'
}

/** What is on the ground at tile (tx, ty) of a building `cols` by `rows` tiles. */
export function groundAt(tx: number, ty: number, cols: number, rows: number): Ground {
  const dx = out(tx, cols)
  const dy = out(ty, rows)
  if (dx < 0 && dy < 0) return 'building'
  const bx = band(dx)
  const by = band(dy)
  if (bx === 'road' || by === 'road') return 'road'
  // The sidewalk next to the building wraps its corners; the outer ones follow the roads.
  if (bx === 'walk' || by === 'walk') return 'walk'
  return 'grass'
}

/** A small, stable hash of a tile, from 0 to 1. */
export function hash(x: number, y: number, salt = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export type PropKind = 'tree' | 'bush' | 'lamp' | 'bench' | 'bin' | 'hydrant' | 'planter'
/** `x` is the middle of the prop and `y` its foot, so props sort by how far down they stand. */
export type Prop = { kind: PropKind; x: number; y: number; variant: number; flip?: boolean }

/** Props standing on tile (tx, ty), if any. */
export function propAt(tx: number, ty: number, cols: number, rows: number): Prop | null {
  const g = groundAt(tx, ty, cols, rows)
  const cx = tx * TILE + TILE / 2
  const foot = ty * TILE + TILE - 1
  const dx = out(tx, cols)
  const dy = out(ty, rows)
  const r = hash(tx, ty)
  if (g === 'grass') {
    // Keep the park's first row open so trees don't crowd the sidewalk.
    if (Math.max(dx, dy) === PARK_FROM) return null
    if (r < 0.1) return { kind: 'tree', x: cx, y: foot, variant: Math.floor(hash(tx, ty, 1) * 6) }
    if (r < 0.14) return { kind: 'bush', x: cx, y: foot, variant: Math.floor(hash(tx, ty, 2) * 6) }
    return null
  }
  if (g !== 'walk') return null
  // Along each sidewalk: which way it runs, and how far along it this tile is.
  const along = dx >= 0 && (dy < 0 || dx < dy) ? ty : tx
  const d = Math.max(dx, dy)
  const kerb = d === ROAD_FROM - 1 || d === ROAD_TO
  if (kerb && mod(along, 7) === 3) {
    // Street lamps lean to one side; alternate them along the street.
    return { kind: 'lamp', x: cx, y: foot, variant: 0, flip: mod(along, 14) === 3 }
  }
  // Street trees on the far kerb, between the lamps, so there is green in view at any zoom.
  if (d === ROAD_TO && mod(along, 7) === 0) return { kind: 'tree', x: cx, y: foot, variant: Math.floor(hash(tx, ty, 4) * 6) }
  // Planters against the building.
  if (d === 0 && mod(along, 9) === 4) return { kind: 'planter', x: cx, y: foot, variant: Math.floor(hash(tx, ty, 5) * 2) }
  if (d === PARK_FROM - 1) {
    if (mod(along, 11) === 5) return { kind: 'bench', x: cx, y: foot, variant: 0 }
    if (mod(along, 11) === 8 && r < 0.6) return { kind: r < 0.3 ? 'bin' : 'planter', x: cx, y: foot, variant: Math.floor(hash(tx, ty, 3) * 3) }
  }
  if (kerb && mod(along, 23) === 13) return { kind: 'hydrant', x: cx, y: foot, variant: 0 }
  return null
}

function mod(a: number, n: number) {
  return ((a % n) + n) % n
}

export type CarDir = 'left' | 'right' | 'up' | 'down'
export type Car = { x: number; y: number; dir: CarDir; color: number }

/** Whether a car centred at `y` on an up-and-down street would be in a crossing (with room for its length). */
function crossing(y: number, h: number) {
  const half = 16
  const top = [-ROAD_TO * TILE - half, -ROAD_FROM * TILE + half]
  const bottom = [h + ROAD_FROM * TILE - half, h + ROAD_TO * TILE + half]
  return (y > top[0] && y < top[1]) || (y > bottom[0] && y < bottom[1])
}

const CAR_GAP = 220 // art px between cars in one lane, on average
const CAR_SPEED = 38 // art px per second
const LANE = (ROAD * TILE) / 2

/**
 * The cars in the art-pixel rectangle at time `t` (ms). Each car is centred on
 * (x, y). They drive on the right: the lane nearer the building runs one way
 * and the far lane the other, on all four streets.
 */
export function carsIn(view: { x: number; y: number; w: number; h: number }, w: number, h: number, t: number): Car[] {
  const cars: Car[] = []
  const s = (t / 1000) * CAR_SPEED
  const lanes: { horizontal: boolean; at: number; dir: CarDir; seed: number }[] = []
  const near = ROAD_FROM * TILE
  // Top street: the far lane (outer) runs left, the near lane right. Bottom is the mirror.
  lanes.push({ horizontal: true, at: -near - LANE / 2, dir: 'right', seed: 1 })
  lanes.push({ horizontal: true, at: -near - LANE * 1.5, dir: 'left', seed: 2 })
  lanes.push({ horizontal: true, at: h + near + LANE / 2, dir: 'left', seed: 3 })
  lanes.push({ horizontal: true, at: h + near + LANE * 1.5, dir: 'right', seed: 4 })
  lanes.push({ horizontal: false, at: -near - LANE / 2, dir: 'up', seed: 5 })
  lanes.push({ horizontal: false, at: -near - LANE * 1.5, dir: 'down', seed: 6 })
  lanes.push({ horizontal: false, at: w + near + LANE / 2, dir: 'down', seed: 7 })
  lanes.push({ horizontal: false, at: w + near + LANE * 1.5, dir: 'up', seed: 8 })
  for (const l of lanes) {
    const across = l.horizontal ? [view.y, view.y + view.h] : [view.x, view.x + view.w]
    if (l.at < across[0] - LANE || l.at > across[1] + LANE) continue
    const span = l.horizontal ? [view.x, view.x + view.w] : [view.y, view.y + view.h]
    const sign = l.dir === 'right' || l.dir === 'down' ? 1 : -1
    const shift = sign * s
    // Car i sits at i * CAR_GAP (plus a little jitter) and moves along with time.
    const first = Math.floor((span[0] - shift - CAR_GAP) / CAR_GAP)
    const last = Math.ceil((span[1] - shift + CAR_GAP) / CAR_GAP)
    for (let i = first; i <= last; i++) {
      // Some gaps are empty, so traffic comes in bunches.
      if (hash(i, l.seed, 9) < 0.35) continue
      const pos = i * CAR_GAP + hash(i, l.seed, 10) * CAR_GAP * 0.5 + shift
      // The streets running up and down give way at the crossings, so two cars never drive through each other.
      if (!l.horizontal && crossing(pos, h)) continue
      const color = Math.floor(hash(i, l.seed, 11) * 3)
      cars.push(l.horizontal ? { x: pos, y: l.at, dir: l.dir, color } : { x: l.at, y: pos, dir: l.dir, color })
    }
  }
  return cars
}

export type Walker = { x: number; y: number; dir: CarDir; look: number; step: number }

const WALKER_GAP = 150
const WALKER_SPEED = 14

/** People out walking on the sidewalks by the road, both ways, at time `t` (ms). */
export function walkersIn(view: { x: number; y: number; w: number; h: number }, w: number, h: number, t: number): Walker[] {
  const out: Walker[] = []
  const s = (t / 1000) * WALKER_SPEED
  const paths: { horizontal: boolean; at: number; seed: number }[] = [
    { horizontal: true, at: -TILE * 0.6, seed: 21 },
    { horizontal: true, at: -(ROAD_TO + 1) * TILE - TILE * 0.4, seed: 22 },
    { horizontal: true, at: h + TILE * 1.4, seed: 23 },
    { horizontal: true, at: h + (ROAD_TO + 1) * TILE + TILE * 0.6, seed: 24 },
    { horizontal: false, at: -TILE, seed: 25 },
    { horizontal: false, at: -(ROAD_TO + 1) * TILE, seed: 26 },
    { horizontal: false, at: w + TILE, seed: 27 },
    { horizontal: false, at: w + (ROAD_TO + 1) * TILE, seed: 28 },
  ]
  for (const p of paths) {
    const across = p.horizontal ? [view.y, view.y + view.h] : [view.x, view.x + view.w]
    if (p.at < across[0] - TILE * 2 || p.at > across[1] + TILE * 2) continue
    const span = p.horizontal ? [view.x, view.x + view.w] : [view.y, view.y + view.h]
    for (const sign of [1, -1]) {
      const shift = sign * s
      const first = Math.floor((span[0] - shift - WALKER_GAP) / WALKER_GAP)
      const last = Math.ceil((span[1] - shift + WALKER_GAP) / WALKER_GAP)
      for (let i = first; i <= last; i++) {
        if (hash(i, p.seed, sign) < 0.55) continue
        const pos = i * WALKER_GAP + hash(i, p.seed, sign + 5) * WALKER_GAP + shift
        const dir: CarDir = p.horizontal ? (sign > 0 ? 'right' : 'left') : sign > 0 ? 'down' : 'up'
        // Side by side, two people heading opposite ways keep apart.
        const lane = sign * 3
        const step = Math.floor((pos / 6) % 4 + 4) % 4
        const look = Math.floor(hash(i, p.seed, sign + 9) * 6)
        out.push(p.horizontal ? { x: pos, y: p.at + lane, dir, look, step } : { x: p.at + lane, y: pos, dir, look, step })
      }
    }
  }
  return out
}

// The office floor: one cubicle area per project around a shared hub, with
// aisles between them. Everything here is pure, so the layout and the walking
// routes can be tested. Tiles are 16 art pixels; positions are art pixels
// unless they say tiles. A person's position is where their feet are.

export const TILE = 16
export const POD_W = 10 // tiles
export const POD_H = 8
export const GAP = 2 // aisle tiles right of and below each area
export const CELL_W = POD_W + GAP
export const CELL_H = POD_H + GAP
export const WALL = 2 // wall rows along the top
export const EDGE = 2 // aisle tiles along the left

export type Sheet = 'indoor' | 'urban'
export type Prop = { sheet: Sheet; c: number; r: number; x: number; y: number } // sheet tile, then art px on the floor
export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number } // art px

export type AreaKind = 'pod' | 'hub'
export type Area = {
  id: string
  kind: AreaKind
  name: string
  color: string
  rect: Rect
  cell: { c: number; r: number }
  /** Rows people walk along inside the area. */
  aisles: number[]
  /** The aisle column just right of the area, which runs the full floor. */
  exitX: number
}

export type Pod = Area & {
  seniorSeats: Point[]
  juniorSeats: Point[]
  seniorDesks: Rect[]
  juniorDesks: Rect[]
  board: Point // stand here to plan
  cabinet: Point // stand here to look things up
}

export type FacilityKey = 'reception' | 'accounts' | 'archive' | 'clock'
export type Facility = { key: FacilityKey; label: string; rect: Rect; stand: Point }

export type BreakSpot = Point & { kind: 'coffee' | 'vending' | 'table' | 'sofa' | 'window' | 'plant'; face: Facing }
export type Facing = 'up' | 'down' | 'left' | 'right'

export type Office = {
  w: number // art px
  h: number
  grid: { cols: number; rows: number }
  pods: Pod[]
  hub: Area
  facilities: Facility[]
  breakSpots: BreakSpot[]
  door: Point
  corridorYs: number[]
  corridorXs: number[]
  props: Prop[]
  monitors: Point[] // top-left of each desk monitor, drawn by hand
}

export type PodInfo = { id: string; name: string; color: string }

/** Cells across and down for n pods plus the hub, wider than tall like a screen. */
export function gridFor(pods: number) {
  const n = pods + 1
  const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.5)))
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) }
}

const t = (n: number) => n * TILE

// Inside an area (tiles): row 0 boards and cabinets, row 1 aisle, row 2 senior
// desks, row 3 their chairs, row 4 aisle, row 5 junior desks, row 6 their
// chairs, row 7 aisle.
const AISLE_ROWS = [1, 4, 7]
const SENIOR_COLS = [1, 4, 7] // each desk is two tiles wide
const JUNIOR_COLS = [1, 3, 5, 7]

export const SENIOR_SLOTS = SENIOR_COLS.length
export const JUNIOR_SLOTS = JUNIOR_COLS.length

export function buildOffice(infos: PodInfo[]): Office {
  const grid = gridFor(infos.length)
  const hubCell = { c: Math.floor((grid.cols - 1) / 2), r: Math.floor((grid.rows - 1) / 2) }
  const cellOrigin = (c: number, r: number) => ({ x: t(EDGE + c * CELL_W), y: t(WALL + r * CELL_H) })

  // Nearest cells to the hub first, so the first projects sit closest.
  const cells: { c: number; r: number }[] = []
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (c !== hubCell.c || r !== hubCell.r) cells.push({ c, r })
  const dist = (a: { c: number; r: number }) => Math.abs(a.c - hubCell.c) + Math.abs(a.r - hubCell.r)
  cells.sort((a, b) => dist(a) - dist(b) || a.r - b.r || a.c - b.c)

  const props: Prop[] = []
  const monitors: Point[] = []
  const put = (sheet: Sheet, c: number, r: number, x: number, y: number) => props.push({ sheet, c, r, x, y })

  const area = (id: string, kind: AreaKind, name: string, color: string, cell: { c: number; r: number }): Area => {
    const o = cellOrigin(cell.c, cell.r)
    return {
      id, kind, name, color, cell,
      rect: { x: o.x, y: o.y, w: t(POD_W), h: t(POD_H) },
      aisles: AISLE_ROWS.map((row) => o.y + t(row) + 12),
      exitX: o.x + t(POD_W) + t(GAP) / 2,
    }
  }

  const pods: Pod[] = infos.map((info, i) => {
    const a = area(info.id, 'pod', info.name, info.color, cells[i])
    const { x, y } = a.rect
    put('urban', 8, 13, x + t(0), y)
    put('urban', 9, 13, x + t(1), y)
    put('urban', 10, 13, x + t(2), y) // whiteboard
    put('indoor', 1, 13, x + t(8), y)
    put('indoor', 1, 13, x + t(9), y) // filing cabinets
    put('indoor', 16, 0, x + t(5), y) // plant
    const seniorDesks: Rect[] = []
    const seniorSeats: Point[] = []
    for (const c of SENIOR_COLS) {
      put('indoor', 0, 1, x + t(c), y + t(2))
      put('indoor', 2, 1, x + t(c + 1), y + t(2))
      put('indoor', 1, 8, x + t(c) + 8, y + t(3)) // office chair, seen from behind
      monitors.push({ x: x + t(c + 1) - 5, y: y + t(2) - 3 })
      seniorDesks.push({ x: x + t(c), y: y + t(2), w: t(2), h: t(1) })
      seniorSeats.push({ x: x + t(c + 1), y: y + t(3) + 13 })
    }
    const juniorDesks: Rect[] = []
    const juniorSeats: Point[] = []
    for (const c of JUNIOR_COLS) {
      put('indoor', 5, 4, x + t(c), y + t(5))
      put('indoor', 1, 8, x + t(c), y + t(6))
      monitors.push({ x: x + t(c) + 3, y: y + t(5) - 2 })
      juniorDesks.push({ x: x + t(c), y: y + t(5), w: t(1), h: t(1) })
      juniorSeats.push({ x: x + t(c) + 8, y: y + t(6) + 13 })
    }
    put('indoor', 17, 0, x + t(9), y + t(6)) // plant by the junior desks
    return {
      ...a,
      seniorDesks, seniorSeats, juniorDesks, juniorSeats,
      board: { x: x + t(1) + 8, y: a.aisles[0] },
      cabinet: { x: x + t(9), y: a.aisles[0] },
    }
  })

  // The hub: break area on the left, office services on the right.
  const hub = area('_hub', 'hub', 'Hub', 'stone', hubCell)
  const { x: hx, y: hy } = hub.rect
  put('indoor', 5, 12, hx, hy)
  put('indoor', 6, 12, hx + t(1), hy)
  put('indoor', 7, 12, hx + t(2), hy) // coffee counter
  put('urban', 12, 10, hx + t(3), hy) // vending machine
  put('indoor', 16, 0, hx + t(4), hy)
  for (let i = 0; i < 4; i++) put('indoor', 1, 13, hx + t(6 + i), hy) // archive cabinets
  put('indoor', 0, 2, hx + t(1), hy + t(2))
  put('indoor', 0, 2, hx + t(2), hy + t(2)) // chairs facing the table
  put('indoor', 3, 0, hx + t(1), hy + t(3))
  put('indoor', 4, 0, hx + t(2), hy + t(3)) // round table
  for (let i = 0; i < 4; i++) put('indoor', 4 + i, 6, hx + t(i), hy + t(6)) // sofa
  put('indoor', 0, 15, hx + t(6), hy + t(3))
  put('indoor', 1, 15, hx + t(7), hy + t(3))
  put('indoor', 2, 15, hx + t(8), hy + t(3)) // reception counter
  put('indoor', 0, 8, hx + t(7), hy + t(2)) // receptionist's chair
  put('indoor', 0, 1, hx + t(7), hy + t(5))
  put('indoor', 2, 1, hx + t(8), hy + t(5)) // accounts desk
  put('urban', 10, 12, hx + t(9), hy + t(5)) // printer
  put('indoor', 1, 8, hx + t(7) + 8, hy + t(6))
  monitors.push({ x: hx + t(8) - 5, y: hy + t(5) - 3 })
  put('indoor', 17, 0, hx + t(9), hy + t(2))

  const facilities: Facility[] = [
    { key: 'reception', label: 'Reception', rect: { x: hx + t(6), y: hy + t(2), w: t(3), h: t(2) }, stand: { x: hx + t(7) + 8, y: hub.aisles[1] } },
    { key: 'accounts', label: 'Accounts', rect: { x: hx + t(7), y: hy + t(5), w: t(3), h: t(1) }, stand: { x: hx + t(8), y: hub.aisles[2] } },
    { key: 'archive', label: 'Archive', rect: { x: hx + t(6), y: hy, w: t(4), h: t(1) }, stand: { x: hx + t(8), y: hub.aisles[0] } },
    { key: 'clock', label: 'Clock', rect: { x: hx + t(5), y: hy, w: t(1), h: t(1) }, stand: { x: hx + t(5) + 8, y: hub.aisles[0] } },
  ]

  const breakSpots: BreakSpot[] = [
    { kind: 'coffee', x: hx + t(1), y: hub.aisles[0], face: 'up' },
    { kind: 'coffee', x: hx + t(2) + 4, y: hub.aisles[0], face: 'up' },
    { kind: 'vending', x: hx + t(3) + 8, y: hub.aisles[0], face: 'up' },
    { kind: 'table', x: hx + t(1) + 8, y: hy + t(2) + 13, face: 'down' },
    { kind: 'table', x: hx + t(2) + 8, y: hy + t(2) + 13, face: 'down' },
    { kind: 'sofa', x: hx + t(1), y: hy + t(6) + 12, face: 'down' },
    { kind: 'sofa', x: hx + t(2) + 8, y: hy + t(6) + 12, face: 'down' },
    { kind: 'plant', x: hx + t(4) + 8, y: hub.aisles[0], face: 'up' },
  ]

  const w = t(EDGE + grid.cols * CELL_W)
  const h = t(WALL + grid.rows * CELL_H + 1)
  const corridorXs = [t(EDGE) / 2, ...Array.from({ length: grid.cols }, (_, c) => t(EDGE + c * CELL_W + POD_W) + t(GAP) / 2)]
  const corridorYs = Array.from({ length: grid.rows }, (_, r) => t(WALL + r * CELL_H + POD_H) + t(GAP) / 2)
  const door = { x: hub.exitX, y: h - 4 }
  return { w, h, grid, pods, hub, facilities, breakSpots, door, corridorXs, corridorYs, props, monitors }
}

/** The area a point is in, if any. */
export function areaAt(office: Office, p: Point): Area | null {
  for (const a of [...office.pods, office.hub]) {
    const r = a.rect
    if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) return a
  }
  return null
}

const nearest = (list: number[], v: number) => list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0])

/**
 * A walking route between two points that keeps to the aisles: out along an
 * aisle to the area's side corridor, along the corridors, and in the same way.
 */
export function route(office: Office, from: Point, to: Point): Point[] {
  const a = areaAt(office, from)
  const b = areaAt(office, to)
  const pts: Point[] = []
  const go = (x: number, y: number) => {
    const last = pts.length ? pts[pts.length - 1] : from
    if (Math.abs(last.x - x) > 0.5 || Math.abs(last.y - y) > 0.5) pts.push({ x, y })
  }
  if (a && b && a === b) {
    const ya = nearest(a.aisles, from.y)
    const yb = nearest(a.aisles, to.y)
    go(from.x, ya)
    if (ya !== yb) {
      go(a.exitX, ya)
      go(a.exitX, yb)
    }
    go(to.x, yb)
    go(to.x, to.y)
    return pts
  }
  // Leave: to the aisle, then along it to the side corridor.
  let x = from.x
  let y = from.y
  if (a) {
    y = nearest(a.aisles, from.y)
    go(from.x, y)
    x = a.exitX
    go(x, y)
  } else {
    x = nearest(office.corridorXs, from.x)
    go(from.x, from.y)
    go(x, y)
  }
  const xb = b ? b.exitX : nearest(office.corridorXs, to.x)
  const yb = b ? nearest(b.aisles, to.y) : to.y
  if (x !== xb) {
    // Cross along the corridor row nearest the halfway point.
    const cy = nearest(office.corridorYs, (y + yb) / 2)
    go(x, cy)
    go(xb, cy)
  }
  go(xb, yb)
  go(to.x, yb)
  go(to.x, to.y)
  return pts
}

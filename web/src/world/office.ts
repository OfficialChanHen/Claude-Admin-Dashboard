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
export const ROOM_WALL = 3 // art px: how thick each room's walls are
export const ROOM_FACE = 14 // art px: the back wall of a room, seen from the front, tall enough to hang things on
export const FIXTURE_H = 10 // art px: name plates, clocks and boards hung on a back wall
export const CAP = 5 // art px: the top of the building's outer walls, seen from above
export const FACADE = 32 // art px: the front of the building, seen from the street
export const FRONT = CAP + FACADE // art px: the whole front wall, top and face
export const HUB = '_hub'
export const BOSS = '_boss'

export type Sheet = 'indoor' | 'urban'
export type Prop = { sheet: Sheet; c: number; r: number; x: number; y: number } // sheet tile, then art px on the floor
export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number } // art px

export type AreaKind = 'pod' | 'hub' | 'boss'
export type Area = {
  id: string
  kind: AreaKind
  name: string
  rect: Rect
  cell: { c: number; r: number }
  /** Rows people walk along inside the area. */
  aisles: number[]
  /** The aisle column just right of the area, which runs the full floor. */
  exitX: number
  /** Gaps in the right-hand wall, one at the end of each aisle. */
  doors: Rect[]
}

export type Pod = Area & {
  seniorSeats: Point[]
  juniorSeats: Point[]
  seniorDesks: Rect[]
  juniorDesks: Rect[]
  board: Point // stand here to plan
  cabinet: Point // stand here to look things up
  boardRect: Rect
  cabinetRect: Rect
  /** The name plate on the back wall, with a lamp that shows how the room is doing. */
  plate: Rect
  /** The clipboard hung left of the name plate: your to-do items and Claude's plans. */
  clipboard: Rect
  look: Look
}

/** What makes each area its own: the floor, which way round it is, and the odds and ends in it. */
export type FloorKind = 'planks' | 'tiles' | 'checker' | 'carpet' | 'parquet' | 'bricks' | 'executive'
export type Look = { floor: FloorKind; tone: number; mirror: boolean; decor: number }

export const FLOORS: FloorKind[] = ['planks', 'tiles', 'checker', 'carpet', 'parquet', 'bricks']
export const TONES = 3
export const DECOR_SETS = 4
const LOOKS = FLOORS.length * TONES * 2 * DECOR_SETS

function lookOf(n: number): Look {
  const decor = n % DECOR_SETS
  n = Math.floor(n / DECOR_SETS)
  const mirror = n % 2 === 1
  n = Math.floor(n / 2)
  return { floor: FLOORS[Math.floor(n / TONES) % FLOORS.length], tone: n % TONES, mirror, decor }
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * A look for each area, picked from its id so it mostly stays put as projects
 * come and go. No two areas share a look, and floors are shared out evenly so
 * the first six areas all have different ones.
 */
export function looksFor(ids: string[]): Look[] {
  const taken = new Set<number>()
  const floors = new Map<FloorKind, number>()
  return ids.map((id) => {
    const start = hash(id) % LOOKS
    const fewest = Math.min(...FLOORS.map((f) => floors.get(f) ?? 0))
    let pick = -1
    for (let i = 0; i < LOOKS; i++) {
      const n = (start + i) % LOOKS
      if (taken.has(n)) continue
      if (pick < 0) pick = n
      if ((floors.get(lookOf(n).floor) ?? 0) === fewest) {
        pick = n
        break
      }
    }
    if (pick < 0) pick = start // more areas than looks: repeats are unavoidable
    taken.add(pick)
    const look = lookOf(pick)
    floors.set(look.floor, (floors.get(look.floor) ?? 0) + 1)
    return look
  })
}

/**
 * Things you click for office services. The clock, the plan meter and the
 * notice board hang on the hub's back wall; the light switch is by the entrance.
 * The boss's name plate and bookshelves open the reports.
 */
export type FacilityKey = 'reception' | 'accounts' | 'archive' | 'clock' | 'limits' | 'notice' | 'lights' | 'reports'
export type Facility = { key: FacilityKey; label: string; rect: Rect; stand: Point }

export type BreakSpot = Point & {
  kind: 'coffee' | 'vending' | 'table' | 'sofa' | 'window' | 'plant' | 'printer' | 'archive' | 'stretch' | 'phone'
  face: Facing
}
export type Facing = 'up' | 'down' | 'left' | 'right'
/** A spare place to work in the hub, for people whose room has no free desk: a hot desk or a seat at the work table. */
export type HubSeat = Point & { kind: 'hotdesk' | 'table'; face: Facing; desk: Rect }
/** The break furniture in the hub, for tooltips. */
export type Lounge = { thing: 'coffee' | 'vending' | 'table' | 'sofa' | 'hotdesk'; rect: Rect }

export type Office = {
  w: number // art px
  h: number
  grid: { cols: number; rows: number }
  pods: Pod[]
  hub: Area
  /** The boss's corner office: one long desk, and two chairs across it for whoever reports in. */
  boss: Pod
  facilities: Facility[]
  breakSpots: BreakSpot[]
  hubSeats: HubSeat[]
  lounge: Lounge[]
  /** Where people come in and leave: on the sidewalk, just outside the front door. */
  door: Point
  /** The front door: an opening in the front wall onto the street, with its lamp above. */
  entrance: Rect
  /** Windows in the front of the building; lit from inside at night. */
  frontWindows: Rect[]
  /** The office sign on the back wall. */
  sign: Rect
  /** Windows in the back wall; the sky in them follows the time of day. */
  windows: Rect[]
  /** Where the receptionist sits. */
  receptionist: Point
  corridorYs: number[]
  corridorXs: number[]
  props: Prop[]
  monitors: Point[] // top-left of each desk monitor, drawn by hand
}

export type PodInfo = { id: string; name: string }

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

const HOT_DESK_COLS = [4, 5, 6] // in the hub, one tile each

export const SENIOR_SLOTS = SENIOR_COLS.length
export const JUNIOR_SLOTS = JUNIOR_COLS.length

// Odds and ends that give each area its character: sheet, tile, tiles wide.
type DecorKind = 'plant' | 'tallPlant' | 'cabinet' | 'printer' | 'vending' | 'coffee'
const DECOR_ART: Record<DecorKind, [Sheet, number, number, number]> = {
  plant: ['indoor', 16, 0, 1],
  tallPlant: ['indoor', 17, 0, 1],
  cabinet: ['indoor', 1, 13, 1],
  printer: ['urban', 10, 12, 1],
  vending: ['urban', 12, 10, 1],
  coffee: ['indoor', 5, 12, 3],
}
// Spots that are never walked through: row 0 between the whiteboard and the
// cabinets, and the ends of the desk rows (columns 0 and 9, rows 2, 5 and 6).
// Areas can be mirrored, so every spot must be free on both sides.
const DECOR: { kind: DecorKind; c: number; r: number }[][] = [
  [{ kind: 'plant', c: 5, r: 0 }, { kind: 'tallPlant', c: 9, r: 6 }],
  [{ kind: 'coffee', c: 3, r: 0 }, { kind: 'plant', c: 7, r: 0 }, { kind: 'tallPlant', c: 0, r: 6 }, { kind: 'cabinet', c: 9, r: 2 }],
  [{ kind: 'vending', c: 3, r: 0 }, { kind: 'plant', c: 5, r: 0 }, { kind: 'tallPlant', c: 7, r: 0 }, { kind: 'plant', c: 0, r: 2 }, { kind: 'plant', c: 9, r: 6 }],
  [{ kind: 'printer', c: 3, r: 0 }, { kind: 'cabinet', c: 4, r: 0 }, { kind: 'tallPlant', c: 6, r: 0 }, { kind: 'tallPlant', c: 0, r: 5 }, { kind: 'plant', c: 9, r: 2 }, { kind: 'plant', c: 9, r: 6 }],
]

export function buildOffice(infos: PodInfo[]): Office {
  const grid = gridFor(infos.length + 1)
  const hubCell = { c: Math.floor((grid.cols - 1) / 2), r: Math.floor((grid.rows - 1) / 2) }
  // The boss has the corner office: top right, along the back wall.
  const bossCell = { c: grid.cols - 1, r: 0 }
  const cellOrigin = (c: number, r: number) => ({ x: t(EDGE + c * CELL_W), y: t(WALL + r * CELL_H) })

  // Nearest cells to the hub first, so the first projects sit closest.
  const cells: { c: number; r: number }[] = []
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if ((c !== hubCell.c || r !== hubCell.r) && (c !== bossCell.c || r !== bossCell.r)) cells.push({ c, r })
  const dist = (a: { c: number; r: number }) => Math.abs(a.c - hubCell.c) + Math.abs(a.r - hubCell.r)
  cells.sort((a, b) => dist(a) - dist(b) || a.r - b.r || a.c - b.c)

  const props: Prop[] = []
  const monitors: Point[] = []
  const put = (sheet: Sheet, c: number, r: number, x: number, y: number) => props.push({ sheet, c, r, x, y })

  const area = (id: string, kind: AreaKind, name: string, cell: { c: number; r: number }): Area => {
    const o = cellOrigin(cell.c, cell.r)
    return {
      id, kind, name, cell,
      rect: { x: o.x, y: o.y, w: t(POD_W), h: t(POD_H) },
      aisles: AISLE_ROWS.map((row) => o.y + t(row) + 12),
      exitX: o.x + t(POD_W) + t(GAP) / 2,
      doors: AISLE_ROWS.map((row) => ({ x: o.x + t(POD_W), y: o.y + t(row), w: ROOM_WALL, h: TILE })),
    }
  }

  const looks = looksFor(infos.map((p) => p.id))
  const pods: Pod[] = infos.map((info, i) => {
    const a = area(info.id, 'pod', info.name, cells[i])
    const look = looks[i]
    const { x, y } = a.rect
    // Mirrored areas have the whiteboard on the right and the cabinets on the left.
    const mx = (c: number, w = 1) => (look.mirror ? POD_W - c - w : c)
    const bc = mx(0, 3)
    put('urban', 8, 13, x + t(bc), y)
    put('urban', 9, 13, x + t(bc + 1), y)
    put('urban', 10, 13, x + t(bc + 2), y) // whiteboard
    put('indoor', 1, 13, x + t(mx(8)), y)
    put('indoor', 1, 13, x + t(mx(9)), y) // filing cabinets
    for (const d of DECOR[look.decor]) {
      const [sheet, c, r, w] = DECOR_ART[d.kind]
      const col = mx(d.c, w)
      for (let k = 0; k < w; k++) put(sheet, c + k, r, x + t(col + k), y + t(d.r))
    }
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
    return {
      ...a,
      seniorDesks, seniorSeats, juniorDesks, juniorSeats,
      board: { x: x + t(bc + 1) + 8, y: a.aisles[0] },
      cabinet: { x: x + (look.mirror ? t(1) + 4 : t(9)), y: a.aisles[0] },
      boardRect: { x: x + t(bc), y, w: t(3), h: t(1) },
      cabinetRect: { x: x + t(mx(8, 2)), y, w: t(2), h: t(1) },
      plate: { x: x + 32, y: wallBand(a), w: a.rect.w - 64, h: FIXTURE_H },
      clipboard: { x: x + 14, y: wallBand(a), w: 9, h: FIXTURE_H },
      look,
    }
  })

  const boss = bossOffice(area(BOSS, 'boss', "Boss's office", bossCell), put)

  // The hub: break area on the left, spare seats in the middle, office services
  // on the right. Rows 0 to 7 as in an area: row 0 counters and cabinets, rows
  // 2-3 the tables, rows 5-6 the hot desks and the sofa, with aisles between.
  const hub = area(HUB, 'hub', 'Hub', hubCell)
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
  // Spare seats for people whose room is full: a work table and a row of hot desks.
  put('indoor', 0, 2, hx + t(4), hy + t(2))
  put('indoor', 0, 2, hx + t(5), hy + t(2))
  put('indoor', 3, 0, hx + t(4), hy + t(3))
  put('indoor', 4, 0, hx + t(5), hy + t(3)) // work table
  const workTable = { x: hx + t(4), y: hy + t(3), w: t(2), h: t(1) }
  const hubSeats: HubSeat[] = []
  for (const c of HOT_DESK_COLS) {
    put('indoor', 5, 4, hx + t(c), hy + t(5))
    put('indoor', 1, 8, hx + t(c), hy + t(6))
    monitors.push({ x: hx + t(c) + 3, y: hy + t(5) - 2 })
    hubSeats.push({ kind: 'hotdesk', x: hx + t(c) + 8, y: hy + t(6) + 13, face: 'up', desk: { x: hx + t(c), y: hy + t(5), w: t(1), h: t(1) } })
  }
  for (const c of [4, 5]) hubSeats.push({ kind: 'table', x: hx + t(c) + 8, y: hy + t(2) + 13, face: 'down', desk: workTable })

  const facilities: Facility[] = [
    { key: 'reception', label: 'Reception', rect: { x: hx + t(6), y: hy + t(2), w: t(3), h: t(2) }, stand: { x: hx + t(7) + 8, y: hub.aisles[1] } },
    { key: 'accounts', label: 'Accounts', rect: { x: hx + t(7), y: hy + t(5), w: t(3), h: t(1) }, stand: { x: hx + t(8), y: hub.aisles[2] } },
    { key: 'archive', label: 'Archive', rect: { x: hx + t(6), y: hy, w: t(4), h: t(1) }, stand: { x: hx + t(8), y: hub.aisles[0] } },
  ]
  // On the hub's back wall: the notice board (the key), the clock and the plan meter.
  const band = wallBand(hub)
  facilities.push(
    { key: 'notice', label: 'Notice board', rect: { x: hx + 6, y: band, w: 30, h: FIXTURE_H }, stand: { x: hx + t(1), y: hub.aisles[0] } },
    { key: 'clock', label: 'Clock', rect: { x: hx + t(5) + 3, y: band, w: 10, h: FIXTURE_H }, stand: { x: hx + t(5) + 8, y: hub.aisles[0] } },
    { key: 'limits', label: 'Plan meter', rect: { x: hx + t(6) + 6, y: band, w: 52, h: FIXTURE_H }, stand: { x: hx + t(8), y: hub.aisles[0] } },
  )

  const breakSpots: BreakSpot[] = [
    { kind: 'coffee', x: hx + t(1), y: hub.aisles[0], face: 'up' },
    { kind: 'coffee', x: hx + t(2) + 4, y: hub.aisles[0], face: 'up' },
    { kind: 'vending', x: hx + t(3) + 8, y: hub.aisles[0], face: 'up' },
    { kind: 'table', x: hx + t(1) + 8, y: hy + t(2) + 13, face: 'down' },
    { kind: 'table', x: hx + t(2) + 8, y: hy + t(2) + 13, face: 'down' },
    ...[0, 1, 2, 3].map((i): BreakSpot => ({ kind: 'sofa', x: hx + t(i) + 8, y: hy + t(6) + 12, face: 'down' })),
    { kind: 'plant', x: hx + t(4) + 8, y: hub.aisles[0], face: 'up' },
    // Leafing through the archive, and fetching a printout.
    { kind: 'archive', x: hx + t(6) + 8, y: hub.aisles[0], face: 'up' },
    { kind: 'archive', x: hx + t(9), y: hub.aisles[0], face: 'up' },
    { kind: 'printer', x: hx + t(9) + 8, y: hy + t(6) + 12, face: 'up' },
    // The open floor above the sofa: stretching, and pacing on a call. One more call between the tables.
    { kind: 'stretch', x: hx + 8, y: hy + t(5) + 12, face: 'down' },
    { kind: 'stretch', x: hx + t(1) + 12, y: hy + t(5) + 12, face: 'down' },
    { kind: 'phone', x: hx + t(3), y: hy + t(5) + 12, face: 'down' },
    { kind: 'phone', x: hx + t(3) + 8, y: hy + t(2) + 12, face: 'down' },
  ]

  const lounge: Lounge[] = [
    { thing: 'coffee', rect: { x: hx, y: hy, w: t(3), h: t(1) } },
    { thing: 'vending', rect: { x: hx + t(3), y: hy, w: t(1), h: t(1) } },
    { thing: 'table', rect: { x: hx + t(1), y: hy + t(2), w: t(2), h: t(2) } },
    { thing: 'table', rect: { x: hx + t(4), y: hy + t(2), w: t(2), h: t(2) } },
    { thing: 'sofa', rect: { x: hx, y: hy + t(6), w: t(4), h: t(1) } },
    { thing: 'hotdesk', rect: { x: hx + t(HOT_DESK_COLS[0]), y: hy + t(5), w: t(HOT_DESK_COLS.length), h: t(2) } },
  ]

  // Two tiles of corridor below the last row, then the front wall.
  const w = t(EDGE + grid.cols * CELL_W)
  const h = t(WALL + grid.rows * CELL_H + 2)
  const corridorXs = [t(EDGE) / 2, ...Array.from({ length: grid.cols }, (_, c) => t(EDGE + c * CELL_W + POD_W) + t(GAP) / 2)]
  const corridorYs = Array.from({ length: grid.rows }, (_, r) => t(WALL + r * CELL_H + POD_H) + t(GAP) / 2)

  // The front door opens onto the street at the foot of the hub's corridor, so
  // people walk in off the sidewalk. The light switch is on the back wall at the
  // top of the same corridor, and the office sign is over the hub's column.
  const entrance = { x: hub.exitX - t(GAP) / 2, y: h - FRONT, w: t(GAP), h: FRONT }
  const door = { x: hub.exitX, y: h + 7 }
  const lights = { x: hub.exitX - 3, y: 8, w: 6, h: 9 }
  facilities.push(
    { key: 'lights', label: 'Light switch', rect: lights, stand: { x: hub.exitX, y: t(WALL) + 6 } },
    { key: 'reports', label: "Boss's office: reports", rect: boss.plate, stand: { x: boss.board.x, y: boss.aisles[0] } },
    { key: 'reports', label: 'Shelf of reports', rect: boss.cabinetRect, stand: boss.cabinet },
  )
  const sign = { x: hx + 16, y: CAP + 1, w: t(POD_W) - 32, h: 12 }
  const apart = (r: Rect, others: Rect[]) => others.every((o) => !(r.x < o.x + o.w && o.x < r.x + r.w))
  const windows: Rect[] = []
  for (let x = t(2); x + t(2) <= w - t(1); x += t(6)) {
    const r = { x, y: CAP + 1, w: t(2), h: 12 }
    if (apart(r, [sign, { ...lights, x: lights.x - 8, w: lights.w + 16 }])) windows.push(r)
  }
  const frontWindows: Rect[] = []
  for (let x = t(1) + 8; x + t(2) <= w - t(1); x += t(4)) {
    const r = { x, y: h - FACADE + 8, w: t(2), h: 14 }
    // Room right of the door for the lamp.
    if (apart(r, [{ ...entrance, x: entrance.x - 8, w: entrance.w + 32 }])) frontWindows.push(r)
  }
  const receptionist = { x: hx + t(7) + 8, y: hy + t(2) + 13 }
  return { w, h, grid, pods, hub, boss, facilities, breakSpots, hubSeats, lounge, door, entrance, frontWindows, sign, windows, receptionist, corridorXs, corridorYs, props, monitors }
}

/**
 * The boss's office (tiles, as in an area): bookshelves, a picture and a
 * whiteboard along the back; the boss behind a long desk, facing the room; two
 * chairs on a rug for whoever reports in; and a sofa by the door. Rows 1, 4 and
 * 7 stay clear to walk along.
 */
function bossOffice(a: Area, put: (sheet: Sheet, c: number, r: number, x: number, y: number) => void): Pod {
  const { x, y } = a.rect
  for (let i = 0; i < 3; i++) put('indoor', 19 + i, 17, x + t(i), y) // bookshelves
  put('indoor', 16, 0, x + t(3), y)
  put('indoor', 19, 12, x + t(4), y) // a landscape
  put('indoor', 22, 9, x + t(5), y) // a shield, for the trophy wall
  put('urban', 8, 13, x + t(6), y)
  put('urban', 9, 13, x + t(7), y)
  put('urban', 10, 13, x + t(8), y) // whiteboard
  put('indoor', 17, 0, x + t(9), y)
  put('indoor', 17, 0, x, y + t(2))
  put('indoor', 16, 0, x + t(9), y + t(2))
  put('indoor', 0, 2, x + t(4), y + t(2)) // the boss's chair, facing the room
  for (let i = 0; i < 3; i++) put('indoor', 1 + i, 11, x + t(3 + i), y + t(3)) // the desk
  for (let i = 0; i < 3; i++) put('indoor', 16 + i, 14, x + t(3 + i), y + t(6)) // a runner behind the visitors' chairs
  for (let i = 0; i < 4; i++) put('indoor', 4 + i, 6, x + t(6 + i), y + t(6)) // sofa
  const desk = { x: x + t(3), y: y + t(3), w: t(3), h: t(1) }
  const visitors = [3, 5]
  for (const c of visitors) put('indoor', 1, 2, x + t(c), y + t(5)) // chairs, seen from behind
  return {
    ...a,
    seniorDesks: [desk],
    seniorSeats: [{ x: x + t(4) + 8, y: y + t(2) + 13 }],
    juniorDesks: visitors.map(() => desk),
    juniorSeats: visitors.map((c) => ({ x: x + t(c) + 8, y: y + t(5) + 13 })),
    board: { x: x + t(7) + 8, y: a.aisles[0] },
    cabinet: { x: x + t(1) + 8, y: a.aisles[0] },
    boardRect: { x: x + t(6), y, w: t(3), h: t(1) },
    cabinetRect: { x, y, w: t(3), h: t(1) },
    plate: { x: x + 32, y: wallBand(a), w: a.rect.w - 64, h: FIXTURE_H },
    clipboard: { x: x + 14, y: wallBand(a), w: 0, h: 0 }, // no to-do list on the boss's wall
    look: { floor: 'executive', tone: 0, mirror: false, decor: 0 },
  }
}

/** Sits facing the room instead of a screen: only the boss, behind the desk. */
export function facesRoom(pod: Pick<Pod, 'kind'> | null, senior: boolean) {
  return pod?.kind === 'boss' && senior
}

/** The top of the strip of back wall where a room's plates and clocks hang. Top-row rooms use the office wall. */
export function wallBand(a: Pick<Area, 'rect' | 'cell'>) {
  return a.cell.r > 0 ? a.rect.y - ROOM_FACE + 2 : a.rect.y - ROOM_WALL - FIXTURE_H - 1
}

/** Every room on the floor: the hub, the project areas, then the boss's office. */
export function rooms(office: Office): Area[] {
  return [office.hub, ...office.pods, office.boss]
}

export function roomById(office: Office, id: string): Area | null {
  return rooms(office).find((a) => a.id === id) ?? null
}

/** A room with its walls. Rooms on the top row back onto the office wall, so their top wall is thin. */
export function outerRect(a: Area): Rect {
  const top = a.cell.r > 0 ? ROOM_FACE : ROOM_WALL
  return { x: a.rect.x - ROOM_WALL, y: a.rect.y - top, w: a.rect.w + ROOM_WALL * 2, h: a.rect.h + ROOM_WALL + top }
}

/** A room with its walls and whatever hangs on its back wall: what belongs to the room when you click. */
export function roomShell(a: Area): Rect {
  const o = outerRect(a)
  const top = Math.min(o.y, wallBand(a))
  return { x: o.x, y: top, w: o.w, h: o.y + o.h - top }
}

/** What the camera keeps in view inside a room: its walls and the name plaque above it. */
export function roomBounds(a: Area): Rect {
  return { x: a.rect.x - 8, y: a.rect.y - 24, w: a.rect.w + 16, h: a.rect.h + 32 }
}

/** The room next door in a direction, or the nearest one that way when that cell is empty. */
export function neighbor(office: Office, id: string, dir: Facing): Area | null {
  const from = roomById(office, id)
  if (!from) return null
  const [dc, dr] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir]
  let best: Area | null = null
  let bestScore = Infinity
  for (const a of rooms(office)) {
    const c = a.cell.c - from.cell.c
    const r = a.cell.r - from.cell.r
    const ahead = c * dc + r * dr
    if (ahead <= 0) continue
    // Straight ahead first; a step to the side costs more than a step forward.
    const score = ahead + 2 * Math.abs(dc ? r : c)
    if (score < bestScore) {
      best = a
      bestScore = score
    }
  }
  return best
}

/** The area a point is in, if any. */
export function areaAt(office: Office, p: Point): Area | null {
  for (const a of [...office.pods, office.hub, office.boss]) {
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

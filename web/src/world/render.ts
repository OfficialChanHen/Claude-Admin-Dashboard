import indoorUrl from '../assets/kenney/indoor.png'
import urbanUrl from '../assets/kenney/urban.png'
import cityUrl from '../assets/kenney/city.png'
import type { Camera } from './camera'
import {
  CAP, FACADE, FRONT, ROOM_FACE, ROOM_WALL, TILE, WALL, outerRect, roomShell, rooms,
  type Area, type Facing, type FacilityKey, type FloorKind, type Office, type Pod, type Rect, type Sheet,
} from './office'
import { BRIEF_MS, REPORT_MS, type Emote, type Sprite, type Use, type WorldModel } from './model'
import { TASKS, taskLabel, taskOf, type TaskKind, type Thing } from './tasks'
import { iconCells, type IconName } from '../lib/pixelIcons'
import { isDark } from '../lib/theme'
import { carsIn, groundAt, hash, propAt, walkersIn, ROAD, WALK, type CarDir, type Prop as StreetProp } from './street'
import { CLERK, COURIER, carHidden, drawDramaFx, drawNpcs, drawOutside, drawRoomExtras, drawWindowWeather } from './extrasRender'
import { tvRect, type Extras } from './extras'
import type { Preview } from '../lib/api'

// Draws the office from Kenney's Roguelike Indoors and RPG Urban packs (CC0).
// The floor, walls and furniture are drawn once at art size and scaled up by
// the camera. Everything that tells you something is part of the room: name
// plates with status lamps, a wall clock, a plan meter, an exit lamp, lit
// screens, thought clouds and speech bubbles. Labels only appear over people
// you have clicked on.

/** The office's sheets, plus the city sheet for the street outside. */
export type Sheets = Record<Sheet, CanvasImageSource> & { city: CanvasImageSource }
const GAP: Record<Sheet, number> = { indoor: 1, urban: 0 }

let sheetsPromise: Promise<Sheets> | null = null
export function loadSheets() {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  sheetsPromise ??= Promise.all([load(indoorUrl), load(urbanUrl), load(cityUrl)]).then(([indoor, urban, city]) => ({
    indoor,
    urban: youngPeople(urban),
    city,
  }))
  return sheetsPromise
}

// People sit in the urban sheet's last four columns.
const PEOPLE_COL = 23
const HEAD_ROWS = 7 // the top of each person tile is their hair
const HAIR = [[92, 58, 38], [44, 34, 30], [150, 96, 52]] // brown, near black, chestnut

/** Grey hair in a light, unsaturated pixel. */
export function isGreyHair(r: number, g: number, b: number, a: number) {
  const max = Math.max(r, g, b)
  return a >= 128 && max >= 120 && max - Math.min(r, g, b) <= 28
}

// HQ's own ranks get people nobody else wears, made from the sheet's people
// with new clothes and painted below them: managers in a green shirt, and the
// boss in the dark suit with a gold tie. Colours are the sheet's exact pixels.
const RANKS: { from: number; to: number; swap: Record<string, string> }[] = [
  { from: 12, to: 18, swap: { '#898ca6': '#3e8a5c', '#aaa8bd': '#62b07c' } }, // manager
  { from: 15, to: 21, swap: { '#ff7143': '#f2c14e' } }, // boss
  { from: 0, to: COURIER, swap: { '#42a379': '#8a5a33', '#369069': '#6e4626', '#d6d4aa': '#a8774a', '#c5b993': '#8f633b' } }, // courier, all in brown
  { from: 3, to: CLERK, swap: { '#c2504d': '#4a78c0', '#a54240': '#3a5f9a', '#a09cca': '#3b4a75', '#7a77a4': '#2e3a5c' } }, // mail clerk, in postal blue
  { from: 6, to: 30, swap: { '#42a379': '#2a9bb3', '#369069': '#1f7d91', '#5c6278': '#2c2220', '#7a77a4': '#45342c', '#a09cca': '#5e463a' } }, // you, in the chat: dark hair, teal shirt
]
export const MANAGER = 18
export const BOSS = 21
/** You, as drawn beside your own messages in a conversation. */
export const YOU = 30

/** Draws someone standing, facing you, into a small canvas. */
export function drawPortrait(cv: HTMLCanvasElement, sheets: Sheets, row: number, scale: number) {
  const ctx = cv.getContext('2d')!
  cv.width = PORTRAIT.w * scale
  cv.height = PORTRAIT.h * scale
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, cv.width, cv.height)
  ctx.drawImage(sheets.urban, FACE_COL.down * TILE + PORTRAIT.x, row * TILE + PORTRAIT.y, PORTRAIT.w, PORTRAIT.h, 0, 0, cv.width, cv.height)
}
/** The part of a person's tile a portrait shows: all of them, without the empty edges. */
export const PORTRAIT = { x: 2, y: 1, w: 12, h: 15 }

/** Swaps exact colours in RGBA pixels. */
export function swapColors(d: Uint8ClampedArray, swap: Record<string, string>) {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const pairs = Object.entries(swap).map(([a, b]) => [rgb(a), rgb(b)] as const)
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    for (const [a, b] of pairs) {
      if (d[i] === a[0] && d[i + 1] === a[1] && d[i + 2] === a[2]) {
        d[i] = b[0]
        d[i + 1] = b[1]
        d[i + 2] = b[2]
        break
      }
    }
  }
}

/** The staff are young: grey and white hair in the sheet is dyed a young colour, kept shaded. */
function youngPeople(img: HTMLImageElement) {
  const cv = document.createElement('canvas')
  cv.width = img.width
  cv.height = Math.max(img.height, (Math.max(...RANKS.map((r) => r.to)) + 3) * TILE)
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const x0 = PEOPLE_COL * TILE
  const w = img.width - x0
  const data = ctx.getImageData(x0, 0, w, img.height)
  const d = data.data
  for (let y = 0; y < img.height; y++) {
    if (y % TILE >= HEAD_ROWS) continue
    // Each person is three rows of tiles; give each their own hair colour.
    const hair = HAIR[Math.floor(y / TILE / 3) % HAIR.length]
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (!isGreyHair(d[i], d[i + 1], d[i + 2], d[i + 3])) continue
      const k = Math.max(d[i], d[i + 1], d[i + 2]) / 255
      for (let c = 0; c < 3; c++) d[i + c] = Math.round(hair[c] * (0.55 + k * 0.6))
    }
  }
  ctx.putImageData(data, x0, 0)
  for (const r of RANKS) {
    const part = ctx.getImageData(x0, r.from * TILE, w, 3 * TILE)
    swapColors(part.data, r.swap)
    ctx.putImageData(part, x0, r.to * TILE)
  }
  return cv
}

const TOKENS = [
  'panel', 'panel-2', 'line', 'line-strong', 'text', 'text-2', 'text-3', 'accent', 'accent-bg', 'accent-text', 'turn', 'turn-bg', 'bad',
  'ok', 'ok-bg', 'warn', 'warn-bg',
  'w-shadow', 'w-void',
] as const
export type Palette = Record<(typeof TOKENS)[number], string>

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const p = {} as Palette
  for (const t of TOKENS) p[t] = cs.getPropertyValue(`--${t}`).trim() || 'transparent'
  return p
}

/**
 * How dark it is outside at an hour of the day, from 0 (full day) to 1 (night),
 * following the sky in the windows: dawn from 5 to 7, dusk from 17 to 21.
 * The office's lighting follows the clock, not the app's theme.
 */
export function darkness(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const ramp = (from: number, to: number, a: number, b: number) => a + ((h - from) / (to - from)) * (b - a)
  if (h < 5) return 1
  if (h < 7) return ramp(5, 7, 1, 0)
  if (h < 17) return 0
  if (h < 19) return ramp(17, 19, 0, 0.6)
  if (h < 21) return ramp(19, 21, 0.6, 1)
  return 1
}

/** From this dark on, lamps, lit windows and screens glow. */
export const LAMPS_ON = 0.5

/** The blue tint over the scenery at a darkness; people, lamps and lit screens stay bright. */
export const nightTint = (k: number) => `rgba(10, 16, 48, ${(0.42 * k).toFixed(3)})`

const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60

function blit(ctx: CanvasRenderingContext2D, sheets: Sheets, sheet: Sheet, c: number, r: number, dx: number, dy: number, P: number) {
  const g = GAP[sheet]
  ctx.drawImage(sheets[sheet], c * (TILE + g), r * (TILE + g), TILE, TILE, dx, dy, TILE * P, TILE * P)
}

// Colours of the art itself (walls, screens, ink, paper), matched to the sheets.
export const ART = {
  outline: '#472d3c',
  wall: '#dccaa0',
  wallTrim: '#b49a6c',
  screen: '#5ac8e6',
  screenOff: '#2b3a55',
  clockFace: '#f7f3e6',
  paper: '#f7f3e6',
  ink: '#3b4a75',
  inkRed: '#c0566f',
  inkGreen: '#4f8a5b',
  term: '#1b2330',
  termText: '#7fdc8c',
  code1: '#c0566f',
  code2: '#4f86b9',
  code3: '#b39433',
  drawer: '#8a6f55',
  water: '#5ac8e6',
  can: '#d9544f',
  brass: '#e9d8a6',
  brassDark: '#b39433',
  wood: '#8a6f55',
  woodLight: '#a88a62',
  woodDark: '#6f4c33',
  cork: '#c69c6d',
  glass: '#3b4a75',
  glassHi: '#74a9dc',
  mat: '#9a3b3b',
  sticky: '#f2e27a',
  memo: '#9ad0f5',
  lampGreen: '#7fdc8c',
  lampRed: '#ff5a4f',
  lampAmber: '#e0b040',
  lampOff: '#5a5560',
  bulb: '#f2c14e',
  brand: '#d97757',
}

const CONFETTI = ['#d97757', '#7fdc8c', '#5ac8e6', '#f2c14e', '#e47d95']

// People in the urban sheet: each is three rows (standing, two steps) of four
// columns (left, down, up, right). Agents wear shirts; helpers are casual. The
// suit is kept for the boss.
export const SENIORS = [12, 6]
export const JUNIORS = [0, 3]

/** The first sheet row of the person someone is drawn as: one look per rank. */
export function lookOf(s: Pick<Sprite, 'rank' | 'role' | 'seed'>) {
  if (s.role === 'boss') return BOSS
  if (s.role === 'manager') return MANAGER
  const list = s.rank === 'senior' ? SENIORS : JUNIORS
  return list[s.seed % list.length]
}
const RECEPTIONIST = 9
const FACE_COL: Record<Facing, number> = { left: 23, down: 24, up: 25, right: 26 }

// Floor colours in the sheets' own earthy tones: [main, alternate, lines] per tone.
const FLOOR_TONES: Record<FloorKind, [string, string, string][]> = {
  planks: [['#c69c6d', '#b98f61', '#8c6440'], ['#a77a52', '#9a6e48', '#6f4c33'], ['#d9bf94', '#ccb185', '#a88a62']],
  tiles: [['#e2dccb', '#d8d1be', '#b4ab96'], ['#c9ccc8', '#bec2bd', '#9a9f9b'], ['#d6c3a5', '#cbb797', '#a99372']],
  checker: [['#e6dfcc', '#9a8f80', '#7a7064'], ['#d8c7a8', '#8a6f55', '#6c5440'], ['#d2d4d0', '#7d8285', '#62676a']],
  carpet: [['#8f8a80', '#9b968b', '#7c776e'], ['#8a7466', '#967f70', '#776357'], ['#6f7a73', '#7a857e', '#5f6962']],
  parquet: [['#b98a5c', '#a87b50', '#7d5737'], ['#cfa676', '#c09867', '#97734c'], ['#94694a', '#865d40', '#5f412d']],
  bricks: [['#c4b8a6', '#b8ac99', '#948875'], ['#b3aa9f', '#a79e93', '#857d73'], ['#cdb79a', '#c1aa8c', '#9c876b']],
  executive: [['#7a2e2e', '#843636', '#5e2222']], // only the boss's office
}

type Fill = (x: number, y: number, w: number, h: number, c: string) => void

function drawFloor(ctx: CanvasRenderingContext2D, p: Pod) {
  const [main, alt, line] = FLOOR_TONES[p.look.floor][p.look.tone]
  const { x: x0, y: y0, w, h } = p.rect
  const fill = (x: number, y: number, fw: number, fh: number, c: string) => {
    ctx.fillStyle = c
    ctx.fillRect(x0 + x, y0 + y, Math.min(fw, w - x), Math.min(fh, h - y))
  }
  fill(0, 0, w, h, main)
  switch (p.look.floor) {
    case 'planks':
      // Boards 4px tall, seams staggered.
      for (let y = 0; y < h; y += 4) {
        const row = y / 4
        if (row % 2) fill(0, y, w, 3, alt)
        fill(0, y + 3, w, 1, line)
        for (let x = ((row * 11) % 24) + 4; x < w; x += 24) fill(x, y, 1, 3, line)
      }
      break
    case 'tiles':
      for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
        if ((x + y) % 32) fill(x + 1, y + 1, 15, 15, alt)
        fill(x, y, 16, 1, line)
        fill(x, y, 1, 16, line)
      }
      break
    case 'checker':
      for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) if ((x + y) % 16) fill(x, y, 8, 8, alt)
      break
    case 'carpet':
      // Tweed: a sparse, even fleck.
      for (let y = 0; y < h; y++) for (let x = (y * 3) % 5; x < w; x += 5) fill(x, y, 1, 1, (x + y) % 2 ? alt : line)
      break
    case 'executive':
      // Deep red carpet with a gold border a little in from the walls.
      for (let y = 0; y < h; y++) for (let x = (y * 3) % 5; x < w; x += 5) fill(x, y, 1, 1, (x + y) % 2 ? alt : line)
      for (const [bx, by, bw, bh] of [[4, 4, w - 8, 1], [4, h - 5, w - 8, 1], [4, 4, 1, h - 8], [w - 5, 4, 1, h - 8]]) fill(bx, by, bw, bh, ART.brass)
      break
    case 'parquet':
      // 8px squares of three boards, turning each square.
      for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
        const across = (x + y) % 16 === 0
        if (across) for (let k = 0; k < 8; k += 3) fill(x, y + k, 8, 1, line)
        else for (let k = 0; k < 8; k += 3) fill(x + k, y, 1, 8, line)
        if (!across) fill(x + 1, y, 1, 8, alt)
      }
      break
    case 'bricks':
      for (let y = 0; y < h; y += 8) {
        const off = (y / 8) % 2 ? 8 : 0
        fill(0, y, w, 1, line)
        for (let x = off; x < w; x += 16) fill(x, y, 1, 8, line)
        for (let x = off + 1; x < w; x += 32) fill(x, y + 1, 15, 7, alt)
      }
      break
  }
}

const ROOM_LIP = 5 // art px of a room's bottom wall seen from the front

/** A room's walls: a back wall seen from the front, wall tops on the other sides, and a doorway at the end of each aisle. */
function drawWalls(ctx: CanvasRenderingContext2D, a: Area) {
  const { x, y, w, h } = a.rect
  const o = outerRect(a)
  const fill = (fx: number, fy: number, fw: number, fh: number, c: string) => {
    ctx.fillStyle = c
    ctx.fillRect(fx, fy, fw, fh)
  }
  const top = (fx: number, fy: number, fw: number, fh: number) => {
    if (fw <= 0 || fh <= 0) return
    fill(fx, fy, fw, fh, ART.outline)
    if (fw > 2 && fh > 2) fill(fx + 1, fy + 1, fw - 2, fh - 2, ART.wallTrim)
  }
  if (a.cell.r > 0) {
    fill(o.x, o.y, o.w, ROOM_FACE, ART.wall)
    fill(o.x, o.y, o.w, 1, ART.outline)
    fill(o.x, y - 2, o.w, 1, ART.wallTrim)
    fill(o.x, y - 1, o.w, 1, ART.outline)
  } else top(o.x, o.y, o.w, ROOM_WALL)
  top(o.x, y, ROOM_WALL, h + ROOM_WALL)
  top(o.x, y + h, o.w, ROOM_WALL)
  // The front of the bottom wall, seen from the corridor, so the walls have height.
  fill(o.x, y + h + ROOM_WALL, o.w, ROOM_LIP, ART.wall)
  fill(o.x, y + h + ROOM_WALL + ROOM_LIP - 2, o.w, 1, ART.wallTrim)
  fill(o.x, y + h + ROOM_WALL + ROOM_LIP - 1, o.w, 1, ART.outline)
  let from = y
  for (const d of [...a.doors].sort((p, q) => p.y - q.y)) {
    top(x + w, from, ROOM_WALL, d.y - from)
    // Door posts, so the gap reads as a doorway.
    fill(x + w, d.y, ROOM_WALL, 1, ART.outline)
    fill(x + w, d.y + d.h - 1, ROOM_WALL, 1, ART.outline)
    from = d.y + d.h
  }
  top(x + w, from, ROOM_WALL, y + h + ROOM_WALL - from)
}

/** A brass name plate with a socket for its status lamp on the left. */
function drawPlate(f: Fill, r: Rect) {
  f(r.x, r.y, r.w, r.h, ART.outline)
  f(r.x + 1, r.y + 1, r.w - 2, r.h - 2, ART.brassDark)
  f(r.x + 1, r.y + 1, r.w - 2, r.h - 3, ART.brass)
  f(r.x + 2, r.y + 3, 4, 4, ART.outline)
  f(r.x + r.w - 3, r.y + 2, 1, 1, ART.brassDark)
  f(r.x + r.w - 3, r.y + r.h - 4, 1, 1, ART.brassDark)
}

/** The office sign: a wooden board with the logo; the name is lettered on each frame. */
function drawSign(f: Fill, s: Rect) {
  f(s.x, s.y, s.w, s.h, ART.outline)
  f(s.x + 1, s.y + 1, s.w - 2, s.h - 2, ART.wood)
  f(s.x + 1, s.y + 1, s.w - 2, 1, ART.woodLight)
  f(s.x + 1, s.y + s.h - 2, s.w - 2, 1, ART.woodDark)
  // A little house, like the app's mark.
  const hx = s.x + 5
  const hy = s.y + 3
  f(hx + 3, hy, 2, 1, ART.brand)
  f(hx + 2, hy + 1, 4, 1, ART.brand)
  f(hx + 1, hy + 2, 6, 1, ART.brand)
  f(hx, hy + 3, 8, 1, ART.brand)
  f(hx + 1, hy + 4, 6, 4, ART.paper)
  f(hx + 3, hy + 5, 2, 3, ART.woodDark)
}

/** A cork board with notes pinned to it. Clicking it opens the key. */
function drawNotice(f: Fill, r: Rect) {
  f(r.x, r.y, r.w, r.h, ART.outline)
  f(r.x + 1, r.y + 1, r.w - 2, r.h - 2, ART.wood)
  f(r.x + 2, r.y + 2, r.w - 4, r.h - 4, ART.cork)
  const notes: [number, number, number, number, string][] = [
    [3, 2, 6, 5, ART.paper], [11, 3, 5, 4, ART.sticky], [18, 2, 6, 5, ART.paper], [25, 3, 3, 4, ART.memo],
  ]
  for (const [nx, ny, nw, nh, c] of notes) {
    f(r.x + nx, r.y + ny, nw, nh, c)
    if (nw > 4) f(r.x + nx + 1, r.y + ny + 2, nw - 2, 1, ART.ink)
    f(r.x + nx + Math.floor(nw / 2), r.y + ny, 1, 1, ART.inkRed)
  }
}

// Red brick for the front of the building, from the city sheet: the left end,
// the middle and the right end of a wall, top and bottom rows (16 by 16 each).
const BRICK = { cols: [16, 32, 48], top: 80, bottom: 128 }
// The green awning: its left and right ends, its top edge and its scalloped hem.
const AWNING = { left: 368, right: 416, edge: 148, hem: 160 }

/**
 * The building's shell, seen from above and a little in front like the street:
 * the tops of the outer walls on every side, and the front of the building in
 * brick, with the front door open onto the sidewalk.
 */
function drawShell(ctx: CanvasRenderingContext2D, f: Fill, office: Office, city: CanvasImageSource) {
  const { w, h } = office
  const e = office.entrance
  const face = h - FACADE
  const capTop = (x: number, y: number, cw: number, ch: number) => {
    if (cw <= 0 || ch <= 0) return
    f(x, y, cw, ch, ART.outline)
    f(x + 1, y + 1, cw - 2, ch - 2, ART.wallTrim)
    f(x + 1, y + 1, cw - 2, 1, ART.wall)
  }
  // Wall tops along the back and both sides, and along the front either side of the door.
  capTop(0, 0, w, CAP)
  capTop(0, 0, CAP, face)
  capTop(w - CAP, 0, CAP, face)
  capTop(0, h - FRONT, e.x + 1, CAP)
  capTop(e.x + e.w - 1, h - FRONT, w - e.x - e.w + 1, CAP)

  // The brick front, with a finished end at each corner and either side of the door.
  for (let x = 0; x < w; x += TILE) {
    if (x >= e.x && x < e.x + e.w) continue
    const end = x === 0 || x === e.x + e.w ? 0 : x + TILE === w || x + TILE === e.x ? 2 : 1
    const sx = BRICK.cols[end]
    ctx.drawImage(city, sx, BRICK.top, TILE, TILE, x, face, TILE, TILE)
    ctx.drawImage(city, sx, BRICK.bottom, TILE, TILE, x, face + TILE, TILE, TILE)
  }
  f(0, face, w, 1, ART.outline)

  // The front door: posts, glass doors slid open into the wall, and a mat on
  // the step. The lamp beside it is lit each frame.
  const lintel = 7
  for (const px of [e.x, e.x + e.w - 3]) {
    f(px, face, 3, FACADE, ART.outline)
    f(px + 1, face + lintel, 1, FACADE - lintel, ART.wallTrim)
  }
  for (const gx of [e.x + 3, e.x + e.w - 6]) {
    f(gx, face + lintel, 3, FACADE - lintel, ART.glass)
    f(gx + 1, face + lintel + 2, 1, 4, ART.glassHi)
  }
  const m = { x: e.x + 7, y: h - 9, w: e.w - 14, h: 8 }
  f(m.x, m.y, m.w, m.h, ART.outline)
  f(m.x + 1, m.y + 1, m.w - 2, m.h - 2, ART.mat)
  for (let x = m.x + 3; x < m.x + m.w - 2; x += 3) f(x, m.y + 3, 1, 2, '#7a2c2c')

  // A striped awning over the door: its top edge, then the stripes down to the scalloped hem.
  const ay = face - 6
  for (const [sx, dx] of [[AWNING.left, e.x], [AWNING.right, e.x + TILE]]) {
    ctx.drawImage(city, sx, AWNING.edge, TILE, 4, dx, ay, TILE, 4)
    ctx.drawImage(city, sx, AWNING.hem, TILE, TILE, dx, ay + 4, TILE, TILE)
  }
}

/** A window in the front of the building: sky reflected by day, lit from inside at night. */
function drawFrontWindow(rect: Fill, r: Rect, night: boolean) {
  rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, ART.outline)
  rect(r.x, r.y, r.w, r.h, night ? '#f2d27a' : ART.glass)
  if (night) rect(r.x, r.y + r.h - 4, r.w, 4, '#e0b040')
  else for (let i = 0; i < 5; i++) rect(r.x + 3 + i, r.y + 7 - i, 2, 1, ART.glassHi) // a glint on the glass
  rect(r.x + r.w / 2, r.y, 1, r.h, ART.outline)
  rect(r.x - 2, r.y + r.h + 1, r.w + 4, 2, ART.wallTrim) // the sill
  rect(r.x - 2, r.y + r.h + 3, r.w + 4, 1, ART.outline)
}

function drawSwitch(f: Fill, r: Rect, dark: boolean) {
  f(r.x, r.y, r.w, r.h, ART.outline)
  f(r.x + 1, r.y + 1, r.w - 2, r.h - 2, ART.paper)
  f(r.x + 2, r.y + 2, r.w - 4, r.h - 4, ART.wallTrim)
  // The rocker is up for the light theme, down for the dark one.
  f(r.x + 2, dark ? r.y + r.h - 4 : r.y + 2, r.w - 4, 2, ART.outline)
}

/** The floor, walls, furniture and wall fixtures, at one device pixel per art pixel. */
export function drawBackground(office: Office, sheets: Sheets) {
  const cv = document.createElement('canvas')
  cv.width = office.w
  cv.height = office.h
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const fill: Fill = (x, y, w, h, c) => {
    ctx.fillStyle = c
    ctx.fillRect(x, y, w, h)
  }
  for (let y = 0; y < office.h; y += TILE) for (let x = 0; x < office.w; x += TILE) blit(ctx, sheets, 'urban', 9, 1, x, y, 1)

  // The back wall. Windows are drawn each frame, since the sky in them changes.
  fill(0, 0, office.w, WALL * TILE, ART.wall)
  fill(0, WALL * TILE - 3, office.w, 2, ART.wallTrim)
  fill(0, WALL * TILE - 1, office.w, 1, ART.outline)
  drawSign(fill, office.sign)

  // Each area has its own floor, so areas are easy to tell apart, and walls, so each is a room.
  for (const p of [...office.pods, office.boss]) drawFloor(ctx, p)
  for (const a of rooms(office)) drawWalls(ctx, a)
  drawShell(ctx, fill, office, sheets.city)
  for (const pr of office.props) blit(ctx, sheets, pr.sheet, pr.c, pr.r, pr.x, pr.y, 1)
  for (const m of office.monitors) {
    fill(m.x, m.y, 10, 8, ART.outline)
    fill(m.x + 4, m.y + 8, 2, 2, ART.outline)
    fill(m.x + 1, m.y + 1, 8, 5, ART.screenOff)
  }
  for (const p of office.pods) drawPlate(fill, p.plate)
  drawPlate(fill, office.boss.plate)
  for (const f of office.facilities) {
    if (f.key === 'notice') drawNotice(fill, f.rect)
    // The switch flips the app between its light and dark theme.
    if (f.key === 'lights') drawSwitch(fill, f.rect, isDark())
  }
  return cv
}


/**
 * Past the office's edges the floor and back wall carry on, lined up with the
 * office's own tiles, so a window wider or taller than the office has no empty
 * border around it.
 */
// The street outside, from the Roguelike Modern City sheet: art-pixel boxes in
// its packed tilemap. Cars come in green, grey and orange, seen from each side.
type CityBox = [number, number, number, number]
const CITY = {
  walk: [[16, 320, 16, 16], [32, 336, 16, 16]] as CityBox[], // plain slabs, and one with a crack
  grass: [[0, 384, 16, 16], [16, 384, 16, 16]] as CityBox[],
  asphalt: '#404040',
  lane: '#e0b040',
  zebra: '#d8d8d8',
  kerb: '#7c8586',
  carLeft: [[503, 264, 36, 24], [503, 328, 36, 24], [503, 392, 36, 24]] as CityBox[],
  carRight: [[549, 264, 36, 24], [549, 328, 36, 24], [549, 392, 36, 24]] as CityBox[],
  carUp: [[501, 290, 22, 29], [501, 354, 22, 29], [501, 418, 22, 29]] as CityBox[],
  carDown: [[533, 290, 22, 29], [533, 354, 22, 29], [533, 418, 22, 29]] as CityBox[],
  tree: [[498, 163, 12, 45], [514, 163, 12, 45], [530, 163, 12, 45], [547, 162, 10, 46], [563, 162, 10, 46], [579, 162, 10, 46]] as CityBox[],
  bush: [[499, 212, 10, 12], [515, 212, 10, 12], [531, 212, 10, 12], [547, 209, 10, 15], [563, 209, 10, 15], [579, 209, 10, 15]] as CityBox[],
  lamp: [116, 261, 11, 42] as CityBox,
  bench: [272, 242, 32, 14] as CityBox,
  bin: [196, 228, 8, 10] as CityBox,
  hydrant: [244, 225, 8, 13] as CityBox,
  planter: [[194, 291, 12, 13], [210, 291, 12, 13], [178, 289, 12, 15]] as CityBox[],
}
// Townsfolk out walking wear the office's own people, minus the ones on staff today.
const WALKERS = [0, 3, 6, 9, 12, 15]
const WALK_ROWS = [1, 0, 2, 0]

function streetBox(p: StreetProp): CityBox {
  switch (p.kind) {
    case 'tree':
      return CITY.tree[p.variant % CITY.tree.length]
    case 'bush':
      return CITY.bush[p.variant % CITY.bush.length]
    case 'lamp':
      return CITY.lamp
    case 'bench':
      return CITY.bench
    case 'bin':
      return CITY.bin
    case 'hydrant':
      return CITY.hydrant
    case 'planter':
      return CITY.planter[p.variant % CITY.planter.length]
  }
}

function carBox(dir: CarDir, color: number): CityBox {
  const set = dir === 'left' ? CITY.carLeft : dir === 'right' ? CITY.carRight : dir === 'up' ? CITY.carUp : CITY.carDown
  return set[color % set.length]
}

/** Which tiles of a street, across its width, are road: `true` when tile t is in a road band. */
function inRoad(t: number, n: number) {
  const d = t < 0 ? -t - 1 : t >= n ? t - n : -1
  return d >= WALK && d < WALK + ROAD
}

/**
 * The city block around the office when you zoom out: sidewalks, roads with
 * cars, people out walking, a park with trees and lamps that light up at night.
 */
function drawSurround(ctx: CanvasRenderingContext2D, cam: Camera, pal: Palette, sheets: Sheets, office: Office, now: number, dark: number, extras?: Extras) {
  const P = cam.P
  const o = cam.origin()
  const tl = cam.toWorld(0, 0)
  const br = cam.toWorld(cam.vw, cam.vh)
  if (tl.x >= 0 && tl.y >= 0 && br.x <= office.w && br.y <= office.h) return
  const cols = Math.round(office.w / TILE)
  const rows = Math.round(office.h / TILE)
  const tx0 = Math.floor(tl.x / TILE) - 1
  const ty0 = Math.floor(tl.y / TILE) - 1
  const tx1 = Math.ceil(br.x / TILE) + 1
  const ty1 = Math.ceil(br.y / TILE) + 4 // tall things below the screen reach up into it
  const city = sheets.city
  const put = (b: CityBox, wx: number, wy: number, flip = false) => {
    const dx = o.x + Math.round(wx) * P
    const dy = o.y + Math.round(wy) * P
    if (!flip) return ctx.drawImage(city, b[0], b[1], b[2], b[3], dx, dy, b[2] * P, b[3] * P)
    ctx.save()
    ctx.translate(dx + b[2] * P, dy)
    ctx.scale(-1, 1)
    ctx.drawImage(city, b[0], b[1], b[2], b[3], 0, 0, b[2] * P, b[3] * P)
    ctx.restore()
  }
  const fill = (wx: number, wy: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c
    ctx.fillRect(o.x + Math.round(wx * P), o.y + Math.round(wy * P), Math.ceil(w * P), Math.ceil(h * P))
  }
  ctx.imageSmoothingEnabled = false

  // The ground.
  const things: { y: number; draw: () => void }[] = []
  const lamps: StreetProp[] = []
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const g = groundAt(tx, ty, cols, rows)
      if (g === 'building') continue
      const x = tx * TILE
      const y = ty * TILE
      if (g === 'road') {
        fill(x, y, TILE, TILE, CITY.asphalt)
        const alongX = inRoad(ty, rows) // part of a street running left to right
        const alongY = inRoad(tx, cols)
        // Zebra crossings where a street meets the sidewalk of the one crossing it.
        const dx = tx < 0 ? -tx - 1 : tx - cols
        const dy = ty < 0 ? -ty - 1 : ty - rows
        if (alongX && !alongY && (dx === WALK - 1 || dx === WALK + ROAD)) for (let i = 2; i < TILE; i += 4) fill(x + i, y + 1, 2, TILE - 2, CITY.zebra)
        if (alongY && !alongX && (dy === WALK - 1 || dy === WALK + ROAD)) for (let i = 2; i < TILE; i += 4) fill(x + 1, y + i, TILE - 2, 2, CITY.zebra)
        // A dashed line down the middle, except where streets cross.
        if (alongX && !alongY && (dy === WALK + ROAD / 2 - 1) && (tx & 1) === 0) fill(x + 4, ty < 0 ? y - 1 : y + TILE - 1, 8, 2, CITY.lane)
        if (alongY && !alongX && (dx === WALK + ROAD / 2 - 1) && (ty & 1) === 0) fill(tx < 0 ? x - 1 : x + TILE - 1, y + 4, 2, 8, CITY.lane)
        continue
      }
      if (g === 'walk') {
        put(CITY.walk[hash(tx, ty, 7) < 0.08 ? 1 : 0], x, y)
        // A kerb where the sidewalk meets the road.
        if (groundAt(tx, ty - 1, cols, rows) === 'road') fill(x, y, TILE, 1, CITY.kerb)
        if (groundAt(tx, ty + 1, cols, rows) === 'road') fill(x, y + TILE - 1, TILE, 1, CITY.kerb)
        if (groundAt(tx - 1, ty, cols, rows) === 'road') fill(x, y, 1, TILE, CITY.kerb)
        if (groundAt(tx + 1, ty, cols, rows) === 'road') fill(x + TILE - 1, y, 1, TILE, CITY.kerb)
      } else put(CITY.grass[hash(tx, ty, 8) < 0.5 ? 0 : 1], x, y)
      const p = propAt(tx, ty, cols, rows)
      if (!p) continue
      // Keep the step outside the front door clear.
      if (ty === rows && Math.abs(p.x - office.door.x) < TILE * 1.5) continue
      const b = streetBox(p)
      if (p.kind === 'lamp') lamps.push(p)
      things.push({ y: p.y, draw: () => put(b, p.x - b[2] / 2, p.y - b[3] + 1, p.flip) })
    }
  }

  // The building's shadow on the sidewalk, with the light from the top left.
  const shade = 6
  fill(office.w, shade, shade, office.h, pal['w-shadow'])
  fill(shade, office.h, office.w - shade, 3, pal['w-shadow'])

  // Traffic and people, sorted with the props so nearer things stand in front.
  const view = { x: tl.x - TILE, y: tl.y - TILE, w: br.x - tl.x + 2 * TILE, h: br.y - tl.y + 2 * TILE }
  for (const c of carsIn(view, office.w, office.h, now)) {
    if (carHidden(extras, office, c)) continue
    const b = carBox(c.dir, c.color)
    things.push({ y: c.y + b[3] / 2, draw: () => put(b, c.x - b[2] / 2, c.y - b[3] / 2) })
  }
  for (const w of walkersIn(view, office.w, office.h, now)) {
    const base = WALKERS[w.look % WALKERS.length]
    things.push({
      y: w.y,
      draw: () => blit(ctx, sheets, 'urban', FACE_COL[w.dir], base + WALK_ROWS[w.step], o.x + Math.round(w.x - TILE / 2) * P, o.y + Math.round(w.y - TILE + 1) * P, P),
    })
  }
  things.sort((a, b) => a.y - b.y)
  for (const t of things) t.draw()

  if (dark > 0) {
    ctx.fillStyle = nightTint(dark)
    ctx.fillRect(0, 0, cam.vw, cam.vh)
  }
  if (dark >= LAMPS_ON) {
    // Street lamps throw a warm pool of light at night.
    for (const l of lamps) {
      const c = cam.toScreen(l.x + (l.flip ? 3 : -3), l.y - 22)
      const r = 30 * P
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
      g.addColorStop(0, 'rgba(255, 214, 130, 0.35)')
      g.addColorStop(1, 'rgba(255, 214, 130, 0)')
      ctx.fillStyle = g
      ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2)
    }
  }
}

export function wrap(ctx: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxW: number, maxLines: number) {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  let used = 0
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width <= maxW) {
      line = next
      used++
      continue
    }
    if (line) lines.push(line)
    if (lines.length === maxLines) break
    line = w
    used++
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (used < words.length || lines.length > maxLines) {
    let last = lines[maxLines - 1] ?? ''
    while (last && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1)
    lines.length = Math.min(lines.length, maxLines)
    lines[lines.length - 1] = `${last.trimEnd()}…`
  }
  return lines
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, stroke: string, lw: number, radius: number) {
  ctx.beginPath()
  ctx.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, radius)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = stroke
  ctx.stroke()
}

const EMOTE_ICON: Record<Emote, IconName> = { idea: 'bulb', done: 'check', error: 'bang', ask: 'question', coffee: 'cup', music: 'note' }

function pixelIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, cell: number, color: string) {
  ctx.fillStyle = color
  const c = Math.max(1, Math.round(cell))
  for (const [cx, cy] of iconCells(name)) ctx.fillRect(x + cx * c, y + cy * c, c, c)
}

/** Something on the floor you can click. */
export type Hit =
  | { kind: 'sprite'; sessionId: string; label: string; key?: string }
  /** The "?" over the head of someone waiting for your OK. */
  | { kind: 'ask'; sessionId: string; label: string }
  | { kind: 'facility'; key: FacilityKey; label: string }
  | { kind: 'pod'; podId: string; label: string; thing?: Thing; rect?: Rect }
  | { kind: 'hub'; label: string; thing?: Thing; rect?: Rect }
  | { kind: 'plaque'; podId: string; label: string }
  | { kind: 'board'; podId: string; label: string }
  /** The TV on a room's back wall: its dev server and live site. */
  | { kind: 'tv'; podId: string; label: string }
  | { kind: 'cat'; label: string }

export type Box = { x: number; y: number; w: number; h: number }
export type Frame = { sprites: (Box & { s: Sprite })[]; plaques: (Box & { hit: Hit })[]; asks: (Box & { s: Sprite })[] }

const thingKey = (h: Hit) => ('rect' in h && h.rect ? `${h.thing}@${h.rect.x},${h.rect.y}` : '')

export function sameHit(a: Hit | null, b: Hit | null) {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'sprite' || a.kind === 'ask') return b.kind === a.kind && b.sessionId === a.sessionId
  if (a.kind === 'facility') return b.kind === 'facility' && a.key === b.key && a.label === b.label
  if (a.kind === 'cat') return true
  if (a.kind === 'hub') return thingKey(a) === thingKey(b)
  return 'podId' in b && a.podId === b.podId && thingKey(a) === thingKey(b)
}

/** The art rectangle a clickable thing covers, for hover outlines. */
export function hitRect(office: Office, hit: Hit): Rect | null {
  if (hit.kind === 'facility') {
    // The reports open from two places, told apart by their labels.
    const mine = office.facilities.filter((f) => f.key === hit.key)
    return (mine.find((f) => f.label === hit.label) ?? mine[0])?.rect ?? null
  }
  if (hit.kind === 'board' || hit.kind === 'plaque') {
    const p = office.pods.find((x) => x.id === hit.podId)
    return p ? (hit.kind === 'board' ? p.boardRect : p.plate) : null
  }
  if (hit.kind === 'tv') {
    const p = office.pods.find((x) => x.id === hit.podId)
    return p ? tvRect(p) : null
  }
  if (hit.kind === 'pod' || hit.kind === 'hub') return hit.rect ?? null
  return null
}

export type PodStatus = { waiting: number; working: number; open: number; juniors: number }

export function podStatus(model: WorldModel, podId: string): PodStatus {
  const st = { waiting: 0, working: 0, open: 0, juniors: 0 }
  for (const s of model.sprites.values()) {
    if (s.zone !== podId || s.activity === 'leave') continue
    if (s.rank === 'junior') st.juniors++
    else {
      st.open++
      if (s.state === 'waiting') st.waiting++
      else if (s.state === 'working') st.working++
    }
  }
  return st
}

export function statusText(st: PodStatus) {
  const main = st.waiting ? 'Needs your OK' : st.working ? (st.working === 1 ? 'Working' : `${st.working} working`) : st.open ? 'Idle' : ''
  return [main, st.juniors ? `${st.juniors} helper${st.juniors > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')
}

/** The colour of a room's status lamp, and whether it blinks. */
export function lampFor(st: PodStatus): { color: string; blink: boolean } {
  if (st.waiting) return { color: ART.lampRed, blink: true }
  if (st.working) return { color: ART.lampGreen, blink: false }
  if (st.open) return { color: ART.lampAmber, blink: false }
  return { color: ART.lampOff, blink: false }
}

/** What is on a lit screen: code while editing, a terminal while running, a page while browsing, dots while thinking. */
function drawScreen(rect: Fill, x: number, y: number, task: TaskKind | 'think' | null, k: number, now: number) {
  const line = (row: number, len: number, c: string, from = 0) => {
    if (len > 0) rect(x + from, y + row, Math.min(len, 8 - from), 1, c)
  }
  switch (task) {
    case 'think': {
      rect(x, y, 8, 5, ART.screenOff)
      const on = Math.floor(now / 260) % 4
      for (let i = 0; i < 3; i++) rect(x + 1 + i * 3, y + 2, 1, 1, i < on ? ART.screen : ART.ink)
      return
    }
    case 'run':
      rect(x, y, 8, 5, ART.term)
      for (let i = 0; i < 2; i++) line(i * 2, 2 + (((k + i * 3) * 5) % 6), ART.termText)
      if (k % 2) rect(x, y + 4, 1, 1, ART.termText)
      return
    case 'edit': {
      rect(x, y, 8, 5, ART.paper)
      line(0, 3 + (k % 3), ART.code2, 1)
      line(2, 2 + ((k >> 1) % 4), ART.code1, 2)
      const len = (k % 6) + 1
      line(4, len, ART.code3, 1)
      if (k % 2) rect(x + Math.min(7, len + 1), y + 4, 1, 1, ART.outline)
      return
    }
    case 'web':
      rect(x, y, 8, 5, ART.paper)
      rect(x, y, 8, 1, ART.code2)
      rect(x + 1, y + 2, 3, 2, ART.screen)
      line(2, 2, ART.outline, 5)
      line(3, 1 + (k % 3), ART.outline, 5)
      return
    default:
      rect(x, y, 8, 5, ART.screen)
      line(1, 2 + (k % 4), ART.outline, 1)
      line(3, 5 - (k % 4), ART.outline, 1)
  }
}

/** Writing on the whiteboard: lines filling in left to right, ticked off when it is a to-do list. */
function drawBoardWriting(rect: Fill, b: Rect, task: TaskKind | null, ms: number) {
  const ink = task === 'ask' ? ART.inkRed : ART.ink
  const LINE = 34
  const done = ((ms / 2800) % 1) * 3 * LINE
  for (let i = 0; i < 3; i++) {
    const len = Math.max(0, Math.min(LINE, done - i * LINE))
    const ly = b.y + 4 + i * 3
    if (task === 'plan') rect(b.x + 6, ly - 1, 2, 2, len >= LINE ? ART.inkGreen : ART.outline)
    if (len > 0) rect(b.x + 10, ly, Math.round(len), 1, ink)
  }
}

/** The drawer someone has pulled open, and the cabinet it is in. */
function cabinetAt(pod: Pod, s: Sprite) {
  const i = Math.max(0, Math.min(1, Math.floor((s.x - pod.cabinetRect.x) / TILE)))
  return { x: pod.cabinetRect.x + i * TILE, y: pod.cabinetRect.y }
}

function drawDrawer(rect: Fill, c: { x: number; y: number }, ms: number) {
  const open = Math.min(3, Math.floor(ms / 90))
  rect(c.x + 3, c.y + 10, 10, 3 + open, ART.outline)
  rect(c.x + 4, c.y + 10, 8, 2 + open, ART.drawer)
  rect(c.x + 5, c.y + 10, 6, 1, ART.paper)
}

/** A sheet of paper, 5 by 6, with two lines on it. */
function drawPage(rect: Fill, x: number, y: number) {
  rect(x, y, 5, 6, ART.outline)
  rect(x + 1, y + 1, 3, 4, ART.paper)
  rect(x + 1, y + 2, 3, 1, ART.ink)
}

/** The wall clock, telling the real time. */
function drawClock(rect: Fill, r: Rect, d: Date) {
  const { x, y } = r
  rect(x + 2, y, 6, 1, ART.outline)
  rect(x + 2, y + 9, 6, 1, ART.outline)
  rect(x, y + 2, 1, 6, ART.outline)
  rect(x + 9, y + 2, 1, 6, ART.outline)
  for (const [cx, cy] of [[1, 1], [8, 1], [1, 8], [8, 8]]) rect(x + cx, y + cy, 1, 1, ART.outline)
  rect(x + 2, y + 1, 6, 8, ART.clockFace)
  rect(x + 1, y + 2, 8, 6, ART.clockFace)
  rect(x + 4, y + 1, 2, 1, ART.wallTrim)
  rect(x + 4, y + 8, 2, 1, ART.wallTrim)
  rect(x + 1, y + 4, 1, 2, ART.wallTrim)
  rect(x + 8, y + 4, 1, 2, ART.wallTrim)
  const cx = x + 4.5
  const cy = y + 4.5
  const hand = (turns: number, len: number, c: string) => {
    const a = turns * Math.PI * 2 - Math.PI / 2
    for (let i = 0; i <= len; i++) rect(Math.round(cx + Math.cos(a) * i - 0.5), Math.round(cy + Math.sin(a) * i - 0.5), 1, 1, c)
  }
  hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12, 2, ART.outline)
  hand(d.getMinutes() / 60, 3, ART.outline)
  hand(d.getSeconds() / 60, 3, ART.inkRed)
}

/** Sky colours through the windows by hour: [top, bottom]. */
export function skyAt(hour: number): { top: string; bottom: string; stars: boolean; clouds: boolean } {
  if (hour < 5 || hour >= 21) return { top: '#141a33', bottom: '#27305a', stars: true, clouds: false }
  if (hour < 7) return { top: '#6f7fb8', bottom: '#f0a86a', stars: false, clouds: false }
  if (hour < 17) return { top: '#6cc0ef', bottom: '#a8e0f8', stars: false, clouds: true }
  if (hour < 19) return { top: '#8a5fa8', bottom: '#f08a5a', stars: false, clouds: false }
  return { top: '#27305a', bottom: '#5a4a7a', stars: true, clouds: false }
}

function drawWindow(rect: Fill, w: Rect, d: Date, now: number, i: number) {
  const sky = skyAt(hourOf(d))
  rect(w.x, w.y, w.w, w.h, ART.outline)
  const ix = w.x + 1
  const iy = w.y + 1
  const iw = w.w - 2
  const ih = w.h - 3
  rect(ix, iy, iw, ih, sky.bottom)
  rect(ix, iy, iw, Math.ceil(ih * 0.55), sky.top)
  if (sky.stars) {
    for (let k = 0; k < 4; k++) {
      const sx = ix + ((i * 13 + k * 7) % (iw - 1))
      const sy = iy + ((i * 5 + k * 3) % (ih - 3))
      if ((Math.floor(now / 700) + k + i) % 5) rect(sx, sy, 1, 1, ART.paper)
    }
  }
  if (sky.clouds) {
    const span = iw + 8
    const cx = ix - 6 + ((now / 900 + i * 11) % span)
    const cy = iy + 2 + (i % 3)
    const part = (x: number, y: number, pw: number) => {
      const a = Math.max(x, ix)
      const b = Math.min(x + pw, ix + iw)
      if (b > a) rect(Math.round(a), y, Math.round(b - a), 1, '#ffffff')
    }
    part(cx + 1, cy, 3)
    part(cx, cy + 1, 6)
  }
  rect(ix + Math.floor(iw / 2), iy, 1, ih, ART.wallTrim)
  rect(ix, iy + Math.floor(ih / 2), iw, 1, ART.wallTrim)
  rect(w.x - 1, w.y + w.h - 2, w.w + 2, 2, ART.wallTrim)
}

const tri = (t: number) => 1 - Math.abs(2 * (t - Math.floor(t)) - 1)
/** A stable number from 0 to 1 for a person and an index, for effects that should look random but not flicker. */
const noise = (seed: number, k: number) => {
  const v = Math.sin((seed % 10007) * 0.0137 + k * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

export type FrameUi = {
  hover: Hit | null
  focus: string | null
  /** The room you are in, or null for the whole floor. */
  room: Area | null
  /** The session you clicked on: its people get a ring and a label. */
  selected: string | null
  /** The person you are dragging. */
  carrying: string | null
  /** Plan use in percent, for the meter on the wall. */
  limits: { fiveHour: number | null; week: number | null }
  connected: boolean
  /** While past logs are being read: how far along, from 0 to 1. */
  loading: number | null
  /** What happens around the staff: visitors, parcels, test lamps, the cat and the weather. */
  extras?: Extras
  /** Each project's dev server and live site, for the TVs. */
  previews?: Map<string, Preview>
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  dpr: number,
  office: Office,
  pal: Palette,
  model: WorldModel,
  bg: HTMLCanvasElement,
  sheets: Sheets,
  now: number,
  ui: FrameUi,
): Frame {
  const P = cam.P
  const o = cam.origin()
  const date = new Date(now)
  const dark = darkness(hourOf(date))
  const night = dark >= LAMPS_ON
  ctx.imageSmoothingEnabled = false
  drawSurround(ctx, cam, pal, sheets, office, now, dark, ui.extras)
  if (ui.extras) drawOutside(ctx, cam, office, ui.extras, now)
  ctx.drawImage(bg, o.x, o.y, bg.width * P, bg.height * P)
  // Evening dims the room with the street; people, lamps and lit screens stay bright.
  if (dark > 0) {
    ctx.fillStyle = nightTint(dark)
    ctx.fillRect(o.x, o.y, bg.width * P, bg.height * P)
  }

  const rect: Fill = (x, y, w, h, c) => {
    ctx.fillStyle = c
    ctx.fillRect(o.x + Math.round(x * P), o.y + Math.round(y * P), Math.ceil(w * P), Math.ceil(h * P))
  }
  const artIcon = (name: IconName, x: number, y: number, c: string) => {
    for (const [cx, cy] of iconCells(name)) rect(x + cx, y + cy, 1, 1, c)
  }
  const visible = (r: Rect) => {
    const a = cam.toScreen(r.x, r.y)
    return a.x < cam.vw && a.y < cam.vh && a.x + r.w * P > 0 && a.y + r.h * P > 0
  }
  /** Lettering on a sign or plate, sized with the room so it zooms with everything else. */
  const letter = (text: string, r: Rect, color: string, sizeArt: number, align: 'center' | 'left' | 'right' = 'center') => {
    if (!visible(r)) return
    if (Math.round(sizeArt * P) < 7) return
    // Jersey 15 runs small for its size, so it is set a third larger.
    let size = Math.round(sizeArt * P * 1.3)
    const maxW = r.w * P
    const setFont = () => (ctx.font = `400 ${size}px 'Jersey 15', 'Inter Variable', system-ui, sans-serif`)
    setFont()
    let s = text
    let w = ctx.measureText(s).width
    if (w > maxW) {
      size = Math.max(7, Math.floor(Math.max(size * 0.75, (size * maxW) / w)))
      setFont()
      w = ctx.measureText(s).width
      while (s.length > 1 && w > maxW) {
        s = s.slice(0, -1)
        w = ctx.measureText(`${s.trimEnd()}…`).width
      }
      if (s !== text) s = `${s.trimEnd()}…`
    }
    ctx.fillStyle = color
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const left = o.x + r.x * P
    const x = align === 'left' ? left : align === 'right' ? left + maxW - w : left + (maxW - w) / 2
    ctx.fillText(s, Math.round(x), Math.round(o.y + (r.y + r.h / 2) * P + P * 0.5))
  }

  const frame: Frame = { sprites: [], plaques: [], asks: [] }
  const overlays: (() => void)[] = []
  const px = (n: number) => Math.round(n * dpr)
  const lw = Math.max(1, px(2))
  const plated = [...office.pods, office.boss]
  const statuses = new Map(plated.map((p) => [p.id, podStatus(model, p.id)]))
  const outline = (r: Rect, color: string, alpha = 1) => {
    ctx.globalAlpha = alpha
    ctx.lineWidth = lw
    ctx.strokeStyle = color
    ctx.strokeRect(o.x + r.x * P - lw, o.y + r.y * P - lw, r.w * P + lw * 2, r.h * P + lw * 2)
    ctx.globalAlpha = 1
  }
  const room = ui.room ? roomShell(ui.room) : null
  const inRoom = (x: number, y: number) => !room || (x >= room.x - 2 && x <= room.x + room.w + 2 && y >= room.y - 2 && y <= room.y + room.h + 2)
  const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now / 280))
  const blinkOn = Math.floor(now / 450) % 2 === 0

  // ---- the walls: windows, the sign, name plates, the clock, the plan meter, the exit lamp

  office.windows.forEach((w, i) => {
    if (visible(w)) drawWindow(rect, w, date, now, i)
  })
  // The weather in the windows is darker once their sky has gone dark.
  if (ui.extras) drawWindowWeather(ctx, cam, office, ui.extras, now, skyAt(hourOf(date)).stars)
  letter('Claude HQ', { x: office.sign.x + 15, y: office.sign.y + 1, w: office.sign.w - 20, h: office.sign.h - 2 }, ART.paper, 9)

  for (const p of plated) {
    if (!visible(p.plate)) continue
    const lamp = lampFor(statuses.get(p.id)!)
    const lit = !lamp.blink || blinkOn
    rect(p.plate.x + 3, p.plate.y + 4, 2, 2, lit ? lamp.color : ART.lampOff)
    if (lit && lamp.color !== ART.lampOff) {
      ctx.globalAlpha = 0.35
      rect(p.plate.x + 2, p.plate.y + 3, 4, 4, lamp.color)
      ctx.globalAlpha = 1
    }
    letter(p.name, { x: p.plate.x + 8, y: p.plate.y + 1, w: p.plate.w - 11, h: p.plate.h - 3 }, ART.outline, 7)
  }

  for (const f of office.facilities) {
    if (!visible(f.rect)) continue
    if (f.key === 'clock') drawClock(rect, f.rect, date)
    else if (f.key === 'limits') {
      const r = f.rect
      rect(r.x, r.y, r.w, r.h, ART.outline)
      rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, ART.term)
      const rows: [string, number | null][] = [['5h', ui.limits.fiveHour], ['wk', ui.limits.week]]
      rows.forEach(([label, pct], i) => {
        const ry = r.y + 2 + i * 4
        const bx = r.x + 11
        const bw = r.w - 25
        rect(bx, ry, bw, 2, ART.screenOff)
        if (pct != null) {
          const v = Math.max(0, Math.min(100, pct))
          const c = v >= 90 ? ART.lampRed : v >= 75 ? ART.lampAmber : ART.lampGreen
          if (v > 0) rect(bx, ry, Math.max(1, Math.round((bw * v) / 100)), 2, c)
          letter(`${Math.round(v)}%`, { x: r.x + r.w - 13, y: ry - 1, w: 12, h: 4 }, ART.paper, 4, 'right')
        }
        letter(label, { x: r.x + 2, y: ry - 1, w: 8, h: 4 }, ART.termText, 4, 'left')
      })
    } else if (f.key === 'archive' && ui.loading != null) {
      // Reading past logs: the archive fills up.
      const r = f.rect
      rect(r.x + 2, r.y - 4, r.w - 4, 3, ART.outline)
      rect(r.x + 3, r.y - 3, Math.round((r.w - 6) * Math.max(0, Math.min(1, ui.loading))), 1, ART.lampGreen)
    }
  }

  // The lamp over the front door: green while HQ is live, blinking red while it reconnects.
  {
    const e = office.entrance
    const lamp = { x: e.x + e.w + 3, y: office.h - FACADE + 4, w: 16, h: 6 }
    const lit = ui.connected || blinkOn
    const c = ui.connected ? ART.lampGreen : ART.lampRed
    rect(lamp.x - 1, lamp.y - 1, lamp.w + 2, lamp.h + 2, ART.outline)
    rect(lamp.x, lamp.y, lamp.w, lamp.h, lit ? c : ART.lampOff)
    if (lit && ui.connected) letter('OPEN', lamp, ART.outline, 4)
  }
  for (const w of office.frontWindows) if (visible(w)) drawFrontWindow(rect, w, night)

  // Screens light up while someone works at them, and show what kind of work it is.
  const uses = new Map<Sprite, Use>()
  for (const s of model.sprites.values()) {
    const u = model.using(s)
    if (u) uses.set(s, u)
  }
  const glows: { x: number; y: number; c: string }[] = []
  for (const [s, u] of uses) {
    const desk = u.at === 'desk' ? model.deskFor(s) : null
    // The boss's desk has no screen: work there is paper and phone calls.
    if (!desk || model.pod(s.zone)?.kind === 'boss') continue
    // Two-tile desks have the monitor in the middle; small ones, near the left.
    const m = desk.w > TILE ? { x: desk.x + TILE - 5, y: desk.y - 3 } : { x: desk.x + 3, y: desk.y - 2 }
    if (s.rank === 'senior' && s.state === 'waiting') {
      rect(m.x + 1, m.y + 1, 8, 5, blinkOn ? pal.turn : ART.screenOff)
      if (blinkOn) glows.push({ x: m.x + 5, y: m.y + 3, c: pal.turn })
      continue
    }
    const thinking = model.thinking(s, now)
    if (!u.active && !thinking) continue
    drawScreen(rect, m.x + 1, m.y + 1, thinking ? 'think' : u.task, Math.floor((now - s.actAt) / 160) + (s.seed % 7), now)
    glows.push({ x: m.x + 5, y: m.y + 3, c: u.task === 'run' ? ART.termText : ART.screen })
    // Code flying off the screen while editing.
    if (u.task === 'edit') {
      for (let i = 0; i < 3; i++) {
        const t = (now / 1400 + i / 3 + (s.seed % 10) / 10) % 1
        ctx.globalAlpha = 1 - t
        rect(m.x + 1 + i * 3, Math.round(m.y - 1 - t * 9), 2, 1, [ART.code1, ART.code2, ART.code3][i])
      }
      ctx.globalAlpha = 1
    }
  }
  // At night, lit screens throw a soft light on the desk.
  if (night && glows.length) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const g of glows) {
      const c = cam.toScreen(g.x, g.y)
      const r = 22 * P
      if (c.x + r < 0 || c.y + r < 0 || c.x - r > cam.vw || c.y - r > cam.vh) continue
      const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
      grad.addColorStop(0, g.c)
      grad.addColorStop(1, 'transparent')
      ctx.globalAlpha = 0.22
      ctx.fillStyle = grad
      ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2)
    }
    ctx.restore()
  }

  // Furniture in use: written on, pulled open, and outlined so it is easy to spot.
  for (const [s, u] of uses) {
    const ms = now - s.actAt
    if (u.at === 'vending') rect(s.x + 3, s.y - 24, 2, 1, Math.floor(now / 400) % 2 ? ART.termText : ART.screenOff)
    if (!u.active) continue
    const desk = u.at === 'desk' ? model.deskFor(s) : null
    if (desk) outline(desk, pal.accent, pulse)
    const pod = model.pod(s.zone)
    if (!pod) continue
    if (u.at === 'board') {
      drawBoardWriting(rect, pod.boardRect, u.task, ms)
      outline(pod.boardRect, pal.accent, pulse)
    } else if (u.at === 'cabinet') {
      drawDrawer(rect, cabinetAt(pod, s), ms)
      outline(pod.cabinetRect, pal.accent, pulse)
    }
  }

  // TVs, trophies, dust, uncommitted changes on the whiteboards, parcels and test lamps.
  if (ui.extras) {
    const boards = new Set<string>()
    for (const [s, u] of uses) if (u.at === 'board' && u.active) boards.add(s.zone)
    drawRoomExtras(ctx, cam, office, model, ui.extras, ui.previews, now, boards, (b, hit) => frame.plaques.push({ ...b, hit }))
  }

  // Rooms waiting on you get a border in your-turn pink, the chosen one in accent.
  ctx.lineWidth = lw
  for (const p of plated) {
    const waiting = statuses.get(p.id)!.waiting > 0
    if (!waiting && ui.focus !== p.id) continue
    const r = outerRect(p)
    ctx.strokeStyle = waiting ? pal.turn : pal.accent
    ctx.strokeRect(o.x + (r.x - 3) * P, o.y + (r.y - 3) * P, (r.w + 6) * P, (r.h + 6) * P)
  }
  const hr = ui.hover && hitRect(office, ui.hover)
  if (hr) outline(hr, pal.accent)

  // While you carry someone, every way out glows.
  if (ui.carrying) {
    const glow = 0.4 + 0.6 * pulse
    outline(office.entrance, pal.accent, glow)
    for (const a of rooms(office)) for (const d of a.doors) outline({ x: d.x - 1, y: d.y, w: d.w + 2, h: d.h }, pal.accent, glow)
  }

  // The receptionist, always at the desk, typing and looking up now and then.
  {
    const r = office.receptionist
    const look: Facing[] = ['down', 'down', 'down', 'left', 'down', 'right']
    const facing = look[Math.floor(now / 4000) % look.length]
    const bx = o.x + Math.round(r.x - TILE / 2) * P
    const by = o.y + (Math.round(r.y - TILE) + 2 + (facing === 'down' && Math.floor(now / 240) % 2 ? -1 : 0)) * P
    if (bx < cam.vw && by < cam.vh && bx + TILE * P > 0 && by + TILE * P > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(bx, by, TILE * P, (TILE - 3) * P)
      ctx.clip()
      blit(ctx, sheets, 'urban', FACE_COL[facing], RECEPTIONIST, bx, by, P)
      ctx.restore()
    }
  }

  // People, back to front. Whoever you carry is drawn over everything.
  const people = [...model.sprites.values()].filter((s) => s.placed).sort((a, b) => (a.key === ui.carrying ? 1 : 0) - (b.key === ui.carrying ? 1 : 0) || a.y - b.y)
  for (const s of people) {
    const u = uses.get(s)
    const carried = s.key === ui.carrying
    const walking = s.path.length > 0
    let step = walking ? 1 + (Math.floor(now / (s.rank === 'junior' ? 110 : 150)) % 2) : 0
    let dx = 0
    let dy = 0
    if (u?.at === 'desk' && u.active && Math.floor(now / 220 + s.seed) % 2) dy = -1 // typing
    if (u?.at === 'board' && u.active) {
      // Writing along the board.
      step = 1 + (Math.floor(now / 380) % 2)
      dx = Math.round(Math.sin(now / 600 + s.seed) * 2)
    }
    if (u?.at === 'cabinet' && u.active && Math.floor(now / 300 + s.seed) % 2) dy = -1 // leafing through files
    if (model.asleep(s, now)) dy = Math.floor(now / 1400) % 2 // nodding off
    if (u?.at === 'stretch') {
      // Reaching up, then down again.
      const k = Math.floor(now / 600 + s.seed) % 4
      dy = k === 1 ? -2 : k === 3 ? 1 : 0
    }
    if (carried) {
      // Legs kicking, swaying a little.
      step = 1 + (Math.floor(now / 90) % 2)
      dx = Math.round(Math.sin(now / 140) * 1.5)
    }
    // The boss and their visitors sit in proper chairs, so their legs are hidden too.
    const seated = u?.at === 'table' || u?.at === 'sofa' || (u?.at === 'desk' && model.pod(s.zone)?.kind === 'boss' && s.slot != null)
    const e = s.emote
    if (e?.kind === 'done' && now - e.since < 500) dy -= Math.round(Math.sin(((now - e.since) / 500) * Math.PI) * 3) // a little hop
    if (e?.kind === 'error' && now - e.since < 450) dx += Math.floor(now / 60) % 2 ? 1 : -1 // a shake
    const base = lookOf(s)
    const ax = Math.round(s.x - TILE / 2) + dx
    const ay = Math.round(s.y - TILE) + dy + (seated ? 2 : 0)
    const bx = o.x + ax * P
    const by = o.y + ay * P
    if (bx > cam.vw || by > cam.vh || bx + TILE * P < 0 || by + TILE * P < 0) continue
    const mine = ui.selected != null && s.sessionId === ui.selected
    if (carried) {
      // Their shadow stays on the floor below them.
      ctx.globalAlpha = 0.6
      rect(Math.round(s.x) - 3, Math.round(s.y) + 7, 6, 2, pal['w-shadow'])
      ctx.globalAlpha = 1
    } else rect(Math.round(s.x) - 4, Math.round(s.y) - 1, 8, 2, pal['w-shadow'])
    if (mine && !carried) {
      // A ring at their feet marks who you clicked on.
      const c = cam.toScreen(s.x, s.y)
      ctx.globalAlpha = 0.5 + 0.5 * pulse
      ctx.lineWidth = Math.max(1, Math.round(P / 2))
      ctx.strokeStyle = pal.accent
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, 7 * P, 3 * P, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    const facing = carried ? 'down' : s.facing
    if (seated) {
      // Sitting: the legs are hidden by the seat.
      ctx.save()
      ctx.beginPath()
      ctx.rect(bx, by, TILE * P, (TILE - 3) * P)
      ctx.clip()
      blit(ctx, sheets, 'urban', FACE_COL[facing], base + step, bx, by, P)
      ctx.restore()
    } else blit(ctx, sheets, 'urban', FACE_COL[facing], base + step, bx, by, P)
    if (!inRoom(s.x, s.y) && !carried) continue
    frame.sprites.push({ x: bx, y: by, w: TILE * P, h: TILE * P, s })
    if (carried) continue
    const cx = bx + (TILE * P) / 2
    const feet = o.y + Math.round(s.y) * P
    overlays.push(() => drawOverlay(ctx, cam, dpr, pal, model, s, u, cx, by + 2 * P, feet, now, mine, frame.asks))
  }

  // Visitors, the mail clerk and the cat; then smoke and sparkles from test runs.
  if (ui.extras) {
    overlays.push(...drawNpcs(ctx, cam, dpr, pal, sheets, ui.extras, now, (b, hit) => frame.plaques.push({ ...b, hit })))
    drawDramaFx(ctx, cam, model, ui.extras, now)
  }

  // Small things that happen above people: steam, water, papers, a magnifier, confetti.
  for (const s of model.sprites.values()) {
    const e = s.emote
    if (!s.placed || e?.kind !== 'done' || s.rank !== 'senior') continue
    const t = (now - e.since) / 1000
    if (t > 1.4) continue
    ctx.globalAlpha = Math.max(0, 1 - t / 1.4)
    for (let i = 0; i < 14; i++) {
      const vx = (noise(s.seed, i) - 0.5) * 60
      const vy = -45 - noise(s.seed, i + 20) * 35
      rect(Math.round(s.x + vx * t), Math.round(s.y - 18 + vy * t + 70 * t * t), 1 + (i % 2), 1, CONFETTI[i % CONFETTI.length])
    }
    ctx.globalAlpha = 1
  }
  for (const [s, u] of uses) {
    if (u.at === 'coffee') {
      for (let i = 0; i < 3; i++) {
        const t = (now / 1100 + i / 3 + (s.seed % 10) / 10) % 1
        ctx.globalAlpha = 1 - t
        rect(Math.round(s.x + Math.sin(t * 7 + i * 2) * 1.5), Math.round(s.y - 24 - t * 9), 1, 1, ART.paper)
      }
      ctx.globalAlpha = 1
    } else if (u.at === 'vending') {
      const t = (now / 1800 + (s.seed % 10) / 10) % 1
      if (t < 0.4) rect(s.x - 2, Math.round(s.y - 22 + (t / 0.4) * 6), 2, 3, ART.can)
    } else if (u.at === 'printer' || u.at === 'archive') {
      // A page coming out of the printer, or pulled from the files.
      const t = (now / 1500 + (s.seed % 10) / 10) % 1
      ctx.globalAlpha = 1 - t * 0.6
      drawPage(rect, Math.round(s.x) - 3, Math.round(s.y - 30 + t * (u.at === 'printer' ? 5 : -5)))
      ctx.globalAlpha = 1
    } else if (u.at === 'phone') {
      // A phone held to the ear, on whichever side they face.
      const side = s.facing === 'left' ? -4 : 3
      rect(Math.round(s.x) + side, Math.round(s.y) - 13, 1, 4, ART.outline)
    } else if (u.at === 'plant') {
      for (let i = 0; i < 2; i++) rect(s.x - 1 + i * 2, Math.round(s.y - 26 + ((now / 700 + i / 2) % 1) * 8), 1, 1, ART.water)
    } else if (u.at === 'cabinet' && u.active) {
      const pod = model.pod(s.zone)
      if (!pod) continue
      const ms = now - s.actAt
      if (u.task === 'search') {
        const r = pod.cabinetRect
        artIcon('search', Math.round(r.x + 1 + tri(ms / 1400) * (r.w - 9)) + 1, r.y + 3, ART.outline)
        artIcon('search', Math.round(r.x + 1 + tri(ms / 1400) * (r.w - 9)), r.y + 2, ART.paper)
      } else {
        const c = cabinetAt(pod, s)
        const t = (ms / 1100) % 1
        ctx.globalAlpha = 1 - t * 0.8
        drawPage(rect, c.x + 5, Math.round(c.y + 6 - t * 9))
        ctx.globalAlpha = 1
      }
    } else if (u.at === 'handoff') {
      // The brief goes from senior to junior; the report comes back.
      const boss = s.bossKey ? model.sprites.get(s.bossKey) : undefined
      if (!boss) continue
      const briefing = s.activity === 'brief'
      const p = 1 - Math.max(0, s.restUntil - now) / (briefing ? BRIEF_MS : REPORT_MS)
      const q = Math.min(1, p / 0.45)
      const [a, b] = briefing ? [boss, s] : [s, boss]
      const x = a.x + (b.x - a.x) * q
      const y = a.y - 9 + (b.y - a.y) * q - Math.sin(q * Math.PI) * 6
      if (q < 1) drawPage(rect, Math.round(x - 2), Math.round(y - 3))
    }
  }

  // Inside a room, the rest of the floor fades back. The room's own border stays clear.
  if (room) {
    const a = cam.toScreen(room.x - 4, room.y - 4)
    const b = cam.toScreen(room.x + room.w + 4, room.y + room.h + 4)
    ctx.globalAlpha = 0.72
    ctx.fillStyle = pal['w-void']
    ctx.fillRect(0, 0, cam.vw, a.y)
    ctx.fillRect(0, b.y, cam.vw, cam.vh - b.y)
    ctx.fillRect(0, a.y, a.x, b.y - a.y)
    ctx.fillRect(b.x, a.y, cam.vw - b.x, b.y - a.y)
    ctx.globalAlpha = 1
  }

  for (const draw of overlays) draw()
  return frame
}

// A thought cloud, in pixels: '#' outline, '.' fill.
const CLOUD = [
  '   ####  ###   ',
  '  #....##...#  ',
  ' #...........# ',
  '#.............#',
  '#.............#',
  ' #...........# ',
  '  ##..###...#  ',
  '    ##   ###   ',
]

/** Thinking: a cloud over their head with dots rising and falling in turn. */
function drawThought(ctx: CanvasRenderingContext2D, cx: number, top: number, q: number, now: number, seed: number) {
  const bob = Math.floor((now + seed) / 700) % 2 ? q : 0
  const x0 = Math.round(cx - 4 * q)
  const y0 = Math.round(top - 14 * q) - bob
  const cell = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c
    ctx.fillRect(x, y, w, h)
  }
  // Puffs leading up from the head, lighting up one after the other.
  const beat = Math.floor(now / 300) % 3
  cell(Math.round(cx + q), Math.round(top - 2 * q), q, q, beat === 0 ? ART.paper : ART.outline)
  cell(Math.round(cx + 2 * q), Math.round(top - 5 * q), 2 * q, 2 * q, ART.outline)
  if (beat !== 2) cell(Math.round(cx + 2 * q) + Math.round(q / 2), Math.round(top - 5 * q) + Math.round(q / 2), q, q, ART.paper)
  CLOUD.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === ' ') continue
      cell(x0 + x * q, y0 + y * q, q, q, ch === '#' ? ART.outline : ART.paper)
    }
  })
  for (let i = 0; i < 3; i++) {
    const up = Math.floor(now / 220) % 4 === i ? q : 0
    cell(x0 + (3 + i * 3) * q, y0 + 3 * q - up, 2 * q, 2 * q, ART.ink)
  }
}

export type RoleTone = 'boss' | 'manager' | 'agent' | 'helper'

/** What the tag under someone's feet says. */
export function roleTag(s: Pick<Sprite, 'rank' | 'role'>): { text: string; tone: RoleTone } {
  if (s.role === 'boss') return { text: 'Boss', tone: 'boss' }
  if (s.role === 'manager') return { text: 'Manager', tone: 'manager' }
  return s.rank === 'junior' ? { text: 'Helper', tone: 'helper' } : { text: 'Agent', tone: 'agent' }
}

const TAG_TONE: Record<RoleTone, { bg: keyof Palette; line: keyof Palette; text: keyof Palette }> = {
  boss: { bg: 'warn-bg', line: 'warn', text: 'warn' },
  manager: { bg: 'ok-bg', line: 'ok', text: 'ok' },
  agent: { bg: 'accent-bg', line: 'accent', text: 'accent-text' },
  helper: { bg: 'panel', line: 'line-strong', text: 'text-2' },
}

function drawOverlay(
  ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, pal: Palette, model: WorldModel,
  s: Sprite, u: Use | undefined, cx: number, top: number, feet: number, now: number, selected: boolean, asks: Frame['asks'],
) {
  const lw = Math.max(1, Math.round(2 * dpr))
  const px = (n: number) => Math.round(n * dpr)
  const font = (size: number, w = 400) => `${w} ${px(size)}px 'Inter Variable', system-ui, sans-serif`
  ctx.textBaseline = 'top'

  // What they are doing, in words, only for people you clicked on. People at
  // the whiteboard or cabinets have it under their feet so the furniture stays in view.
  const chip = selected && s.running && s.tool ? { icon: TASKS[taskOf(s.tool)].icon, text: taskLabel(s.tool, s.summary) } : null
  const below = !!chip && (u?.at === 'board' || u?.at === 'cabinet')
  const drawChip = (c: { icon: IconName; text: string }, y: number) => {
    ctx.font = font(11, 600)
    const cell = Math.max(1, Math.round(1.5 * dpr))
    const isz = 7 * cell
    const pad = px(5)
    const tw = Math.ceil(ctx.measureText(c.text).width)
    const w = pad + isz + px(5) + tw + pad
    const h = px(20)
    const x = Math.max(2, Math.min(cam.vw - w - 2, Math.round(cx - w / 2)))
    box(ctx, x, y, w, h, pal.panel, pal.accent, Math.max(1, px(1.5)), 3 * dpr)
    pixelIcon(ctx, c.icon, x + pad, y + Math.round((h - isz) / 2), cell, pal['accent-text'])
    ctx.fillStyle = pal.text
    ctx.textBaseline = 'middle'
    ctx.fillText(c.text, x + pad + isz + px(5), y + h / 2)
    ctx.textBaseline = 'top'
    return h
  }
  // Their role, under their feet: the boss, a manager, an agent (a session) or a helper (a subagent).
  let underFeet = feet + px(3)
  if (cam.P >= 2 * dpr) {
    const tag = roleTag(s)
    const tone = TAG_TONE[tag.tone]
    ctx.font = font(9, 700)
    const tw = Math.ceil(ctx.measureText(tag.text).width)
    const w = tw + px(8)
    const h = px(13)
    const x = Math.round(cx - w / 2)
    box(ctx, x, underFeet, w, h, pal[tone.bg], pal[tone.line], Math.max(1, px(1)), px(2))
    ctx.fillStyle = pal[tone.text]
    ctx.textBaseline = 'middle'
    ctx.fillText(tag.text, x + px(4), underFeet + h / 2)
    ctx.textBaseline = 'top'
    underFeet += h + px(2)
  }
  if (chip && below) drawChip(chip, underFeet)

  // More helpers than desks: a small count beside the senior you clicked on.
  const extra = selected && s.rank === 'senior' ? model.hiddenCount(s.sessionId) : 0
  if (extra) {
    ctx.font = font(10, 700)
    const label = `+${extra}`
    const w = Math.ceil(ctx.measureText(label).width) + px(8)
    box(ctx, cx + px(10), top + px(6), w, px(15), pal['accent-bg'], pal.accent, Math.max(1, px(1)), px(3))
    ctx.fillStyle = pal['accent-text']
    ctx.fillText(label, cx + px(14), top + px(8))
  }

  if (s.state === 'waiting' && s.rank === 'senior') {
    // Click the "?" to answer them in a card over their head.
    const size = px(18)
    const jump = Math.floor(now / 350) % 2 ? px(2) : 0
    const x = Math.round(cx - size / 2)
    const y = top - size - px(4) - jump
    const cell = px(1.5)
    box(ctx, x, y, size, size, pal['turn-bg'], pal.turn, lw, 3 * dpr)
    pixelIcon(ctx, 'question', x + Math.round((size - 7 * cell) / 2), y + Math.round((size - 7 * cell) / 2), cell, pal.turn)
    // A little extra all round, so it is easy to hit.
    const pad = px(4)
    asks.push({ x: x - pad, y: y - pad - jump, w: size + pad * 2, h: size + pad * 2 + jump, s })
    top = y
  }

  if (s.bubble) {
    ctx.font = font(12)
    const pad = px(6)
    const lineH = px(16)
    const lines = wrap(ctx, s.bubble.text, px(180), 3)
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + pad * 2
    const h = lines.length * lineH + pad * 2 - px(2)
    const tail = px(6)
    const x = Math.max(2, Math.min(cam.vw - w - 2, Math.round(cx - w / 2)))
    const y = Math.max(2, top - h - tail)
    // Small talk is quieter than what the session actually said.
    const fill = s.bubble.you ? pal['accent-bg'] : pal.panel
    const stroke = s.bubble.you ? pal.accent : s.bubble.chatter ? pal.line : pal['line-strong']
    box(ctx, x, y, w, h, fill, stroke, lw, 4 * dpr)
    ctx.fillStyle = stroke
    ctx.fillRect(Math.round(cx - tail / 2), y + h - lw, tail, tail)
    ctx.fillStyle = s.bubble.you ? pal['accent-text'] : s.bubble.chatter ? pal['text-2'] : pal.text
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * lineH))
    return
  }

  // Little reactions: an idea, done, a mistake, a question, coffee, humming.
  if (s.emote) {
    const kind = s.emote.kind
    const icon = EMOTE_ICON[kind]
    const color = kind === 'error' ? pal.bad : kind === 'done' ? pal['accent-text'] : kind === 'idea' ? ART.bulb : pal['text-2']
    const size = px(18)
    const rise = Math.round(((now % 1200) / 1200) * px(2))
    const x = Math.round(cx - size / 2)
    const y = top - size - px(3) - rise
    box(ctx, x, y, size, size, pal.panel, kind === 'error' ? pal.bad : kind === 'idea' ? ART.bulb : pal.line, Math.max(1, px(kind === 'idea' ? 2 : 1)), px(4))
    pixelIcon(ctx, icon, x + Math.round((size - 7 * px(1.5)) / 2), y + Math.round((size - 7 * px(1.5)) / 2), px(1.5), color)
    if (kind === 'idea' && Math.floor(now / 150) % 2) {
      // Rays around the bulb.
      ctx.fillStyle = ART.bulb
      const r = px(3)
      ctx.fillRect(x - r - px(2), y + size / 2 - px(1), r, px(2))
      ctx.fillRect(x + size + px(2), y + size / 2 - px(1), r, px(2))
      ctx.fillRect(x + size / 2 - px(1), y - r - px(2), px(2), r)
    }
    return
  }

  if (model.thinking(s, now)) {
    drawThought(ctx, cx, top, Math.max(Math.round(1.5 * dpr), Math.round(cam.P * 0.75)), now, s.seed)
    return
  }

  if (chip && !below) {
    drawChip(chip, top - px(20) - px(3))
    return
  }

  if (model.asleep(s, now)) {
    const size = px(16)
    const t = (now / 1400) % 1
    const x = Math.round(cx + px(4))
    const y = top - size - Math.round(t * px(8))
    ctx.globalAlpha = 1 - t * 0.7
    box(ctx, x, y, size, size, pal.panel, pal.line, Math.max(1, px(1)), px(3))
    pixelIcon(ctx, 'sleep', x + Math.round((size - 7 * px(1.5)) / 2), y + Math.round((size - 7 * px(1.5)) / 2), px(1.5), pal['text-2'])
    ctx.globalAlpha = 1
  }
}

/**
 * What is under a screen point: a "?" over someone's head, then people, then plaques, then the floor.
 * Inside a room, anything outside it is a way into the room it belongs to.
 */
export function hitTest(cam: Camera, office: Office, frame: Frame, sx: number, sy: number, room: Area | null = null): Hit | null {
  const inside = (b: Box) => sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h
  for (let i = frame.asks.length - 1; i >= 0; i--) {
    const b = frame.asks[i]
    if (inside(b)) return { kind: 'ask', sessionId: b.s.sessionId, label: b.s.label }
  }
  for (let i = frame.sprites.length - 1; i >= 0; i--) {
    const b = frame.sprites[i]
    if (inside(b)) return { kind: 'sprite', sessionId: b.s.sessionId, label: b.s.label, key: b.s.key }
  }
  for (let i = frame.plaques.length - 1; i >= 0; i--) if (inside(frame.plaques[i])) return frame.plaques[i].hit
  const w = cam.toWorld(sx, sy)
  if (room) {
    const within = (r: Rect) => w.x >= r.x && w.x < r.x + r.w && w.y >= r.y && w.y < r.y + r.h
    if (!within(roomShell(room))) {
      const other = rooms(office).find((a) => within(roomShell(a)))
      if (!other) return null
      return other.kind === 'hub' ? { kind: 'hub', label: 'Hub' } : { kind: 'pod', podId: other.id, label: other.name }
    }
  }
  return hitFloor(office, w.x, w.y)
}

export function hitFloor(office: Office, x: number, y: number): Hit | null {
  const within = (r: Rect, pad = 0) => x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad
  for (const f of office.facilities) if (within(f.rect)) return { kind: 'facility', key: f.key, label: f.label }
  for (const l of office.lounge) if (within(l.rect)) return { kind: 'hub', label: 'Hub', thing: l.thing, rect: l.rect }
  if (within(office.hub.rect)) return { kind: 'hub', label: 'Hub' }
  for (const p of office.pods) {
    if (within(p.plate)) return { kind: 'plaque', podId: p.id, label: p.name }
    if (!within(p.rect, 4)) continue
    if (within(p.boardRect)) return { kind: 'board', podId: p.id, label: `${p.name} usage` }
    const base = { kind: 'pod' as const, podId: p.id, label: p.name }
    if (within(p.cabinetRect)) return { ...base, thing: 'cabinet', rect: p.cabinetRect }
    for (const d of [...p.seniorDesks, ...p.juniorDesks]) {
      // A desk and the monitor that sticks up over its back edge.
      if (within({ x: d.x, y: d.y - 4, w: d.w, h: d.h + 4 })) return { ...base, thing: 'desk', rect: d }
    }
    return base
  }
  const b = office.boss
  if (within(b.rect, 4)) {
    const base = { kind: 'pod' as const, podId: b.id, label: b.name }
    return within(b.seniorDesks[0]) ? { ...base, thing: 'desk', rect: b.seniorDesks[0] } : base
  }
  return null
}

/** Is this world point at a way out: the entrance, or a doorway of any room? Used when you drop someone. */
export function doorAt(office: Office, x: number, y: number) {
  const e = office.entrance
  if (x >= e.x - 8 && x <= e.x + e.w + 8 && y >= e.y && y <= office.door.y + 12) return true
  for (const a of rooms(office)) {
    for (const d of a.doors) if (Math.abs(x - (d.x + d.w / 2)) <= 10 && y >= d.y - 6 && y <= d.y + d.h + 6) return true
  }
  return false
}

/** The world point to centre on to show an area. */
export function podCenter(p: Pod) {
  return { x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 }
}

// Draws what ./extras keeps track of: the weather, vans and the parcel stack
// outside; TVs, trophies, dust, whiteboard stats, parcels and test lamps in the
// rooms; and the clerk, couriers, contractors and the cat. render.ts calls
// these at the right points of a frame.

import type { Camera } from './camera'
import type { Office, Pod, Rect } from './office'
import { TILE } from './office'
import type { Sprite, WorldModel } from './model'
import type { Car } from './street'
import type { Preview } from '../lib/api'
import { iconCells, type IconName } from '../lib/pixelIcons'
import { roomAge, shelfRect, tvRect, type Extras, type Npc, type Van } from './extras'
import { dropsIn, gloom, lightning, rainOf } from './weather'
import type { Palette, Sheets } from './render'

// People rows in the urban sheet. The clerk and the courier are recoloured in
// render.ts (see RANKS): the clerk in postal blue, the courier all in brown.
// The contractor is the sheet's own worker in a hard hat.
export const COURIER = 24
export const CLERK = 27
const CONTRACTOR = 9
const FACE_COL = { left: 23, down: 24, up: 25, right: 26 } as const

const C = {
  outline: '#472d3c',
  card: '#c8955a',
  cardDark: '#9a6b3a',
  tape: '#e9d8a6',
  label: '#e47d95',
  screenOff: '#2b3a55',
  bezel: '#1b2330',
  live: '#ff5a4f',
  green: '#7fdc8c',
  red: '#ff5a4f',
  bronze: '#c08040',
  silver: '#c8ccd4',
  gold: '#f2c14e',
  web: 'rgba(235, 235, 240, 0.75)',
  dust: 'rgba(120, 110, 100, 0.55)',
  smoke: '#8a8790',
  foam: '#f7f3e6',
  extinguisher: '#d9544f',
  rain: 'rgba(175, 200, 240, 0.65)',
  toolbox: '#d9544f',
  wheel: '#2a2a2e',
  glass: '#3b4a75',
  glassHi: '#74a9dc',
  cat: '#e0954a',
  catDark: '#b0662e',
  catLight: '#f7f3e6',
  catEye: '#7fdc8c',
  ink: '#3b4a75',
}

const VAN_BODY = ['#4f86b9', '#c0566f', '#4f8a5b', '#b39433', '#8a5fa8']
const RAINBOW = ['#e05a5a', '#f0a050', '#f2d65a', '#7fd07f', '#5aa8e6', '#8a6fd0']

type Box = { x: number; y: number; w: number; h: number }
type Fill = (x: number, y: number, w: number, h: number, c: string) => void

function art(ctx: CanvasRenderingContext2D, cam: Camera): Fill {
  const o = cam.origin()
  const P = cam.P
  return (x, y, w, h, c) => {
    ctx.fillStyle = c
    ctx.fillRect(o.x + Math.round(x * P), o.y + Math.round(y * P), Math.ceil(w * P), Math.ceil(h * P))
  }
}

function icon(f: Fill, name: IconName, x: number, y: number, c: string) {
  for (const [cx, cy] of iconCells(name)) f(x + cx, y + cy, 1, 1, c)
}

/** Lettering at art size, only when it is big enough to read. */
function letter(ctx: CanvasRenderingContext2D, cam: Camera, text: string, x: number, y: number, sizeArt: number, color: string, maxW?: number) {
  if (Math.round(sizeArt * cam.P) < 7) return
  // Jersey 15 runs small for its size, so it is set a third larger.
  const size = Math.round(sizeArt * cam.P * 1.3)
  const s = cam.toScreen(x, y)
  ctx.font = `400 ${size}px 'Jersey 15', 'Inter Variable', system-ui, sans-serif`
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, Math.round(s.x), Math.round(s.y), maxW ? maxW * cam.P : undefined)
  ctx.textAlign = 'left'
}

function visible(cam: Camera, r: Rect) {
  const a = cam.toScreen(r.x, r.y)
  return a.x < cam.vw && a.y < cam.vh && a.x + r.w * cam.P > 0 && a.y + r.h * cam.P > 0
}

// ---- outside --------------------------------------------------------------------

/** Cars in the lane where a van has pulled up give way, so nothing drives through it. */
export function carHidden(extras: Extras | undefined, office: Office, car: Car) {
  if (!extras) return false
  const lane = extras.laneY(office)
  if (Math.abs(car.y - lane) > 6) return false
  return extras.vans.some((v) => Math.abs(car.x - v.x) < 52)
}

/** Weather, vans and the parcel stack: everything in the street. Drawn under the building. */
export function drawOutside(ctx: CanvasRenderingContext2D, cam: Camera, office: Office, extras: Extras, now: number) {
  const f = art(ctx, cam)
  const sky = extras.weather.sky
  const tl = cam.toWorld(0, 0)
  const br = cam.toWorld(cam.vw, cam.vh)
  const outside = tl.x < 0 || tl.y < 0 || br.x > office.w || br.y > office.h
  if (!outside) return

  if (extras.weather.rainbow(now)) drawRainbow(ctx, cam, office, extras.weather.rainbowUntil - now)

  for (const v of extras.vans) drawVan(ctx, cam, f, v)
  drawStack(f, extras.stack, extras.stackAt(office))

  const g = gloom(sky)
  if (g) {
    ctx.fillStyle = `rgba(30, 36, 56, ${g})`
    ctx.fillRect(0, 0, cam.vw, cam.vh)
  }
  const rain = rainOf(sky)
  if (rain) {
    const view = { x: tl.x, y: tl.y - 10, w: br.x - tl.x, h: br.y - tl.y + 10 }
    const spacing = Math.max(9, view.w / 140)
    const o = cam.origin()
    const thin = Math.max(1, Math.round(cam.P / 3))
    ctx.fillStyle = C.rain
    for (const d of dropsIn(view, now, rain, spacing)) {
      ctx.fillRect(o.x + Math.round(d.x * cam.P), o.y + Math.round(d.y * cam.P), thin, Math.ceil(d.len * cam.P))
    }
  }
  const flash = lightning(sky, now)
  if (flash) {
    ctx.fillStyle = `rgba(235, 240, 255, ${flash * 0.45})`
    ctx.fillRect(0, 0, cam.vw, cam.vh)
  }
}

function drawRainbow(ctx: CanvasRenderingContext2D, cam: Camera, office: Office, left: number) {
  // Fades in, then out over the last ten seconds.
  const alpha = Math.min(1, left / 10_000) * 0.45
  const c = cam.toScreen(office.w / 2, office.h * 0.85)
  const r0 = Math.max(office.w, office.h) * 0.75 * cam.P
  const band = Math.max(2, 5 * cam.P)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineWidth = band
  RAINBOW.forEach((col, i) => {
    ctx.strokeStyle = col
    ctx.beginPath()
    ctx.arc(c.x, c.y, r0 - i * band, Math.PI, 2 * Math.PI)
    ctx.stroke()
  })
  ctx.restore()
}

/** A van seen from the side, facing left, centred on (x, y). */
function drawVan(ctx: CanvasRenderingContext2D, cam: Camera, f: Fill, v: Van) {
  const x = Math.round(v.x - 18)
  const y = Math.round(v.y - 11)
  if (!visible(cam, { x, y, w: 36, h: 22 })) return
  const body = v.kind === 'delivery' ? C.tape : VAN_BODY[v.color % VAN_BODY.length]
  // The cab at the front (left), the box behind it.
  f(x + 1, y + 5, 10, 13, C.outline)
  f(x + 2, y + 6, 9, 11, body)
  f(x + 3, y + 7, 6, 4, C.glass)
  f(x + 4, y + 7, 2, 2, C.glassHi)
  f(x + 10, y, 26, 18, C.outline)
  f(x + 11, y + 1, 24, 16, body)
  if (v.kind === 'delivery') {
    f(x + 11, y + 10, 24, 3, C.cardDark) // a brown stripe
    icon(f, 'arrow', x + 26, y + 2, C.cardDark)
  } else f(x + 11, y + 14, 24, 1, 'rgba(0,0,0,0.25)')
  // Wheels, turning while it drives.
  for (const wx of [x + 6, x + 27]) {
    f(wx - 1, y + 16, 6, 6, C.outline)
    f(wx, y + 17, 4, 4, C.wheel)
    const spin = v.state === 'park' ? 0 : Math.floor(v.x / 3) % 2
    f(wx + 1 + spin, y + 18, 1, 1, '#9a9aa0')
  }
  const name = v.kind === 'delivery' ? 'HQ Post' : v.server ?? ''
  letter(ctx, cam, name.length > 12 ? `${name.slice(0, 11)}…` : name, x + 23, y + 6, 4.5, v.kind === 'delivery' ? C.outline : '#ffffff', 22)
}

/** Parcels stacked by the front door: commits waiting to be pushed. */
function drawStack(f: Fill, n: number, at: { x: number; y: number }) {
  for (let i = 0; i < n; i++) {
    const bx = at.x + (i % 2) * 8 - 7
    const by = at.y - 5 - Math.floor(i / 2) * 5
    drawBox(f, bx, by, 7, 5)
  }
}

function drawBox(f: Fill, x: number, y: number, w: number, h: number, label = false) {
  f(x, y, w, h, C.outline)
  f(x + 1, y + 1, w - 2, h - 2, C.card)
  f(x + Math.floor(w / 2), y + 1, 1, h - 2, C.tape)
  if (label) f(x + 1, y + h - 3, 2, 1, C.label)
}

// ---- the back windows -------------------------------------------------------------

/** Clouds, rain, lightning and the rainbow in the windows on the back wall; darker against a night sky. */
export function drawWindowWeather(ctx: CanvasRenderingContext2D, cam: Camera, office: Office, extras: Extras, now: number, night = false) {
  const f = art(ctx, cam)
  const sky = extras.weather.sky
  const flash = lightning(sky, now)
  const bow = extras.weather.rainbow(now)
  if (sky === 'clear' && !bow) return
  office.windows.forEach((w, i) => {
    if (!visible(cam, w)) return
    const ix = w.x + 1
    const iy = w.y + 1
    const iw = w.w - 2
    const ih = w.h - 3
    if (sky !== 'clear') {
      ctx.globalAlpha = gloom(sky) * 2.2
      f(ix, iy, iw, ih, night ? '#1c2238' : '#6a7286')
      ctx.globalAlpha = 1
      // A bank of cloud along the top.
      const drift = Math.floor(now / 1500 + i * 5) % 6
      for (let k = -1; k < iw / 6 + 1; k++) {
        const cx = ix + k * 6 + drift
        const a = Math.max(cx, ix)
        const b = Math.min(cx + 5, ix + iw)
        if (b > a) f(a, iy + (k % 2 ? 1 : 0), b - a, 2, night ? (sky === 'cloudy' ? '#4a5068' : '#363c52') : sky === 'cloudy' ? '#c8ccd6' : '#8a90a0')
      }
      if (rainOf(sky)) {
        for (let k = 0; k < iw; k += 3) {
          const y = iy + 3 + ((Math.floor(now / 90) + k * 7 + i * 3) % (ih - 3))
          f(ix + k, y, 1, 2, night ? '#7d8cb0' : '#c8d8f0')
        }
      }
      if (flash) {
        ctx.globalAlpha = flash
        f(ix, iy, iw, ih, '#f4f6ff')
        ctx.globalAlpha = 1
      }
    }
    if (bow) {
      ctx.globalAlpha = 0.6
      RAINBOW.forEach((c, k) => f(ix, iy + ih - 2 - k, iw, 1, c))
      ctx.globalAlpha = 1
    }
    // The window bars go back over the top.
    f(ix + Math.floor(iw / 2), iy, 1, ih, '#b49a6c')
    f(ix, iy + Math.floor(ih / 2), iw, 1, '#b49a6c')
  })
}

// ---- in the rooms -------------------------------------------------------------------

const shots = new Map<string, HTMLImageElement>()

/** A preview picture, loaded once per picture taken. Null until it has loaded. */
function shotImage(projectId: string, which: 'dev' | 'prod', shotAt: number | null) {
  if (!shotAt || typeof Image === 'undefined') return null
  const src = `/api/previews/${encodeURIComponent(projectId)}/${which}?t=${shotAt}`
  let img = shots.get(src)
  if (!img) {
    for (const k of shots.keys()) if (k.startsWith(`/api/previews/${encodeURIComponent(projectId)}/${which}?`)) shots.delete(k)
    img = new Image()
    img.src = src
    shots.set(src, img)
  }
  return img.complete && img.naturalWidth ? img : null
}

/** What the TV shows: the running dev server first, then the live site. */
export function tvShows(p: Preview | undefined) {
  if (p?.dev) return { which: 'dev' as const, shot: p.dev, live: true }
  if (p?.prod) return { which: 'prod' as const, shot: p.prod, live: false }
  return null
}

/**
 * Per room: the TV, the trophy shelf, dust, the whiteboard's change count,
 * parcels on desks and test lamps. Drawn over the furniture, under people.
 */
export function drawRoomExtras(
  ctx: CanvasRenderingContext2D, cam: Camera, office: Office, model: WorldModel, extras: Extras,
  previews: Map<string, Preview> | undefined, now: number, boardsInUse: Set<string>,
  onHit: (box: Box, hit: { kind: 'tv'; podId: string; label: string }) => void,
) {
  const f = art(ctx, cam)
  for (const pod of office.pods) {
    if (!visible(cam, { x: pod.rect.x - 4, y: pod.rect.y - 30, w: pod.rect.w + 8, h: pod.rect.h + 34 })) continue
    const info = extras.git.get(pod.id)
    const age = roomAge(info, now)
    if (age.dust) drawDust(f, pod, age.dust)
    drawShelf(f, pod, age.trophies)
    if (info && !boardsInUse.has(pod.id) && (info.files || info.added || info.removed)) drawBoardStats(ctx, cam, f, pod, info.added, info.removed, info.files)
    const tv = tvRect(pod)
    drawTv(ctx, cam, f, tv, pod.id, previews?.get(pod.id), now)
    const a = cam.toScreen(tv.x, tv.y)
    onHit({ x: a.x, y: a.y, w: tv.w * cam.P, h: tv.h * cam.P }, { kind: 'tv', podId: pod.id, label: `${pod.name} preview` })
  }
  for (const p of extras.parcels) drawBox(f, p.x, p.y, 6, 5, true)
  for (const [key, d] of extras.drama) {
    const s = model.sprites.get(key)
    const m = s && monitorOf(model, s)
    if (!m) continue
    const blink = d.kind !== 'fail' || Math.floor(now / 300) % 2 === 0
    const c = d.kind === 'fail' ? C.red : C.green
    ctx.globalAlpha = 0.35
    f(m.x - 2, m.y - 2, 5, 5, c)
    ctx.globalAlpha = 1
    f(m.x - 1, m.y - 1, 3, 3, C.outline)
    f(m.x, m.y, 1, 1, blink ? c : C.screenOff)
  }
}

/** The top corner of the desk monitor of someone at their desk, where the test lamp sits. */
function monitorOf(model: WorldModel, s: Sprite) {
  const pod = model.pod(s.zone)
  if (!pod || s.slot == null || !s.placed) return null
  const desk = s.rank === 'senior' ? pod.seniorDesks[s.slot] : pod.juniorDesks[s.slot]
  return s.rank === 'senior' ? { x: desk.x + TILE + 6, y: desk.y - 3 } : { x: desk.x + 14, y: desk.y - 2 }
}

function drawDust(f: Fill, pod: Pod, level: 1 | 2) {
  const { x, y, w, h } = pod.rect
  // Cobwebs in the corners: a fan of threads and a ring across them.
  const web = (cx: number, cy: number, dx: number) => {
    for (let i = 0; i < 7; i++) f(cx + dx * i, cy, 1, 1, C.web)
    for (let i = 0; i < 7; i++) f(cx, cy + i, 1, 1, C.web)
    for (let i = 0; i < 5; i++) f(cx + dx * i, cy + i, 1, 1, C.web)
    for (let i = 0; i < 4; i++) f(cx + dx * (4 - i), cy + i + 0, 1, 1, C.web)
  }
  web(x, y, 1)
  if (level === 2) web(x + w - 1, y, -1)
  // Dust on the floor, in the same places every time.
  for (let i = 0; i < (level === 2 ? 26 : 12); i++) {
    const dx = (i * 53 + (x >> 2)) % (w - 4)
    const dy = (i * 31 + (y >> 2)) % (h - 4)
    f(x + 2 + dx, y + 2 + dy, i % 3 === 0 ? 2 : 1, 1, C.dust)
  }
  if (level === 2) {
    // The lights are off in here.
    f(x, y, w, h, 'rgba(14, 16, 28, 0.28)')
  }
}

const TROPHY = [C.bronze, C.silver, C.gold]

function drawShelf(f: Fill, pod: Pod, n: number) {
  if (!n) return
  const s = shelfRect(pod)
  const base = s.y + s.h - 2
  f(s.x, base, s.w, 2, C.outline)
  f(s.x + 1, base, s.w - 2, 1, '#a88a62')
  for (let i = 0; i < n; i++) {
    const tx = s.x + 1 + i * 3
    const c = TROPHY[i]
    f(tx, base - 4, 3, 2, c) // the cup
    f(tx + 1, base - 2, 1, 1, c) // the stem
    f(tx, base - 1, 3, 1, C.outline) // the foot
  }
}

/** Lines changed and not committed yet, written up on the whiteboard as a green and a red bar. */
function drawBoardStats(ctx: CanvasRenderingContext2D, cam: Camera, f: Fill, pod: Pod, added: number, removed: number, files: number) {
  const b = pod.boardRect
  // Capped short of the "+N -M" label at b.x + 38, so a big diff's bar never runs into the text.
  const len = (n: number) => (n > 0 ? Math.min(20, 2 + Math.round(Math.log2(n + 1) * 2.6)) : 0)
  const x = b.x + 8
  if (added) f(x, b.y + 4, len(added), 2, '#4f8a5b')
  if (removed) f(x, b.y + 7, len(removed), 2, '#c0566f')
  // A dot per file touched, up to ten.
  for (let i = 0; i < Math.min(10, files); i++) f(x + i * 2, b.y + 10, 1, 1, C.ink)
  letter(ctx, cam, `+${added} -${removed}`, b.x + 38, b.y + 6, 3.5, C.ink, 16)
}

function drawTv(ctx: CanvasRenderingContext2D, cam: Camera, f: Fill, r: Rect, id: string, p: Preview | undefined, now: number) {
  if (!visible(cam, r)) return
  f(r.x, r.y, r.w, r.h, C.outline)
  f(r.x + 1, r.y + 1, r.w - 2, r.h - 2, C.bezel)
  const sx = r.x + 2
  const sy = r.y + 2
  const sw = r.w - 4
  const sh = r.h - 4
  const show = tvShows(p)
  const img = show ? shotImage(id, show.which, show.shot.shotAt) : null
  if (img) {
    const o = cam.origin()
    ctx.save()
    ctx.imageSmoothingEnabled = true
    // The top of the page: its header and first screen.
    const srcH = Math.min(img.naturalHeight, (img.naturalWidth * sh) / sw)
    ctx.drawImage(img, 0, 0, img.naturalWidth, srcH, o.x + Math.round(sx * cam.P), o.y + Math.round(sy * cam.P), Math.ceil(sw * cam.P), Math.ceil(sh * cam.P))
    ctx.restore()
  } else if (show) {
    // Running but no picture yet: a test pattern.
    const bars = ['#f2f2f2', '#f2d65a', '#5ac8e6', '#7fdc8c', '#e47d95', '#d9544f', '#4f86b9']
    bars.forEach((c, i) => f(sx + Math.floor((i * sw) / bars.length), sy, Math.ceil(sw / bars.length), sh, c))
  } else {
    f(sx, sy, sw, sh, C.screenOff)
  }
  // A red LIVE lamp while the dev server runs; a dim one on standby.
  const on = show?.live && Math.floor(now / 700) % 2 === 0
  f(r.x + r.w - 3, r.y + r.h - 2, 1, 1, on ? C.live : show ? C.green : '#5a5560')
}

// ---- above people ---------------------------------------------------------------------

/** Smoke from failing tests, the fire extinguisher after three in a row, sparkles when they pass again. */
export function drawDramaFx(ctx: CanvasRenderingContext2D, cam: Camera, model: WorldModel, extras: Extras, now: number) {
  const f = art(ctx, cam)
  for (const [key, d] of extras.drama) {
    const s = model.sprites.get(key)
    const m = s && monitorOf(model, s)
    if (!m || !s) continue
    const t = (now - d.since) / 1000
    if (d.kind === 'fail') {
      for (let i = 0; i < 5; i++) {
        const k = (t * 0.7 + i / 5) % 1
        ctx.globalAlpha = (1 - k) * 0.8
        const size = 2 + Math.round(k * 3)
        f(Math.round(m.x - 4 + Math.sin(k * 6 + i) * 2), Math.round(m.y - 2 - k * 14), size, size, C.smoke)
      }
      ctx.globalAlpha = 1
      if (d.streak >= 3 && t < 4) {
        // The extinguisher, held at the desk's edge, foam spraying over the screen.
        const ex = m.x - 16
        const ey = m.y + 2
        f(ex, ey, 3, 6, C.outline)
        f(ex + 1, ey + 1, 1, 4, C.extinguisher)
        f(ex + 1, ey - 1, 3, 1, C.outline)
        for (let i = 0; i < 14; i++) {
          const k = ((t * 1.6 + i / 14) % 1)
          ctx.globalAlpha = 1 - k
          f(Math.round(ex + 4 + k * 14), Math.round(ey - 1 + Math.sin(i * 2.3) * k * 5), 2, 2, C.foam)
        }
        ctx.globalAlpha = 1
      }
    } else if (t < 1.6) {
      const n = d.kind === 'fixed' ? 14 : 6
      ctx.globalAlpha = Math.max(0, 1 - t / 1.6)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const r = 3 + t * (d.kind === 'fixed' ? 16 : 9)
        f(Math.round(m.x + Math.cos(a) * r), Math.round(m.y + Math.sin(a) * r * 0.6), 1, 1, i % 2 ? C.green : '#ffffff')
      }
      ctx.globalAlpha = 1
    }
  }
}

// ---- visitors and the cat --------------------------------------------------------------

// The cat in pixels, facing right: k outline, o orange, d stripes, w white, g eyes.
const CAT_WALK = [
  ['........k..k', 'k.......oooo', '.k......ogog', '.oooododdooo', '.ooooooodoo.', '.owo....owo.', '.k.k....k.k.'],
  ['........k..k', 'k.......oooo', '.k......ogog', '.oooododdooo', '.ooooooodoo.', '..ow....wo..', '..k......k..'],
]
const CAT_NAP = ['.......k.k', '..oooooooo', '.oodooodoo', 'ooooooookk', 'wooooooooo', '.wwwwwwww.']
const CAT_COLOR: Record<string, string> = { k: C.outline, o: C.cat, d: C.catDark, w: C.catLight, g: C.catEye }

function drawBitmap(f: Fill, rows: string[], x: number, y: number, flip: boolean) {
  const w = Math.max(...rows.map((r) => r.length))
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const c = CAT_COLOR[row[rx]]
      if (c) f(x + (flip ? w - 1 - rx : rx), y + ry, 1, 1, c)
    }
  })
}

/** Where the cat was last heading sideways, so it does not flip when it walks up or down. */
let catLeft = false

export type Bubble = () => void

/**
 * The clerk, couriers, contractors and the cat. Returns speech bubbles to draw
 * last, over everything, and pushes the cat's hit box for clicks.
 */
export function drawNpcs(
  ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, pal: Palette, sheets: Sheets, extras: Extras, now: number,
  onHit: (box: Box, hit: { kind: 'cat'; label: string }) => void,
): Bubble[] {
  const f = art(ctx, cam)
  const o = cam.origin()
  const P = cam.P
  const bubbles: Bubble[] = []
  for (const n of extras.npcs) {
    const walking = n.path.length > 0
    const step = walking ? 1 + (Math.floor(now / 140 + n.seed) % 2) : 0
    const row = n.kind === 'clerk' ? CLERK : n.kind === 'courier' ? COURIER : CONTRACTOR
    const bx = o.x + Math.round(n.x - TILE / 2) * P
    const by = o.y + Math.round(n.y - TILE) * P
    if (bx > cam.vw || by > cam.vh || bx + TILE * P < 0 || by + TILE * P < 0) continue
    f(Math.round(n.x) - 4, Math.round(n.y) - 1, 8, 2, pal['w-shadow'])
    ctx.drawImage(sheets.urban, FACE_COL[n.facing] * TILE, (row + step) * TILE, TILE, TILE, bx, by, TILE * P, TILE * P)
    // What they carry, held in front.
    const hx = Math.round(n.x) - 3
    const hy = Math.round(n.y) - 9
    if (n.carry === 'box') drawBox(f, hx, hy, 7, 5)
    else if (n.carry === 'parcel') drawBox(f, hx + 1, hy + 1, 5, 4, true)
    else if (n.carry === 'tools') {
      f(hx + 4, hy + 2, 6, 4, C.outline)
      f(hx + 5, hy + 3, 4, 2, C.toolbox)
      f(hx + 6, hy + 1, 2, 1, C.outline)
    }
    if (n.say && n.say.until > now) bubbles.push(() => bubble(ctx, cam, dpr, pal, n, n.say!.text))
  }

  const c = extras.cat
  if (c) {
    if (c.facing === 'left') catLeft = true
    else if (c.facing === 'right') catLeft = false
    const napping = c.phase === 'nap'
    const rows = napping ? CAT_NAP : CAT_WALK[c.path.length ? Math.floor(now / 160) % 2 : 0]
    const w = rows[0].length
    const x = Math.round(c.x - w / 2)
    const y = Math.round(c.y - rows.length)
    if (!napping) f(x + 1, Math.round(c.y), w - 2, 1, pal['w-shadow'])
    // Breathing while asleep.
    const breathe = napping && Math.floor(now / 900) % 2 ? 1 : 0
    drawBitmap(f, rows, x, y + breathe, catLeft)
    if (napping && !c.say) {
      const t = (now / 1800) % 1
      ctx.globalAlpha = 1 - t
      icon(f, 'sleep', x + w - 2, Math.round(y - 7 - t * 4), pal['text-2'])
      ctx.globalAlpha = 1
    }
    if (c.say) {
      icon(f, 'heart', x + Math.floor(w / 2) - 3, y - 9 - Math.floor(((now / 200) % 2)), C.label)
      bubbles.push(() => bubble(ctx, cam, dpr, pal, c, c.say!.text, 10))
    }
    const a = cam.toScreen(x - 2, y - 3)
    onHit({ x: a.x, y: a.y, w: (w + 4) * P, h: (rows.length + 5) * P }, { kind: 'cat', label: 'Office cat' })
  }
  return bubbles
}

function bubble(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, pal: Palette, n: Npc, text: string, lift = 18) {
  const px = (v: number) => Math.round(v * dpr)
  ctx.font = `400 ${px(11)}px 'Inter Variable', system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  const pad = px(5)
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2
  const h = px(18)
  const head = cam.toScreen(n.x, n.y - lift)
  const x = Math.max(2, Math.min(cam.vw - w - 2, Math.round(head.x - w / 2)))
  const y = Math.max(2, Math.round(head.y - h - px(4)))
  const lw = Math.max(1, px(1.5))
  ctx.beginPath()
  ctx.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, px(4))
  ctx.fillStyle = pal.panel
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = pal.line
  ctx.stroke()
  ctx.fillStyle = pal.line
  ctx.fillRect(Math.round(head.x - px(3)), y + h - lw, px(6), px(5))
  ctx.fillStyle = pal['text-2']
  ctx.fillText(text, x + pad, y + h / 2)
  ctx.textBaseline = 'top'
}

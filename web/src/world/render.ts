import indoorUrl from '../assets/kenney/indoor.png'
import urbanUrl from '../assets/kenney/urban.png'
import type { Camera } from './camera'
import { TILE, WALL, type Facing, type FacilityKey, type Office, type Pod, type Rect, type Sheet } from './office'
import type { Emote, Sprite, WorldModel } from './model'
import { iconCells, type IconName } from '../lib/pixelIcons'

// Draws the office from Kenney's Roguelike Indoors and RPG Urban packs (CC0).
// The floor and furniture are drawn once at art size and scaled up by the
// camera; people, screens, the clock, labels and bubbles are drawn each frame.
// Labels and bubbles use the CSS tokens so they follow Day and Night.

export type Sheets = Record<Sheet, HTMLImageElement>
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
  sheetsPromise ??= Promise.all([load(indoorUrl), load(urbanUrl)]).then(([indoor, urban]) => ({ indoor, urban }))
  return sheetsPromise
}

const TOKENS = [
  'panel', 'panel-2', 'line', 'line-strong', 'text', 'text-2', 'text-3', 'accent', 'accent-bg', 'accent-text', 'turn', 'turn-bg', 'bad',
  'w-night', 'w-shadow', 'w-void',
  'zone-sage', 'zone-clay', 'zone-sky', 'zone-wheat', 'zone-plum', 'zone-fern', 'zone-rose', 'zone-stone',
] as const
export type Palette = Record<(typeof TOKENS)[number], string>

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const p = {} as Palette
  for (const t of TOKENS) p[t] = cs.getPropertyValue(`--${t}`).trim() || 'transparent'
  return p
}

function zoneColor(pal: Palette, key: string) {
  return pal[`zone-${key}` as keyof Palette] ?? pal['zone-stone']
}

function blit(ctx: CanvasRenderingContext2D, sheets: Sheets, sheet: Sheet, c: number, r: number, dx: number, dy: number, P: number) {
  const g = GAP[sheet]
  ctx.drawImage(sheets[sheet], c * (TILE + g), r * (TILE + g), TILE, TILE, dx, dy, TILE * P, TILE * P)
}

// Colours of the art itself (walls, screens, the clock), matched to the sheets.
const ART = {
  outline: '#472d3c',
  wall: '#dccaa0',
  wallTrim: '#b49a6c',
  screen: '#5ac8e6',
  screenOff: '#2b3a55',
  clockFace: '#f7f3e6',
}

// People in the urban sheet: each is three rows (standing, two steps) of four
// columns (left, down, up, right). Seniors wear shirts; juniors are casual.
export const SENIORS = [12, 6, 15]
export const JUNIORS = [0, 3]
const FACE_COL: Record<Facing, number> = { left: 23, down: 24, up: 25, right: 26 }

/** The floor and furniture, at one device pixel per art pixel. */
export function drawBackground(office: Office, pal: Palette, sheets: Sheets) {
  const cv = document.createElement('canvas')
  cv.width = office.w
  cv.height = office.h
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  for (let y = 0; y < office.h; y += TILE) for (let x = 0; x < office.w; x += TILE) blit(ctx, sheets, 'urban', 9, 1, x, y, 1)

  // The back wall, with windows.
  ctx.fillStyle = ART.wall
  ctx.fillRect(0, 0, office.w, WALL * TILE)
  ctx.fillStyle = ART.wallTrim
  ctx.fillRect(0, WALL * TILE - 3, office.w, 2)
  ctx.fillStyle = ART.outline
  ctx.fillRect(0, WALL * TILE - 1, office.w, 1)
  for (let x = TILE * 2; x + TILE * 2 < office.w; x += TILE * 6) {
    blit(ctx, sheets, 'urban', 13, 13, x, 4, 1)
    blit(ctx, sheets, 'urban', 13, 13, x + TILE, 4, 1)
  }
  blit(ctx, sheets, 'urban', 14, 10, office.door.x - 8, office.h - TILE, 1)

  // Carpet in each project's colour, so areas are easy to tell apart.
  for (const p of office.pods) {
    ctx.globalAlpha = 0.28
    ctx.fillStyle = zoneColor(pal, p.color)
    ctx.fillRect(p.rect.x - 4, p.rect.y - 4, p.rect.w + 8, p.rect.h + 8)
    ctx.globalAlpha = 0.8
    ctx.strokeStyle = zoneColor(pal, p.color)
    ctx.lineWidth = 2
    ctx.strokeRect(p.rect.x - 3, p.rect.y - 3, p.rect.w + 6, p.rect.h + 6)
    ctx.globalAlpha = 1
  }
  for (const pr of office.props) blit(ctx, sheets, pr.sheet, pr.c, pr.r, pr.x, pr.y, 1)
  for (const m of office.monitors) {
    ctx.fillStyle = ART.outline
    ctx.fillRect(m.x, m.y, 10, 8)
    ctx.fillRect(m.x + 4, m.y + 8, 2, 2)
    ctx.fillStyle = ART.screenOff
    ctx.fillRect(m.x + 1, m.y + 1, 8, 5)
  }
  // Night dims the room; people and lit screens stay bright.
  ctx.fillStyle = pal['w-night']
  ctx.fillRect(0, 0, cv.width, cv.height)
  return cv
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

const EMOTE_ICON: Record<Emote, IconName> = { think: 'dots', done: 'check', error: 'bang', ask: 'question', coffee: 'cup', music: 'note' }

function pixelIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, cell: number, color: string) {
  ctx.fillStyle = color
  const c = Math.max(1, Math.round(cell))
  for (const [cx, cy] of iconCells(name)) ctx.fillRect(x + cx * c, y + cy * c, c, c)
}

/** Something on the floor you can click. */
export type Hit =
  | { kind: 'sprite'; sessionId: string; label: string }
  | { kind: 'facility'; key: FacilityKey; label: string }
  | { kind: 'pod'; podId: string; label: string }
  | { kind: 'plaque'; podId: string; label: string }
  | { kind: 'board'; podId: string; label: string }

export type Box = { x: number; y: number; w: number; h: number }
export type Frame = { sprites: (Box & { s: Sprite })[]; plaques: (Box & { hit: Hit })[] }

export function sameHit(a: Hit | null, b: Hit | null) {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'sprite') return b.kind === 'sprite' && a.sessionId === b.sessionId
  if (a.kind === 'facility') return b.kind === 'facility' && a.key === b.key
  return 'podId' in b && a.podId === b.podId
}

const boardRect = (p: Pod): Rect => ({ x: p.rect.x, y: p.rect.y, w: TILE * 3, h: TILE })

/** The art rectangle a clickable thing covers, for hover outlines. */
export function hitRect(office: Office, hit: Hit): Rect | null {
  if (hit.kind === 'facility') return office.facilities.find((f) => f.key === hit.key)?.rect ?? null
  if (hit.kind === 'board') {
    const p = office.pods.find((x) => x.id === hit.podId)
    return p ? boardRect(p) : null
  }
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
  ui: { hover: Hit | null; clock: string[]; focus: string | null },
): Frame {
  const P = cam.P
  const o = cam.origin()
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = pal['w-void']
  ctx.fillRect(0, 0, cam.vw, cam.vh)
  ctx.drawImage(bg, o.x, o.y, bg.width * P, bg.height * P)

  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c
    ctx.fillRect(o.x + Math.round(x * P), o.y + Math.round(y * P), Math.ceil(w * P), Math.ceil(h * P))
  }
  const frame: Frame = { sprites: [], plaques: [] }
  const overlays: (() => void)[] = []
  const px = (n: number) => Math.round(n * dpr)
  const font = (size: number, weight = 400) => `${weight} ${px(size)}px 'Inter Variable', system-ui, sans-serif`
  const lw = Math.max(1, px(2))
  const statuses = new Map(office.pods.map((p) => [p.id, podStatus(model, p.id)]))

  // Screens light up while someone types at them.
  for (const s of model.sprites.values()) {
    if (s.path.length || s.activity !== 'work' || s.station !== 'desk' || s.slot == null) continue
    const pod = model.pod(s.zone)
    if (!pod) continue
    const desk = s.rank === 'senior' ? pod.seniorDesks[s.slot] : pod.juniorDesks[s.slot]
    const m = s.rank === 'senior' ? { x: desk.x + TILE - 5, y: desk.y - 3 } : { x: desk.x + 3, y: desk.y - 2 }
    const on = s.running || s.state === 'waiting'
    rect(m.x + 1, m.y + 1, 8, 5, on ? ART.screen : ART.screenOff)
    if (s.running) {
      const k = Math.floor(now / 180 + s.seed) % 4
      rect(m.x + 2, m.y + 2, 2 + k, 1, ART.outline)
      rect(m.x + 2, m.y + 4, 5 - k, 1, ART.outline)
    }
  }

  // The wall clock tells the real time.
  const clockF = office.facilities.find((f) => f.key === 'clock')
  if (clockF) {
    const cx = clockF.rect.x + 8
    const cy = clockF.rect.y + 7
    rect(cx - 5, cy - 5, 10, 10, ART.outline)
    rect(cx - 4, cy - 4, 8, 8, ART.clockFace)
    const d = new Date(now)
    const hand = (turns: number, len: number) => {
      const a = turns * Math.PI * 2 - Math.PI / 2
      for (let i = 1; i <= len; i++) rect(Math.round(cx + Math.cos(a) * i), Math.round(cy + Math.sin(a) * i), 1, 1, ART.outline)
    }
    hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12, 2)
    hand(d.getMinutes() / 60, 3)
  }

  // Waiting areas get a border in your-turn pink, the chosen one in accent.
  ctx.lineWidth = lw
  for (const p of office.pods) {
    const waiting = statuses.get(p.id)!.waiting > 0
    if (!waiting && ui.focus !== p.id) continue
    ctx.strokeStyle = waiting ? pal.turn : pal.accent
    ctx.strokeRect(o.x + (p.rect.x - 4) * P, o.y + (p.rect.y - 4) * P, (p.rect.w + 8) * P, (p.rect.h + 8) * P)
  }
  const hr = ui.hover && hitRect(office, ui.hover)
  if (hr) {
    ctx.strokeStyle = pal.accent
    ctx.strokeRect(o.x + hr.x * P - lw, o.y + hr.y * P - lw, hr.w * P + lw * 2, hr.h * P + lw * 2)
  }

  // People, back to front.
  const people = [...model.sprites.values()].filter((s) => s.placed).sort((a, b) => a.y - b.y)
  for (const s of people) {
    const walking = s.path.length > 0
    const step = walking ? 1 + (Math.floor(now / (s.rank === 'junior' ? 110 : 150)) % 2) : 0
    const typing = !walking && s.running && s.station === 'desk' && s.activity === 'work'
    const bob = typing && Math.floor(now / 220 + s.seed) % 2 ? 1 : 0
    const list = s.rank === 'senior' ? SENIORS : JUNIORS
    const base = list[s.seed % list.length]
    const ax = Math.round(s.x - TILE / 2)
    const ay = Math.round(s.y - TILE) - bob
    const bx = o.x + ax * P
    const by = o.y + ay * P
    if (bx > cam.vw || by > cam.vh || bx + TILE * P < 0 || by + TILE * P < 0) continue
    rect(ax + 4, Math.round(s.y) - 1, 8, 2, pal['w-shadow'])
    blit(ctx, sheets, 'urban', FACE_COL[s.facing], base + step, bx, by, P)
    frame.sprites.push({ x: bx, y: by, w: TILE * P, h: TILE * P, s })
    const cx = bx + (TILE * P) / 2
    overlays.push(() => drawOverlay(ctx, cam, dpr, pal, model, s, cx, by + 2 * P, now))
  }

  // Name plaques over each area and each office service.
  const plaque = (wx: number, wy: number, title: string, sub: string, subColor: string, swatch: string | null, hit: Hit) => {
    const sp = cam.toScreen(wx, wy)
    ctx.font = font(12, 600)
    const tw = ctx.measureText(title).width
    ctx.font = font(11, subColor === pal.turn ? 600 : 400)
    const sw = sub ? ctx.measureText(sub).width : 0
    const pad = px(7)
    const sq = swatch ? px(9) + px(6) : 0
    const w = Math.ceil(pad * 2 + sq + tw + (sub ? px(8) + sw : 0))
    const h = px(22)
    const x = Math.round(sp.x - w / 2)
    const y = Math.round(sp.y - h)
    if (x > cam.vw || y > cam.vh || x + w < 0 || y + h < 0) return
    box(ctx, x, y, w, h, pal.panel, sameHit(ui.hover, hit) ? pal.accent : pal['line-strong'], lw, px(4))
    if (swatch) {
      ctx.fillStyle = swatch
      ctx.fillRect(x + pad, y + Math.round((h - px(9)) / 2), px(9), px(9))
    }
    ctx.textBaseline = 'middle'
    ctx.font = font(12, 600)
    ctx.fillStyle = pal.text
    ctx.fillText(title, x + pad + sq, y + h / 2)
    if (sub) {
      ctx.font = font(11, subColor === pal.turn ? 600 : 400)
      ctx.fillStyle = subColor
      ctx.fillText(sub, x + pad + sq + tw + px(8), y + h / 2)
    }
    frame.plaques.push({ x, y, w, h, hit })
  }
  for (const p of office.pods) {
    const st = statuses.get(p.id)!
    const color = st.waiting ? pal.turn : st.working ? pal['accent-text'] : pal['text-3']
    plaque(p.rect.x + p.rect.w / 2, p.rect.y - 6, p.name, statusText(st), color, zoneColor(pal, p.color), { kind: 'plaque', podId: p.id, label: p.name })
  }
  for (const f of office.facilities) {
    const hit: Hit = { kind: 'facility', key: f.key, label: f.label }
    if (f.key === 'clock') plaque(f.rect.x + f.rect.w / 2, f.rect.y - 20, f.label, ui.clock.join('   '), pal['text-2'], null, hit)
    else if (f.key === 'archive') plaque(f.rect.x + f.rect.w / 2, f.rect.y - 2, f.label, '', pal['text-2'], null, hit)
    else if (f.key === 'reception') plaque(f.rect.x + f.rect.w / 2, f.rect.y - 2, f.label, '', pal['text-2'], null, hit)
    else plaque(f.rect.x + f.rect.w / 2, f.rect.y + f.rect.h + 22, f.label, '', pal['text-2'], null, hit)
  }

  for (const draw of overlays) draw()
  return frame
}

function drawOverlay(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, pal: Palette, model: WorldModel, s: Sprite, cx: number, top: number, now: number) {
  const lw = Math.max(1, Math.round(2 * dpr))
  const px = (n: number) => Math.round(n * dpr)
  const font = (size: number, w = 400) => `${w} ${px(size)}px 'Inter Variable', system-ui, sans-serif`
  ctx.textBaseline = 'top'

  // More helpers than desks: a small count beside the senior.
  const extra = s.rank === 'senior' ? model.hiddenCount(s.sessionId) : 0
  if (extra) {
    ctx.font = font(10, 700)
    const label = `+${extra}`
    const w = Math.ceil(ctx.measureText(label).width) + px(8)
    box(ctx, cx + px(10), top + px(6), w, px(15), pal['accent-bg'], pal.accent, Math.max(1, px(1)), px(3))
    ctx.fillStyle = pal['accent-text']
    ctx.fillText(label, cx + px(14), top + px(8))
  }

  if (s.state === 'waiting' && s.rank === 'senior') {
    const size = px(18)
    const jump = Math.floor(now / 350) % 2 ? px(2) : 0
    const x = Math.round(cx - size / 2)
    const y = top - size - px(4) - jump
    box(ctx, x, y, size, size, pal['turn-bg'], pal.turn, lw, 3 * dpr)
    ctx.font = font(13, 700)
    ctx.fillStyle = pal.turn
    ctx.textAlign = 'center'
    ctx.fillText('!', cx, y + px(2))
    ctx.textAlign = 'left'
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
    const fill = s.bubble.you ? pal['accent-bg'] : pal.panel
    const stroke = s.bubble.you ? pal.accent : pal['line-strong']
    box(ctx, x, y, w, h, fill, stroke, lw, 4 * dpr)
    ctx.fillStyle = stroke
    ctx.fillRect(Math.round(cx - tail / 2), y + h - lw, tail, tail)
    ctx.fillStyle = s.bubble.you ? pal['accent-text'] : pal.text
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * lineH))
    return
  }

  // Little reactions: thinking, done, a mistake, a question, coffee, humming.
  if (s.emote) {
    const icon = EMOTE_ICON[s.emote.kind]
    const color = s.emote.kind === 'error' ? pal.bad : s.emote.kind === 'done' ? pal['accent-text'] : pal['text-2']
    const size = px(18)
    const rise = Math.round(((now % 1200) / 1200) * px(2))
    const x = Math.round(cx - size / 2)
    const y = top - size - px(3) - rise
    box(ctx, x, y, size, size, pal.panel, s.emote.kind === 'error' ? pal.bad : pal.line, Math.max(1, px(1)), px(4))
    pixelIcon(ctx, icon, x + Math.round((size - 7 * px(1.5)) / 2), y + Math.round((size - 7 * px(1.5)) / 2), px(1.5), color)
    return
  }

  if (s.running && s.tool && !s.path.length) {
    ctx.font = font(11, 600)
    const label = s.tool.startsWith('mcp__') ? s.tool.split('__').pop()! : s.tool
    const pad = px(5)
    const w = Math.ceil(ctx.measureText(label).width) + pad * 2
    const h = px(17)
    const x = Math.max(2, Math.min(cam.vw - w - 2, Math.round(cx - w / 2)))
    const y = top - h - px(3)
    box(ctx, x, y, w, h, pal.panel, pal.line, Math.max(1, px(1)), 3 * dpr)
    ctx.fillStyle = pal['text-2']
    ctx.fillText(label, x + pad, y + px(3))
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

/** What is under a screen point: people first, then plaques, then the floor. */
export function hitTest(cam: Camera, office: Office, frame: Frame, sx: number, sy: number): Hit | null {
  const inside = (b: Box) => sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h
  for (let i = frame.sprites.length - 1; i >= 0; i--) {
    const b = frame.sprites[i]
    if (inside(b)) return { kind: 'sprite', sessionId: b.s.sessionId, label: b.s.label }
  }
  for (let i = frame.plaques.length - 1; i >= 0; i--) if (inside(frame.plaques[i])) return frame.plaques[i].hit
  const w = cam.toWorld(sx, sy)
  return hitFloor(office, w.x, w.y)
}

export function hitFloor(office: Office, x: number, y: number): Hit | null {
  const within = (r: Rect, pad = 0) => x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad
  for (const f of office.facilities) if (within(f.rect)) return { kind: 'facility', key: f.key, label: f.label }
  for (const p of office.pods) {
    if (!within(p.rect, 4)) continue
    if (within(boardRect(p))) return { kind: 'board', podId: p.id, label: `${p.name} usage` }
    return { kind: 'pod', podId: p.id, label: p.name }
  }
  return null
}

/** The world point to centre on to show an area. */
export function podCenter(p: Pod) {
  return { x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 }
}

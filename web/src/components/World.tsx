import { useEffect, useRef, type MutableRefObject } from 'react'
import type { Preview, Project } from '../lib/api'
import { keep, kept } from '../lib/keep'
import { Camera } from '../world/camera'
import { areaAt, buildOffice, neighbor, roomBounds, roomById, type Area, type Facing, type Office } from '../world/office'
import { OTHER, type Sprite, type WorldModel } from '../world/model'
import type { Extras } from '../world/extras'
import { doorAt, drawBackground, drawFrame, hitTest, loadSheets, readPalette, sameHit, type Frame, type FrameUi, type Hit, type Sheets } from '../world/render'

const FRAME_MS = 1000 / 30
const DRAG_PX = 5
// CSS px kept clear when framing a room: a little at the top, the prompt box at the bottom.
const HUD_TOP = 16
const HUD_BOTTOM = 120
// Art px from the pointer down to the feet of the person you carry: you hold them by the shoulders.
const CARRY_FEET = 12

export type WorldControl = {
  /** The room a session's senior is standing in right now. */
  roomOf: (sessionId: string) => string | null
  /** Where a session's "?" is on the page (or the top of their head), or null when they are off screen. */
  headOf: (sessionId: string) => { x: number; y: number } | null
  zoom: (dir: 1 | -1) => void
}

/** Someone you dropped at a door, waiting for you to confirm they go home. */
export type DoorDrop = { key: string; sessionId: string; label: string; x: number; y: number }

export function World({
  model,
  extras,
  previews,
  projects,
  focus,
  room,
  selected,
  limits,
  connected,
  loading,
  onHit,
  onRoom,
  onDoorDrop,
  control,
}: {
  model: WorldModel
  /** Visitors, parcels, the cat and the weather. */
  extras: Extras
  previews: Map<string, Preview>
  projects: Project[]
  focus: string | null
  /** The room you are in, or null to see the whole floor. */
  room: string | null
  /** The session you clicked on. */
  selected: string | null
  limits: FrameUi['limits']
  connected: boolean
  loading: number | null
  onHit: (h: Hit) => void
  onRoom: (id: string | null) => void
  /** You dropped someone at a door. They wait there until you confirm or cancel. */
  onDoorDrop: (d: DoorDrop) => void
  control: MutableRefObject<WorldControl | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The loop reads the latest props through a ref, so it never restarts.
  const props = useRef({ projects, focus, room, selected, limits, connected, loading, previews, onHit, onRoom, onDoorDrop })
  props.current = { projects, focus, room, selected, limits, connected, loading, previews, onHit, onRoom, onDoorDrop }

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    // Frames are drawn off screen and only shown once they finish, so a frame
    // that throws (say, mid-edit in dev) leaves the last good one up.
    const buf = document.createElement('canvas')
    const bctx = buf.getContext('2d')!
    let broken = false
    const cam = new Camera()
    // Where you were looking before a reload or a hot update, if anywhere.
    const saved = kept<{ x: number; y: number; P: number }>('view')
    let restoring = false
    let dpr = window.devicePixelRatio || 1
    let sheets: Sheets | null = null
    let pal = readPalette()
    let office: Office | null = null
    let officeKey = ''
    let bg: HTMLCanvasElement | null = null
    let bgStale = true
    let frame: Frame = { sprites: [], plaques: [], asks: [] }
    let hover: Hit | null = null
    let carrying: Sprite | null = null
    let raf = 0
    let last = performance.now()
    let lastDraw = 0
    let placed = false
    // The room the camera is framing, the office it was framed in, and the zoom that fits it.
    let inRoom: Area | null = null
    let roomKey = ''
    let roomP = 0

    /** Frames the chosen room, or zooms back out to the floor when you step out. */
    const applyRoom = () => {
      const id = props.current.room
      const key = `${id}|${officeKey}`
      if (!office || key === roomKey) return
      const was = inRoom
      // Back from a reload you are already standing where you were, so no flight.
      const quiet = restoring
      restoring = false
      roomKey = key
      inRoom = id ? roomById(office, id) : null
      if (!inRoom) {
        cam.setBounds(null)
        if (was && !quiet) cam.flyTo(cam.x, cam.y, Math.min(cam.P, Math.round(2 * dpr)))
        return
      }
      const b = roomBounds(inRoom)
      const top = HUD_TOP * dpr
      const bottom = HUD_BOTTOM * dpr
      const P = cam.fitP(b.w, b.h, top + bottom, 24 * dpr)
      roomP = P
      cam.setBounds(b)
      if (quiet) return
      cam.flyTo(b.x + b.w / 2, b.y + b.h / 2 + (bottom - top) / 2 / P, P)
    }

    loadSheets().then((s) => {
      sheets = s
      bgStale = true
    })

    const podInfos = () => [
      ...props.current.projects.filter((p) => p.enabled).map((p) => ({ id: p.id, name: p.name })),
      { id: OTHER, name: 'Other folders' },
    ]

    const ensureOffice = () => {
      const infos = podInfos()
      const key = infos.map((p) => `${p.id}:${p.name}`).join('|')
      if (key !== officeKey) {
        officeKey = key
        office = buildOffice(infos)
        model.setOffice(office)
        cam.setWorld(office.w, office.h)
        bgStale = true
        if (!placed && props.current.projects.length) {
          // Pick up where you were, or start at the hub in the middle of the floor.
          placed = true
          restoring = !!saved
          cam.P = Math.max(cam.pMin, Math.min(cam.pMax, saved?.P ?? Math.round(2 * dpr)))
          cam.x = saved?.x ?? office.hub.rect.x + office.hub.rect.w / 2
          cam.y = saved?.y ?? office.hub.rect.y + office.hub.rect.h / 2
          cam.clamp()
        }
      }
      if (bgStale && office && sheets) {
        bg = drawBackground(office, sheets)
        bgStale = false
      }
      applyRoom()
    }

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      // Checked apart: a remount (StrictMode, hot update) brings a fresh 300x150
      // buffer while the canvas already has the right size.
      for (const c of [canvas, buf]) {
        if (c.width !== w || c.height !== h) {
          c.width = w
          c.height = h
        }
      }
      cam.setViewport(w, h, dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (t - last) / 1000)
      last = t
      try {
        model.tick(dt)
        extras.tick(dt, model)
        extras.weather.update(props.current.limits.fiveHour, Date.now())
        cam.step(dt)
        if (t - lastDraw < FRAME_MS) return
        lastDraw = t
        ensureOffice()
        if (office && bg && sheets) {
          const p = props.current
          frame = drawFrame(bctx, cam, dpr, office, pal, model, bg, sheets, Date.now(), {
            hover, focus: p.focus, room: inRoom, selected: p.selected, carrying: carrying?.key ?? null,
            limits: p.limits, connected: p.connected, loading: p.loading, extras, previews: p.previews,
          })
          ctx.drawImage(buf, 0, 0)
          if (broken) console.info('[HQ] The office is drawing again.')
          broken = false
        }
      } catch (e) {
        // Keep the last good frame up and try again next frame. Log it once.
        if (!broken) console.error('[HQ] A frame failed; showing the last good one until it draws again:', e)
        broken = true
        ;(bctx as CanvasRenderingContext2D & { reset?: () => void }).reset?.()
      }
    }
    raf = requestAnimationFrame(loop)
    // Lets browser tests find things on the floor. Dev builds only.
    if (import.meta.env.DEV) (window as unknown as { __hqWorld: unknown }).__hqWorld = { cam, model, extras, office: () => office, dpr: () => dpr }

    control.current = {
      roomOf: (id) => {
        const s = model.sprites.get(id)
        if (!s?.placed || !office) return null
        return areaAt(office, s)?.id ?? s.zone
      },
      headOf: (id) => {
        const b = frame.asks.find((a) => a.s.sessionId === id) ?? frame.sprites.find((a) => a.s.sessionId === id && a.s.rank === 'senior')
        if (!b) return null
        const r = canvas.getBoundingClientRect()
        return { x: r.left + (b.x + b.w / 2) / dpr, y: r.top + b.y / dpr }
      },
      zoom: (dir) => {
        cam.zoomAt(cam.vw / 2, cam.vh / 2, dir)
      },
    }

    // Pointer: dragging a session's person carries them, dragging anything else
    // pans, a short press clicks, and hovering outlines what you can click.
    let down: { x: number; y: number; id: number; grab: string | null } | null = null
    let dragging = false
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }
    }
    const setHover = (h: Hit | null) => {
      if (!sameHit(h, hover)) hover = h
      canvas.style.cursor = carrying || dragging ? 'grabbing' : h ? (h.kind === 'sprite' ? 'grab' : 'pointer') : 'default'
    }
    const onDown = (e: PointerEvent) => {
      const p = local(e)
      const h = office ? hitTest(cam, office, frame, p.x, p.y, inRoom) : null
      down = { x: e.clientX, y: e.clientY, id: e.pointerId, grab: h?.kind === 'sprite' ? h.key ?? h.sessionId : null }
      dragging = false
      canvas.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      const p = local(e)
      if (down && e.pointerId === down.id) {
        if (!dragging && !carrying && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) {
          // A senior can be picked up; anyone else, or the floor, pans the view.
          carrying = down.grab ? model.grab(down.grab) : null
          if (!carrying) dragging = true
          cam.stop()
          setHover(null)
        }
        if (carrying) {
          const w = cam.toWorld(p.x, p.y)
          model.carry(carrying, w.x, w.y + CARRY_FEET)
          return
        }
        if (dragging) {
          cam.panBy(e.movementX * dpr, e.movementY * dpr)
          return
        }
      }
      if (office && e.pointerType === 'mouse') setHover(hitTest(cam, office, frame, p.x, p.y, inRoom))
    }
    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return
      const wasDrag = dragging
      const held = carrying
      down = null
      dragging = false
      carrying = null
      canvas.style.cursor = 'default'
      const p = local(e)
      if (held && office) {
        const w = cam.toWorld(p.x, p.y)
        if (e.type === 'pointerup' && doorAt(office, w.x, w.y)) {
          props.current.onDoorDrop({ key: held.key, sessionId: held.sessionId, label: held.label, x: e.clientX, y: e.clientY })
        } else model.putDown(held)
        return
      }
      if (wasDrag || !office) return
      const h = hitTest(cam, office, frame, p.x, p.y, inRoom)
      if (h) props.current.onHit(h)
      // In a room, clicking the empty floor outside it steps back out.
      else if (inRoom) props.current.onRoom(null)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      // Zooming out past the room's own framing steps out to the floor.
      if (e.deltaY > 0 && inRoom && cam.P <= roomP) {
        props.current.onRoom(null)
        return
      }
      cam.zoomAt(p.x, p.y, e.deltaY < 0 ? 1 : -1)
    }
    const onKey = (e: KeyboardEvent) => {
      // In a room, the arrow keys walk to the room next door.
      const dirs: Record<string, Facing> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
      if (inRoom && office && dirs[e.key]) {
        e.preventDefault()
        const next = neighbor(office, inRoom.id, dirs[e.key])
        if (next) props.current.onRoom(next.id)
        return
      }
      const step = 48 * dpr
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [step, 0], a: [step, 0], ArrowRight: [-step, 0], d: [-step, 0],
        ArrowUp: [0, step], w: [0, step], ArrowDown: [0, -step], s: [0, -step],
      }
      if (moves[e.key]) {
        e.preventDefault()
        cam.panBy(...moves[e.key])
      } else if (e.key === '+' || e.key === '=') cam.zoomAt(cam.vw / 2, cam.vh / 2, 1)
      else if (e.key === '-') cam.zoomAt(cam.vw / 2, cam.vh / 2, -1)
    }
    const onLeave = () => {
      if (!carrying) setHover(null)
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('keydown', onKey)

    // Theme changes: re-read the tokens and repaint the room.
    const retheme = () => {
      pal = readPalette()
      bgStale = true
    }
    const mo = new MutationObserver(retheme)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', retheme)

    const saveView = () => placed && keep('view', cam.resting)
    window.addEventListener('pagehide', saveView)

    return () => {
      saveView()
      window.removeEventListener('pagehide', saveView)
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      mq.removeEventListener('change', retheme)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKey)
      if (carrying) model.putDown(carrying)
      control.current = null
    }
  }, [model, extras, control])

  return (
    <canvas
      ref={canvasRef}
      className="world-canvas"
      tabIndex={0}
      role="application"
      aria-label="Your projects as an office floor, one room per project. Click a room to go in and prompt that project. Click the question mark over someone's head to answer what they are asking. Click a person to read their conversation, or drag them to a door to end their session. In a room, the arrow keys go to the room next door and Escape steps out. Drag to move, scroll or plus and minus to zoom."
    />
  )
}

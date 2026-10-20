import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Project } from '../lib/api'
import { Camera } from '../world/camera'
import { buildOffice, type Office } from '../world/office'
import { OTHER, type WorldModel } from '../world/model'
import { drawBackground, drawFrame, hitTest, loadSheets, podCenter, readPalette, sameHit, type Frame, type Hit, type Sheets } from '../world/render'

const FRAME_MS = 1000 / 30
const DRAG_PX = 5

export type WorldControl = {
  flyToPod: (id: string) => void
  flyToSession: (id: string) => boolean
  home: () => void
  zoom: (dir: 1 | -1) => void
}

const OPENS: Record<string, string> = { reception: 'projects', accounts: 'usage', clock: 'plan limits', archive: 'action log' }

export function describeHit(h: Hit) {
  switch (h.kind) {
    case 'sprite':
      return `${h.label}: open session`
    case 'facility':
      return `${h.label}: ${OPENS[h.key]}`
    case 'plaque':
      return `${h.label}: settings`
    case 'board':
      return h.label
    case 'pod':
      return `${h.label}: prompt here`
  }
}

export function World({
  model,
  projects,
  clock,
  focus,
  onHit,
  control,
}: {
  model: WorldModel
  projects: Project[]
  clock: string[]
  focus: string | null
  onHit: (h: Hit) => void
  control: MutableRefObject<WorldControl | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  // The loop reads the latest props through a ref, so it never restarts.
  const props = useRef({ projects, clock, focus, onHit })
  props.current = { projects, clock, focus, onHit }

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const cam = new Camera()
    let dpr = window.devicePixelRatio || 1
    let sheets: Sheets | null = null
    let pal = readPalette()
    let office: Office | null = null
    let officeKey = ''
    let bg: HTMLCanvasElement | null = null
    let bgStale = true
    let frame: Frame = { sprites: [], plaques: [] }
    let hover: Hit | null = null
    let raf = 0
    let last = performance.now()
    let lastDraw = 0
    let placed = false

    loadSheets().then((s) => {
      sheets = s
      bgStale = true
    })

    const podInfos = () => [
      ...props.current.projects.filter((p) => p.enabled).map((p) => ({ id: p.id, name: p.name, color: p.color })),
      { id: OTHER, name: 'Other folders', color: 'stone' },
    ]

    const ensureOffice = () => {
      const infos = podInfos()
      const key = infos.map((p) => `${p.id}:${p.name}:${p.color}`).join('|')
      if (key !== officeKey) {
        officeKey = key
        office = buildOffice(infos)
        model.setOffice(office)
        cam.setWorld(office.w, office.h)
        bgStale = true
        if (!placed && props.current.projects.length) {
          // Start at the hub in the middle of the floor.
          placed = true
          cam.P = Math.max(cam.pMin, Math.min(cam.pMax, Math.round(2 * dpr)))
          cam.x = office.hub.rect.x + office.hub.rect.w / 2
          cam.y = office.hub.rect.y + office.hub.rect.h / 2
          cam.clamp()
        }
      }
      if (bgStale && office && sheets) {
        bg = drawBackground(office, pal, sheets)
        bgStale = false
      }
    }

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
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
      model.tick(dt)
      cam.step(dt)
      if (t - lastDraw < FRAME_MS) return
      lastDraw = t
      ensureOffice()
      if (office && bg && sheets) {
        frame = drawFrame(ctx, cam, dpr, office, pal, model, bg, sheets, Date.now(), { hover, clock: props.current.clock, focus: props.current.focus })
      }
    }
    raf = requestAnimationFrame(loop)
    // Lets browser tests find things on the floor. Dev builds only.
    if (import.meta.env.DEV) (window as unknown as { __hqWorld: unknown }).__hqWorld = { cam, model, office: () => office, dpr: () => dpr }

    control.current = {
      flyToPod: (id) => {
        ensureOffice()
        const p = office?.pods.find((x) => x.id === id)
        if (!p) return
        const c = podCenter(p)
        cam.flyTo(c.x, c.y, Math.max(cam.P, Math.round(3 * dpr)))
      },
      flyToSession: (id) => {
        const s = model.sprites.get(id)
        if (!s?.placed) return false
        cam.flyTo(s.x, s.y, Math.max(cam.P, Math.round(3 * dpr)))
        return true
      },
      home: () => {
        if (office) cam.flyTo(office.hub.rect.x + office.hub.rect.w / 2, office.hub.rect.y + office.hub.rect.h / 2, Math.round(2 * dpr))
      },
      zoom: (dir) => {
        cam.zoomAt(cam.vw / 2, cam.vh / 2, dir)
      },
    }

    // Pointer: drag pans, a short press clicks, hovering shows what a thing does.
    let down: { x: number; y: number; id: number } | null = null
    let dragging = false
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr, cx: e.clientX - r.left, cy: e.clientY - r.top }
    }
    const setHover = (h: Hit | null, cx = 0, cy = 0) => {
      if (!sameHit(h, hover)) hover = h
      canvas.style.cursor = dragging ? 'grabbing' : h ? 'pointer' : 'grab'
      setTip(h ? { text: describeHit(h), x: cx, y: cy } : null)
    }
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, id: e.pointerId }
      dragging = false
      canvas.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      const p = local(e)
      if (down && e.pointerId === down.id) {
        if (!dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) {
          dragging = true
          cam.stop()
          setHover(null)
        }
        if (dragging) {
          cam.panBy(e.movementX * dpr, e.movementY * dpr)
          return
        }
      }
      if (office && e.pointerType === 'mouse') setHover(hitTest(cam, office, frame, p.x, p.y), p.cx, p.cy)
    }
    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return
      const wasDrag = dragging
      down = null
      dragging = false
      canvas.style.cursor = 'grab'
      if (wasDrag || !office) return
      const p = local(e)
      const h = hitTest(cam, office, frame, p.x, p.y)
      if (h) props.current.onHit(h)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      cam.zoomAt(p.x, p.y, e.deltaY < 0 ? 1 : -1)
    }
    const onKey = (e: KeyboardEvent) => {
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
    const onLeave = () => setHover(null)
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

    return () => {
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
      control.current = null
    }
  }, [model, control])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="world-canvas"
        tabIndex={0}
        role="application"
        aria-label="Your projects as an office floor. Drag or use the arrow keys to move, scroll or plus and minus to zoom. Click an area to prompt that project."
      />
      {tip && (
        <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 16 }} role="tooltip">
          {tip.text}
        </div>
      )}
    </>
  )
}

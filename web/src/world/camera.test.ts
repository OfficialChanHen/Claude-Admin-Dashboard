import { describe, expect, it } from 'vitest'
import { Camera } from './camera'

function cam(vw = 1000, vh = 600, worldW = 2000, worldH = 1200, dpr = 1) {
  const c = new Camera()
  c.setWorld(worldW, worldH)
  c.setViewport(vw, vh, dpr)
  c.x = worldW / 2
  c.y = worldH / 2
  c.clamp()
  return c
}

describe('Camera', () => {
  it('maps world to screen and back', () => {
    const c = cam()
    c.P = 3
    c.x = 700
    c.y = 500
    const s = c.toScreen(812, 433)
    const w = c.toWorld(s.x, s.y)
    expect(w.x).toBeCloseTo(812)
    expect(w.y).toBeCloseTo(433)
  })

  it('puts the camera point at the middle of the screen', () => {
    const c = cam()
    c.P = 2
    const s = c.toScreen(c.x, c.y)
    expect(s.x).toBeCloseTo(500, 0)
    expect(s.y).toBeCloseTo(300, 0)
  })

  it('lands tiles on whole pixels', () => {
    const c = cam()
    c.P = 3
    c.x = 700.37
    c.y = 400.81
    const o = c.origin()
    expect(Number.isInteger(o.x)).toBe(true)
    expect(Number.isInteger(o.y)).toBe(true)
  })

  it('keeps the point under the cursor still when zooming', () => {
    const c = cam()
    c.P = 2
    const before = c.toWorld(620, 410)
    expect(c.zoomAt(620, 410, 1)).toBe(true)
    const after = c.toWorld(620, 410)
    expect(after.x).toBeCloseTo(before.x, 0)
    expect(after.y).toBeCloseTo(before.y, 0)
  })

  it('stops zooming at the limits', () => {
    const c = cam()
    c.P = c.pMax
    expect(c.zoomAt(500, 300, 1)).toBe(false)
    c.P = c.pMin
    expect(c.zoomAt(500, 300, -1)).toBe(false)
  })

  it('zooms out far enough to show the whole world', () => {
    const c = cam(1000, 600, 300, 200)
    expect(c.pMin).toBe(3) // 600 / 200; at 4 the bottom would be cut off
    const big = cam(1000, 600, 2000, 1200)
    expect(big.pMin).toBe(1)
    const tiny = cam(1000, 600, 50, 50, 1)
    expect(tiny.pMax).toBe(tiny.pMin)
    tiny.P = tiny.pMin
    tiny.clamp()
    expect(tiny.toScreen(0, 0).x).toBeGreaterThanOrEqual(0)
    expect(tiny.toScreen(0, 0).y).toBeGreaterThanOrEqual(0)
    expect(tiny.toScreen(50, 50).x).toBeLessThanOrEqual(1000)
    expect(tiny.toScreen(50, 50).y).toBeLessThanOrEqual(600)
  })

  it('centres a world smaller than the screen', () => {
    const c = cam(1000, 600, 300, 200)
    c.P = 1
    c.panBy(400, 400)
    expect(c.x).toBe(150)
    expect(c.y).toBe(100)
  })

  it('stops panning at the edge of the world', () => {
    const c = cam()
    c.P = 2
    c.panBy(100_000, 100_000)
    expect(c.toScreen(0, 0).x).toBeLessThanOrEqual(0)
    expect(c.toScreen(0, 0).y).toBeLessThanOrEqual(0)
    c.panBy(-100_000, -100_000)
    expect(c.toScreen(2000, 1200).x).toBeGreaterThanOrEqual(1000)
    expect(c.toScreen(2000, 1200).y).toBeGreaterThanOrEqual(600)
  })

  it('flies to a point and then stops', () => {
    const c = cam()
    c.P = 2
    c.flyTo(700, 500, 3)
    let steps = 0
    while (c.step(1 / 30) && steps < 300) steps++
    expect(c.flying).toBe(false)
    expect(c.x).toBeCloseTo(700)
    expect(c.y).toBeCloseTo(500)
    expect(c.P).toBe(3)
    expect(steps).toBeLessThan(120)
  })

  it('stops a flight at the edge instead of hanging there', () => {
    const c = cam()
    c.P = 2
    c.flyTo(0, 0)
    let steps = 0
    while (c.step(1 / 30) && steps < 300) steps++
    expect(c.flying).toBe(false)
    expect(steps).toBeLessThan(300)
  })

  it('lets a drag cancel a flight', () => {
    const c = cam()
    c.flyTo(700, 500)
    c.panBy(10, 0)
    expect(c.flying).toBe(false)
  })
})

describe('Camera in a room', () => {
  const room = { x: 600, y: 400, w: 176, h: 160 }
  const shows = (c: Camera, r: typeof room) => {
    const a = c.toScreen(r.x, r.y)
    const b = c.toScreen(r.x + r.w, r.y + r.h)
    return a.x >= -1 && a.y >= -1 && b.x <= c.vw + 1 && b.y <= c.vh + 1
  }

  it('keeps the whole room in view however far you drag', () => {
    const c = cam()
    c.P = 3
    c.setBounds(room)
    c.x = room.x + room.w / 2
    c.y = room.y + room.h / 2
    c.panBy(5000, -5000)
    expect(shows(c, room)).toBe(true)
    c.panBy(-9000, 9000)
    expect(shows(c, room)).toBe(true)
  })

  it('stays inside a room bigger than the screen', () => {
    const c = cam()
    c.P = 8
    c.setBounds(room)
    c.panBy(-100_000, -100_000)
    expect(c.toWorld(c.vw, c.vh).x).toBeLessThanOrEqual(room.x + room.w + 0.01)
    expect(c.toWorld(c.vw, c.vh).y).toBeLessThanOrEqual(room.y + room.h + 0.01)
    c.panBy(100_000, 100_000)
    expect(c.toWorld(0, 0).x).toBeGreaterThanOrEqual(room.x - 0.01)
    expect(c.toWorld(0, 0).y).toBeGreaterThanOrEqual(room.y - 0.01)
  })

  it('flies there smoothly from far away, then holds', () => {
    const c = cam()
    c.P = 2
    c.x = 100
    c.y = 100
    c.setBounds(room)
    c.x = 100 // setBounds clamps at once; start the flight from far away again
    c.y = 100
    c.flyTo(room.x + room.w / 2, room.y + room.h / 2, c.fitP(room.w, room.h))
    c.step(1 / 30)
    // One frame in, it has moved toward the room but not jumped into it.
    expect(c.x).toBeGreaterThan(100)
    expect(c.x).toBeLessThan(room.x)
    let steps = 0
    while (c.step(1 / 30) && steps < 300) steps++
    expect(c.flying).toBe(false)
    expect(shows(c, room)).toBe(true)
  })

  it('zooms to fit the room, leaving space for the HUD', () => {
    const c = cam()
    expect(c.fitP(176, 160)).toBe(3) // 600 / 160
    expect(c.fitP(176, 160, 200)).toBe(2) // 400 / 160
    expect(c.fitP(10, 10)).toBe(c.pMax)
  })

  it('lets go of the room when you step out', () => {
    const c = cam()
    c.P = 3
    c.setBounds(room)
    c.setBounds(null)
    c.panBy(100_000, 0)
    expect(c.toScreen(0, 0).x).toBeLessThanOrEqual(0)
    expect(c.x).toBeLessThan(room.x)
  })
})

describe('Camera following someone', () => {
  it('puts them in the middle of the part of the screen left uncovered', () => {
    const c = cam()
    c.P = 4
    const at = c.centreOn(800, 500, 4, 400, 100)
    c.x = at.x
    c.y = at.y
    const s = c.toScreen(800, 500)
    expect(s.x).toBe((400 + 1000) / 2)
    expect(s.y).toBe((100 + 600) / 2)
  })

  it('chases someone who keeps walking, flying to them every frame', () => {
    const c = cam()
    c.flyTo(1000, 600, 4)
    c.step(1 / 30)
    let x = 1000
    for (let i = 0; i < 120; i++) {
      x += 1
      c.flyTo(x, 600)
      c.step(1 / 30)
    }
    expect(c.P).toBe(4)
    expect(Math.abs(c.x - x)).toBeLessThan(5)
  })

  it('leaves room for a window on the right too', () => {
    const c = cam()
    c.P = 4
    const at = c.centreOn(800, 500, 4, 400, 0, 300)
    c.x = at.x
    c.y = at.y
    expect(c.toScreen(800, 500).x).toBe((400 + 700) / 2)
  })

  it('centres someone at the corner of the world while free, and not otherwise', () => {
    const c = cam()
    c.P = 4
    c.x = 10
    c.y = 10
    c.clamp()
    expect(c.toScreen(10, 10).x).not.toBe(500)
    c.free = true
    c.x = 10
    c.y = 10
    c.clamp()
    expect(c.toScreen(10, 10)).toEqual({ x: 500, y: 300 })
  })

  it('finds the nearest centre that keeps the world on screen', () => {
    const c = cam()
    expect(c.inWorld(-50, 5000, 2)).toEqual({ x: 250, y: 1200 - 150 })
    expect(c.inWorld(900, 700, 2)).toEqual({ x: 900, y: 700 })
  })
})

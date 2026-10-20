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

  it('never zooms out past the point where the world fits', () => {
    const c = cam(1000, 600, 300, 200)
    expect(c.pMin).toBe(3)
    const small = cam(1000, 600, 2000, 1200)
    expect(small.pMin).toBe(1)
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

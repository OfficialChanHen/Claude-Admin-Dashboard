import { describe, expect, it } from 'vitest'
import { RAINBOW_MS, Weather, dropsIn, lightning, rainOf, skyFor } from './weather'

describe('skyFor', () => {
  it.each([
    [null, 'clear'], [0, 'clear'], [49, 'clear'], [50, 'cloudy'], [74, 'cloudy'], [75, 'rain'], [89, 'rain'], [90, 'storm'], [100, 'storm'],
  ] as const)('%s%% is %s', (pct, sky) => {
    expect(skyFor(pct)).toBe(sky)
  })
})

describe('Weather', () => {
  it('brings out a rainbow when the 5 hour use drops sharply, and not for small drops', () => {
    const w = new Weather()
    w.update(92, 0)
    expect(w.sky).toBe('storm')
    w.update(85, 1000)
    expect(w.rainbow(1000)).toBe(false)
    w.update(3, 2000)
    expect(w.sky).toBe('clear')
    expect(w.rainbow(2000)).toBe(true)
    expect(w.rainbow(2000 + RAINBOW_MS + 1)).toBe(false)
  })

  it('keeps the last known use when there is no reading', () => {
    const w = new Weather()
    w.update(80, 0)
    w.update(null, 1)
    w.update(10, 2)
    expect(w.rainbow(2)).toBe(true)
  })
})

describe('lightning', () => {
  it('only flashes in a storm, and only now and then', () => {
    let lit = 0
    for (let t = 0; t < 600_000; t += 50) {
      expect(lightning('rain', t)).toBe(0)
      if (lightning('storm', t) > 0) lit++
    }
    expect(lit).toBeGreaterThan(0)
    expect(lit).toBeLessThan(600_000 / 50 / 10)
  })
})

describe('dropsIn', () => {
  const view = { x: 0, y: 0, w: 300, h: 200 }

  it('has no drops without rain, and more in a storm than in rain', () => {
    expect(dropsIn(view, 0, rainOf('cloudy'))).toEqual([])
    expect(dropsIn(view, 0, rainOf('storm')).length).toBeGreaterThan(dropsIn(view, 0, rainOf('rain')).length)
  })

  it('makes drops fall as time passes', () => {
    const a = dropsIn(view, 0, 1)
    const b = dropsIn(view, 100, 1)
    // The same columns, each drop a little lower.
    expect(Math.min(...b.map((d) => d.y))).not.toBe(Math.min(...a.map((d) => d.y)))
    const first = (ds: typeof a) => ds.find((d) => d.y > 50 && d.y < 120)!
    expect(b.some((d) => Math.abs(d.y - (first(a).y + 26)) < 0.5)).toBe(true)
  })

  it('stays near the view', () => {
    for (const d of dropsIn(view, 12345, 1)) {
      expect(d.x).toBeGreaterThan(-20)
      expect(d.x).toBeLessThan(view.w + 20)
    }
  })
})

// The weather outside follows the 5 hour plan limit: clear while there is plenty
// left, clouds past half, rain near the wrap-up point and a storm near the cap.
// When the window resets, the sky clears with a rainbow. Raindrops and
// lightning are worked out from the clock, like the traffic, so nothing is stored.

import { hash } from './street'

export type Sky = 'clear' | 'cloudy' | 'rain' | 'storm'

export const CLOUDY_AT = 50
export const RAIN_AT = 75
export const STORM_AT = 90
/** A drop this big in the 5 hour use means the window reset. */
const RESET_DROP = 25
export const RAINBOW_MS = 90_000

export function skyFor(pct: number | null): Sky {
  if (pct == null || pct < CLOUDY_AT) return 'clear'
  if (pct < RAIN_AT) return 'cloudy'
  if (pct < STORM_AT) return 'rain'
  return 'storm'
}

/** How dark the day gets, from 0 to 1. */
export function gloom(sky: Sky) {
  return { clear: 0, cloudy: 0.08, rain: 0.18, storm: 0.28 }[sky]
}

/** How hard it rains, from 0 to 1. */
export function rainOf(sky: Sky) {
  return sky === 'storm' ? 1 : sky === 'rain' ? 0.55 : 0
}

export class Weather {
  sky: Sky = 'clear'
  rainbowUntil = 0
  private last: number | null = null

  /** Called with the latest 5 hour use. A big drop is a reset: out comes the rainbow. */
  update(pct: number | null, now: number) {
    if (pct != null && this.last != null && this.last - pct >= RESET_DROP) this.rainbowUntil = now + RAINBOW_MS
    if (pct != null) this.last = pct
    this.sky = skyFor(pct)
  }

  rainbow(now: number) {
    return now < this.rainbowUntil
  }
}

const FLASH_EVERY_MS = 7000

/** How bright a lightning flash is at `now`, from 0 to 1. Storms only; about every other window has one, with a double flicker. */
export function lightning(sky: Sky, now: number) {
  if (sky !== 'storm') return 0
  const slot = Math.floor(now / FLASH_EVERY_MS)
  if (hash(slot, 3, 77) < 0.45) return 0
  const at = slot * FLASH_EVERY_MS + hash(slot, 4, 77) * (FLASH_EVERY_MS - 600)
  const t = now - at
  if (t < 0 || t > 420) return 0
  if (t < 70) return 1
  if (t < 140) return 0.2
  if (t < 200) return 0.8
  return Math.max(0, 0.8 * (1 - (t - 200) / 220))
}

export type Drop = { x: number; y: number; len: number }

const DROP_FALL = 260 // art px per second
const DROP_SPAN = 90 // art px between drops in one column

/**
 * Raindrops in an art-pixel rectangle at time `t` (ms). Columns are spread
 * wider when you zoom out, so the count on screen stays about the same.
 */
export function dropsIn(view: { x: number; y: number; w: number; h: number }, t: number, rain: number, spacing = 9): Drop[] {
  if (rain <= 0) return []
  const out: Drop[] = []
  const fall = (t / 1000) * DROP_FALL
  const c0 = Math.floor(view.x / spacing)
  const c1 = Math.ceil((view.x + view.w) / spacing)
  for (let c = c0; c <= c1; c++) {
    if (hash(c, 0, 41) > rain) continue
    const phase = hash(c, 1, 41) * DROP_SPAN
    // Drops in a column, falling, with a slight slant.
    const first = Math.floor((view.y - fall - phase) / DROP_SPAN)
    const last = Math.ceil((view.y + view.h - fall - phase) / DROP_SPAN)
    for (let k = first; k <= last; k++) {
      const y = k * DROP_SPAN + phase + fall
      out.push({ x: c * spacing + (y % 60) * -0.15 + hash(c, k, 42) * 4, y, len: 3 + Math.round(hash(c, k, 43) * 3) })
    }
  }
  return out
}

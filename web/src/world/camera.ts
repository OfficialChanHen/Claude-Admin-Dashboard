// The camera over the world. Screen sizes are device pixels, world positions
// are art pixels, and P (device pixels per art pixel) is always a whole number
// so the art stays crisp.

export class Camera {
  /** The world point at the centre of the screen. */
  x = 0
  y = 0
  P = 2
  vw = 1
  vh = 1
  worldW = 1
  worldH = 1
  pMax = 8
  private target: { x: number; y: number; P?: number } | null = null

  setViewport(vw: number, vh: number, dpr: number) {
    this.vw = Math.max(1, vw)
    this.vh = Math.max(1, vh)
    this.pMax = Math.max(4, Math.round(6 * dpr))
    this.P = Math.min(Math.max(this.P, this.pMin), this.pMax)
    this.clamp()
  }

  setWorld(w: number, h: number) {
    this.worldW = Math.max(1, w)
    this.worldH = Math.max(1, h)
    this.clamp()
  }

  /** Zoomed out far enough to see the whole world, but never below 1. */
  get pMin() {
    return Math.max(1, Math.min(Math.floor(this.vw / this.worldW), Math.floor(this.vh / this.worldH)))
  }

  /** Where world (0, 0) lands on screen, rounded so tiles line up on pixels. */
  origin() {
    return { x: Math.round(this.vw / 2 - this.x * this.P), y: Math.round(this.vh / 2 - this.y * this.P) }
  }

  toScreen(wx: number, wy: number) {
    const o = this.origin()
    return { x: o.x + wx * this.P, y: o.y + wy * this.P }
  }

  toWorld(sx: number, sy: number) {
    const o = this.origin()
    return { x: (sx - o.x) / this.P, y: (sy - o.y) / this.P }
  }

  /** Keeps the world on screen: centred when it is smaller than the view. */
  clamp() {
    const halfW = this.vw / 2 / this.P
    const halfH = this.vh / 2 / this.P
    this.x = this.worldW <= halfW * 2 ? this.worldW / 2 : Math.min(this.worldW - halfW, Math.max(halfW, this.x))
    this.y = this.worldH <= halfH * 2 ? this.worldH / 2 : Math.min(this.worldH - halfH, Math.max(halfH, this.y))
  }

  /** One zoom step in or out, keeping the point under the cursor still. */
  zoomAt(sx: number, sy: number, dir: 1 | -1) {
    const P = Math.min(this.pMax, Math.max(this.pMin, this.P + dir))
    if (P === this.P) return false
    const w = this.toWorld(sx, sy)
    this.P = P
    this.x = w.x - (sx - this.vw / 2) / P
    this.y = w.y - (sy - this.vh / 2) / P
    this.target = null
    this.clamp()
    return true
  }

  panBy(dx: number, dy: number) {
    this.x -= dx / this.P
    this.y -= dy / this.P
    this.target = null
    this.clamp()
  }

  flyTo(x: number, y: number, P?: number) {
    this.target = { x, y, P: P == null ? undefined : Math.min(this.pMax, Math.max(this.pMin, P)) }
  }

  get flying() {
    return this.target !== null
  }

  stop() {
    this.target = null
  }

  /** Eases toward the fly target. Returns true while moving. */
  step(dt: number) {
    const t = this.target
    if (!t) return false
    if (t.P != null && t.P !== this.P) this.P = t.P
    const k = 1 - Math.exp(-dt * 7)
    this.x += (t.x - this.x) * k
    this.y += (t.y - this.y) * k
    const before = { x: this.x, y: this.y }
    this.clamp()
    const blocked = Math.abs(before.x - this.x) + Math.abs(before.y - this.y) > 0.01
    if (Math.hypot(t.x - this.x, t.y - this.y) < 0.5 || blocked) {
      this.x = t.x
      this.y = t.y
      this.clamp()
      this.target = null
    }
    return true
  }
}

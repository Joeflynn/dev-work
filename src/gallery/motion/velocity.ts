/** Pointer velocity over a short trailing window, in px/ms. */
export class VelocityTracker {
  private samples: { t: number; x: number; y: number }[] = []
  private window: number

  constructor(windowMs = 90) {
    this.window = windowMs
  }

  reset(t: number, x: number, y: number) {
    this.samples = [{ t, x, y }]
  }

  push(t: number, x: number, y: number) {
    this.samples.push({ t, x, y })
    const cutoff = t - this.window * 2
    while (this.samples.length > 2 && this.samples[0].t < cutoff) {
      this.samples.shift()
    }
  }

  /**
   * Velocity at time `now`. If the pointer has been still for longer than the
   * window (the user paused before lifting), velocity is zero — a paused
   * finger should not fling.
   */
  velocity(now = performance.now()): { x: number; y: number } {
    const s = this.samples
    if (s.length < 2) return { x: 0, y: 0 }
    const last = s[s.length - 1]
    if (now - last.t > this.window * 0.75) return { x: 0, y: 0 }
    let first = s[0]
    for (let i = s.length - 2; i >= 0; i--) {
      if (last.t - s[i].t > this.window) break
      first = s[i]
    }
    const dt = last.t - first.t
    if (dt <= 0) return { x: 0, y: 0 }
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt }
  }
}

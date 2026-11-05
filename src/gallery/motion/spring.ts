/**
 * A retargetable, velocity-preserving spring.
 *
 * The spring is stepped with the closed-form solution of a damped harmonic
 * oscillator, evaluated from its *current* value and velocity on every frame.
 * That gives three properties the whole gallery leans on:
 *
 *  1. Retargeting is free. `setTarget()` only moves the rest point — value and
 *     velocity are untouched, so a spring heading to 1 that is told to go to 0
 *     turns around with the momentum it already had.
 *  2. Config can change mid-flight. Swapping `response` / `bounce` while moving
 *     keeps value and velocity, so a wheel-follow spring can hand off to a
 *     softer snap spring without a seam.
 *  3. It is frame-rate independent and unconditionally stable — the analytic
 *     step is exact for any dt, so a dropped frame lands where it should.
 *
 * Gestures hand off through `track()` (the finger owns the value, the spring
 * only remembers the finger's velocity) and `release()` (physics takes over,
 * seeded with that velocity).
 */

export interface SpringConfig {
  /** Perceptual duration in seconds: the period of the undamped oscillation. */
  response: number
  /** 0 = critically damped, >0 overshoots, <0 is overdamped. */
  bounce: number
}

export interface SpringOptions {
  /** Distance from target considered "arrived", in the spring's own units. */
  precision?: number
  /** Called whenever the spring leaves rest, so the loop can wake. */
  onWake?: () => void
}

export class Spring {
  value: number
  velocity = 0
  target: number
  config: SpringConfig
  /** While held, a gesture owns the value; the loop does not integrate it. */
  held = false
  readonly precision: number
  private onWake?: () => void
  private resting = true

  constructor(value: number, config: SpringConfig, opts: SpringOptions = {}) {
    this.value = value
    this.target = value
    this.config = { ...config }
    this.precision = opts.precision ?? 0.001
    this.onWake = opts.onWake
  }

  get atRest() {
    return this.resting && !this.held
  }

  /** Move the rest point. Value and velocity are preserved. */
  setTarget(target: number, velocity?: number) {
    this.target = target
    if (velocity !== undefined) this.velocity = velocity
    this.held = false
    this.wake()
  }

  /** Add velocity without changing the target (a nudge / impulse). */
  impulse(dv: number) {
    this.velocity += dv
    this.wake()
  }

  /** Gesture owns the value. Velocity is recorded for display + hand-off. */
  track(value: number, velocity: number) {
    this.value = value
    this.velocity = velocity
    this.held = true
    this.wake()
  }

  /** Gesture lets go: physics resumes from the finger's state. */
  release(target: number, velocity = this.velocity) {
    this.held = false
    this.setTarget(target, velocity)
  }

  /** Teleport to a value with no motion. */
  jump(value: number) {
    this.value = value
    this.target = value
    this.velocity = 0
    this.held = false
    this.resting = true
  }

  configure(config: Partial<SpringConfig>) {
    this.config = { ...this.config, ...config }
    if (!this.resting) this.wake()
  }

  setOnWake(fn: () => void) {
    this.onWake = fn
  }

  private wake() {
    if (this.resting) {
      this.resting = false
      this.onWake?.()
    } else {
      this.onWake?.()
    }
  }

  /** Advance by dt seconds. Returns true while still moving. */
  step(dt: number): boolean {
    if (this.held || this.resting) return !this.resting
    if (dt <= 0) return true

    const { response, bounce } = this.config
    const w0 = (2 * Math.PI) / Math.max(response, 0.0001)
    const zeta = bounce >= 0 ? 1 - Math.min(bounce, 0.99) : 1 / (1 + bounce)
    const x0 = this.value - this.target
    const v0 = this.velocity
    let x: number
    let v: number

    if (zeta < 1) {
      // Underdamped
      const wd = w0 * Math.sqrt(1 - zeta * zeta)
      const decay = Math.exp(-zeta * w0 * dt)
      const cos = Math.cos(wd * dt)
      const sin = Math.sin(wd * dt)
      const b = (v0 + zeta * w0 * x0) / wd
      x = decay * (x0 * cos + b * sin)
      v =
        decay *
        (-zeta * w0 * (x0 * cos + b * sin) + (-x0 * wd * sin + b * wd * cos))
    } else if (zeta === 1) {
      // Critically damped
      const decay = Math.exp(-w0 * dt)
      const b = v0 + w0 * x0
      x = decay * (x0 + b * dt)
      v = decay * (b - w0 * (x0 + b * dt))
    } else {
      // Overdamped
      const s = Math.sqrt(zeta * zeta - 1)
      const r1 = -w0 * (zeta - s)
      const r2 = -w0 * (zeta + s)
      const a = (v0 - r2 * x0) / (r1 - r2)
      const b = x0 - a
      const e1 = Math.exp(r1 * dt)
      const e2 = Math.exp(r2 * dt)
      x = a * e1 + b * e2
      v = a * r1 * e1 + b * r2 * e2
    }

    this.value = this.target + x
    this.velocity = v

    const p = this.precision
    if (Math.abs(x) < p && Math.abs(v) < p * 10) {
      this.value = this.target
      this.velocity = 0
      this.resting = true
      return false
    }
    return true
  }
}

/** Two springs that share a config — a 2D vector with x/y velocity. */
export class Spring2D {
  x: Spring
  y: Spring
  constructor(
    x: number,
    y: number,
    config: SpringConfig,
    opts?: SpringOptions
  ) {
    this.x = new Spring(x, config, opts)
    this.y = new Spring(y, config, opts)
  }
  setTarget(x: number, y: number, vx?: number, vy?: number) {
    this.x.setTarget(x, vx)
    this.y.setTarget(y, vy)
  }
  track(x: number, y: number, vx: number, vy: number) {
    this.x.track(x, vx)
    this.y.track(y, vy)
  }
  release(x: number, y: number, vx?: number, vy?: number) {
    this.x.release(x, vx)
    this.y.release(y, vy)
  }
  configure(c: Partial<SpringConfig>) {
    this.x.configure(c)
    this.y.configure(c)
  }
  get springs() {
    return [this.x, this.y]
  }
}

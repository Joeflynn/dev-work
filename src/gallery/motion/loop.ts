import { Spring } from "./spring"

/**
 * The one animation loop. Every spring in the gallery is registered here; each
 * frame steps all of them by the same dt and then calls a single render()
 * that derives every on-screen value from spring state. The loop sleeps when
 * nothing is moving and no gesture is holding a spring.
 */
export class MotionLoop {
  private springs: Spring[] = []
  private raf = 0
  private last = 0
  private running = false
  /** Global time scale — 0.25 gives slow motion for inspecting springs. */
  timeScale = 1
  fps = 0
  private render: (dt: number) => void
  private update?: () => void

  /**
   * @param render  derives the frame from spring state (after stepping)
   * @param update  runs before stepping — the place to retarget springs whose
   *                targets are derived from other springs (e.g. ripples)
   */
  constructor(render: (dt: number) => void, update?: () => void) {
    this.render = render
    this.update = update
  }

  get count() {
    return this.springs.length
  }

  add<T extends Spring>(spring: T): T {
    spring.setOnWake(this.wake)
    this.springs.push(spring)
    return spring
  }

  get activeCount() {
    let n = 0
    for (const s of this.springs) if (!s.atRest) n++
    return n
  }

  wake = () => {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  /** Render one frame synchronously without stepping (e.g. after resize). */
  renderNow() {
    this.render(0)
  }

  private tick = (now: number) => {
    const raw = Math.min((now - this.last) / 1000, 1 / 20)
    this.last = now
    if (raw > 0) this.fps = this.fps * 0.9 + (1 / raw) * 0.1
    const dt = raw * this.timeScale
    this.update?.()

    let moving = false
    for (const s of this.springs) {
      if (s.held) {
        moving = true
        continue
      }
      if (s.step(dt)) moving = true
    }
    this.render(dt)

    if (moving) {
      this.raf = requestAnimationFrame(this.tick)
    } else {
      this.running = false
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.running = false
  }
}

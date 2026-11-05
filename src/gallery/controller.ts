import { MotionLoop } from "./motion/loop"
import { Spring, Spring2D, type SpringConfig } from "./motion/spring"
import { VelocityTracker } from "./motion/velocity"
import {
  clamp,
  mix,
  mixRect,
  rubberClamp,
  smoothstep,
  unrubberClamp,
  type Rect,
} from "./motion/math"
import {
  articleColumn,
  articleGap,
  articleTail,
  carouselMetrics,
  carouselRect,
  fitSize,
  focusMetrics,
  focusRect,
  gridLayout,
  type CarouselMetrics,
  type FocusMetrics,
  type GridLayout,
  type Stage,
} from "./layout"
import type { Photo } from "./photos"

/**
 * GalleryController
 * -----------------
 * The whole gallery is a function of seven springs:
 *
 *   layout     0 = masonry grid, 1 = carousel strip
 *   open (p)   0 = in place, 1 = focused
 *   transport  carousel / focus position, in item-index units
 *   scroll     grid scroll offset, px
 *   drag       2D offset of the focused card, px (pull-to-dismiss)
 *   press      0..1 press feedback on the touched card
 *   panel      0..1 values panel
 *   read       article scroll offset, px (only while an article is open)
 *
 * Inputs (pointer, wheel, keyboard, buttons) never animate anything directly.
 * They only retarget springs — or, while a finger is down, `track()` them 1:1
 * and `release()` them with the finger's velocity. A single render pass then
 * derives every card rect by blending pure layout functions with the spring
 * values. Because nothing else holds motion state, every interaction can
 * interrupt every other one and inherit its velocity.
 */

export type Mode = "grid" | "carousel"
type Intent =
  | "idle"
  | "pending"
  | "scroll"
  | "scrub"
  | "page"
  | "dismiss"
  | "squish"
  | "read"

export interface Tuning {
  layout: SpringConfig
  open: SpringConfig
  transport: SpringConfig
  drag: SpringConfig
  squish: SpringConfig
}

export const DEFAULT_TUNING: Tuning = {
  layout: { response: 0.62, bounce: 0.06 },
  open: { response: 0.6, bounce: 0.04 },
  transport: { response: 0.5, bounce: 0.06 },
  drag: { response: 0.42, bounce: 0.18 },
  squish: { response: 0.44, bounce: 0.42 },
}

/**
 * Squish: pulling a carousel card down (q > 0) shrinks it toward the
 * baseline; pulling it up (q < 0) grows it. The curve is symmetric:
 *   scale = 1 - sign(q)·MAX·(1 - e^(-K·|q|))
 * so it eases toward 1 ± MAX and never collapses or balloons, and its slope
 * is the same on both sides of q = 0 — a release that bounces through rest
 * passes smoothly from shrink to grow and back.
 */
const SQUISH_MAX = 0.28
const SQUISH_K = 1.7
const squishScale = (q: number) =>
  1 - Math.sign(q) * SQUISH_MAX * (1 - Math.exp(-SQUISH_K * Math.abs(q)))
/**
 * Open/close staging. One spring (p) drives the focus transition, read
 * through two fixed curves that both start slow:
 *   x            p^X_LAG   — eases in a little behind the strip scroll
 *   y and size   p^Y_LAG   — later still, lands with x
 * In the carousel the card's early x travel comes from the strip itself
 * scrolling toward it (the `shift` spring, which starts immediately), so the
 * row visibly pans in the card's direction before the card lifts out of it.
 * Both curves are pure functions of p, so retargeting mid-flight stays
 * seamless and the close plays the same path in reverse.
 */
const X_LAG = 1.25
const Y_LAG = 1.7
const xWeight = (t: number) => Math.pow(clamp(t, 0, 1), X_LAG)
const yWeight = (t: number) => Math.pow(clamp(t, 0, 1), Y_LAG)
/** The strip pan that leads a carousel open: no bounce, a touch quicker than p. */
const PAN: SpringConfig = { response: 0.6, bounce: 0 }
/**
 * Carousel neighbours during an open: first they're pushed outward by exactly
 * the width the opening card has gained (so the row keeps its gaps and pans
 * as one piece), then, later, they glide to their off-screen pager slots.
 * NEIGHBOUR_LAG delays that second leg relative to the opened card.
 */
const NEIGHBOUR_LAG = 2.5

/**
 * Grid scatter: opening a grid card pushes every other card straight away
 * from it until it's fully out of frame. Exit starts are staggered by
 * distance — the nearest cards are shoved first by the card lifting out of
 * its slot, farther ones follow — and the close plays it in reverse, so the
 * grid settles back in around the returning card.
 */
const SCATTER_STAGGER = 0.35
const SCATTER_MARGIN = 48

/**
 * Close pacing. Closing runs quicker than opening (the user has already
 * decided — get out of the way), with less spring than the open. The grid's
 * return has its own spring so it can be paced to land with the solo image
 * rather than ahead of it.
 */
const CLOSE_SPEED = 0.6 // close response = open response × this
const CLOSE_BOUNCE = 0.6 // drag-dismiss bounce × this (40% less)
const SCATTER_RETURN = 1.6 // grid return response = close response × this

/** Offset that carries `r` fully off-stage, moving directly away from (ox, oy). */
function exitOffset(r: Rect, ox: number, oy: number, W: number, H: number) {
  let dx = r.x + r.w / 2 - ox
  let dy = r.y + r.h / 2 - oy
  const len = Math.hypot(dx, dy)
  if (len < 1) {
    dx = 0
    dy = -1
  } else {
    dx /= len
    dy /= len
  }
  // Smallest travel along (dx, dy) that clears any one stage edge.
  const m = SCATTER_MARGIN
  let t = Infinity
  if (dx > 1e-3) t = Math.min(t, (W + m - r.x) / dx)
  if (dx < -1e-3) t = Math.min(t, (r.x + r.w + m) / -dx)
  if (dy > 1e-3) t = Math.min(t, (H + m - r.y) / dy)
  if (dy < -1e-3) t = Math.min(t, (r.y + r.h + m) / -dy)
  if (!Number.isFinite(t) || t < 0) t = 0 // already off-stage that way
  return { x: dx * t, y: dy * t, dist: len }
}

/**
 * Blend a card's resting rect into its focus rect. `pan` (0..1) is how much
 * of the card's x should ride the strip pan instead of leading on its own:
 * 0 in the grid (x leads y + scale), 1 in the carousel (the `shift` spring
 * already carries x, so the card stays in its row while it grows).
 */
function mixFocus(a: Rect, b: Rect, t: number, pan = 0): Rect {
  const wy = yWeight(t)
  const wx = mix(xWeight(t), wy, pan)
  const w = mix(a.w, b.w, wy)
  const h = mix(a.h, b.h, wy)
  const cx = mix(a.x + a.w / 2, b.x + b.w / 2, wx)
  const cy = mix(a.y + a.h / 2, b.y + b.h / 2, wy)
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/** Each step away from the squished card responds a little later. */
const RIPPLE_BASE = 0.22
const RIPPLE_STEP = 0.07
/** Neighbours bounce less than the card itself (30% less). */
const RIPPLE_BOUNCE = 0.7

/** Fast, critically damped config used while a wheel is driving a target. */
const FOLLOW: SpringConfig = { response: 0.16, bounce: 0 }
const MOMENTUM: SpringConfig = { response: 0.62, bounce: 0 }
const PRESS: SpringConfig = { response: 0.2, bounce: 0 }
const PANEL: SpringConfig = { response: 0.3, bounce: 0 }

/**
 * Articles. An item with `article` opens on the same p spring as a photo —
 * same staging, same scatter — but lands as a hero with a text column under
 * it, and then reads like a page: the `read` spring scrolls hero and text
 * together. Pulling down past the top is the article's version of the photo
 * pull-to-dismiss: the hero shrinks toward its bottom edge, the text fades,
 * the grid drifts back in, and letting go past the commit closes it with the
 * finger's velocity.
 *
 * Text reveal is read straight off p through staggered windows, so it plays
 * in reverse on close for free: body leaves first, then the title, then the
 * hero flies home.
 */
const TEXT_IN = 0.55 // p at which the first part (title) starts to appear
const TEXT_STAGGER = 0.1 // each later part starts this much later in p
const TEXT_RISE = 20 // px the text rises as it fades in
const ARTICLE_PULL_SCALE = 0.1 // hero shrinks by up to this at full pull
const READ_VELOCITY_COMMIT = 0.5 // px/ms downward while past the top
/** While reading, the hero never sits further than this above the stage. */
const HERO_PARK = 40
/**
 * A tap that dismisses an article: down and up within this long, without
 * moving past TAP_SLOP, either on the hero or out in the side margins.
 */
const ARTICLE_TAP_MS = 1000

const TAP_SLOP = 6
const VELOCITY_COMMIT = 0.5 // px/ms, radial, for pull-to-dismiss
const PAGE_VELOCITY_COMMIT = 0.3 // px/ms, horizontal, for paging
const SCROLL_PROJECTION_MS = 320
const SCRUB_PROJECTION_MS = 240
const RADIUS = 6

export interface Elements {
  stage: HTMLElement
  cards: HTMLElement[]
  caption: HTMLElement
  counter: HTMLElement | null
  panel: HTMLElement | null
  readouts: Record<string, HTMLElement | null>
  /** Article text columns, by item index (null for photo-only items). */
  articles: (HTMLElement | null)[]
}

interface Gesture {
  id: number
  x0: number
  y0: number
  ax: number
  ay: number
  x: number
  y: number
  intent: Intent
  card: number
  caught: "none" | "transport" | "scroll" | "open" | "read"
  startT: number
  startS: number
  startD: { x: number; y: number }
  startQ: number
  startR: number
  /** pointerdown timestamp, ms */
  t0: number
}

interface CardWrite {
  t: string
  r: string
  z: number
  vis: boolean
}

export class GalleryController {
  readonly loop: MotionLoop
  readonly layout: Spring
  readonly open: Spring
  readonly transport: Spring
  readonly scroll: Spring
  readonly drag: Spring2D
  readonly press: Spring
  readonly panel: Spring
  /** Pull progress q of the squished carousel card (0 = at rest). */
  readonly squish: Spring
  /** Per-card horizontal offset, px — neighbours closing the squish gap. */
  readonly ripples: Spring[]
  /**
   * Strip offset, px, applied to carousel rects only. Opening a card re-anchors
   * the transport on it and moves the visual difference into this spring, so
   * the focus pager is centred on the tapped card from the first frame.
   */
  readonly shift: Spring
  /** Grid scatter progress (0 = in place, 1 = out of frame). Follows p. */
  readonly scatter: Spring
  /** Article scroll, px. 0 = hero at its focus position; < 0 = pulled down. */
  readonly read: Spring

  tuning: Tuning = structuredClone(DEFAULT_TUNING)
  openIndex = 0
  private squishIndex = -1

  private photos: Photo[]
  private el: Elements
  private stage: Stage = { w: 1, h: 1 }
  private origin = { x: 0, y: 0 }
  private grid!: GridLayout
  private cm!: CarouselMetrics
  private fm!: FocusMetrics
  private base: { w: number; h: number }[] = []
  private rects: Rect[] = []
  private writes: CardWrite[]
  private reduced = false
  private mq: MediaQueryList

  private pressIndex = -1
  private tapOrigin = { x: 0.5, y: 0.5 }
  private vectorTarget: "center" | "source" = "center"
  private g: Gesture | null = null
  private tracker = new VelocityTracker()
  private stats = {
    dragDistance: 0,
    releaseVelocity: 0,
    intent: "idle" as Intent,
  }

  private wheelTimer = 0
  private wheelLockTimer = 0
  private wheelLocked = false
  private wheelAcc = { x: 0, y: 0 }

  private captionIndex = -1
  private counterIndex = -1
  private readoutCache: Record<string, string> = {}
  private dbg = {
    src: null as Rect | null,
    tgt: null as Rect | null,
    cur: null as Rect | null,
    scale: 1,
    q: 0,
    left: 0,
    right: 0,
    over: 0,
    active: -1,
  }
  private ro: ResizeObserver
  private onModeChange?: (m: Mode) => void
  private onArticleChange?: (i: number | null) => void
  private articleShown: number | null = null
  private articleH: number[] = []
  private articleParts: HTMLElement[][] = []
  private styleCache = new WeakMap<HTMLElement, Record<string, string>>()
  /**
   * Horizontal extent of the open article (hero ∪ text column), stage px.
   * Taps outside it — the side margins — dismiss the article.
   */
  private articleSpan = { l: 0, r: 0 }

  constructor(
    photos: Photo[],
    el: Elements,
    opts: {
      onModeChange?: (m: Mode) => void
      onArticleChange?: (i: number | null) => void
    } = {}
  ) {
    this.photos = photos
    this.el = el
    this.onModeChange = opts.onModeChange
    this.onArticleChange = opts.onArticleChange
    this.articleParts = el.articles.map((a) =>
      a ? Array.from(a.querySelectorAll<HTMLElement>("[data-part]")) : []
    )
    this.writes = photos.map(() => ({ t: "", r: "", z: -1, vis: true }))

    this.loop = new MotionLoop(this.render, this.update)
    const L = this.loop
    this.layout = L.add(
      new Spring(0, this.tuning.layout, { precision: 0.0005 })
    )
    this.open = L.add(new Spring(0, this.tuning.open, { precision: 0.0005 }))
    this.transport = L.add(
      new Spring(0, this.tuning.transport, { precision: 0.0005 })
    )
    this.scroll = L.add(new Spring(0, MOMENTUM, { precision: 0.25 }))
    this.drag = new Spring2D(0, 0, this.tuning.drag, { precision: 0.25 })
    this.drag.springs.forEach((s) => L.add(s))
    this.press = L.add(new Spring(0, PRESS, { precision: 0.001 }))
    this.panel = L.add(new Spring(0, PANEL, { precision: 0.001 }))
    this.squish = L.add(
      new Spring(0, this.tuning.squish, { precision: 0.0005 })
    )
    this.ripples = photos.map(() =>
      L.add(new Spring(0, this.tuning.squish, { precision: 0.1 }))
    )
    this.shift = L.add(new Spring(0, this.tuning.transport, { precision: 0.1 }))
    this.scatter = L.add(new Spring(0, this.tuning.open, { precision: 0.0005 }))
    this.read = L.add(new Spring(0, MOMENTUM, { precision: 0.25 }))

    this.mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    this.reduced = this.mq.matches
    this.mq.addEventListener("change", this.onReducedMotion)

    const s = el.stage
    s.addEventListener("pointerdown", this.onPointerDown)
    s.addEventListener("pointermove", this.onPointerMove)
    s.addEventListener("pointerup", this.onPointerUp)
    s.addEventListener("pointercancel", this.onPointerUp)
    s.addEventListener("lostpointercapture", this.onLostCapture)
    s.addEventListener("wheel", this.onWheel, { passive: false })
    s.addEventListener("keydown", this.onCardKey)
    s.addEventListener("focusin", this.onFocusIn)
    window.addEventListener("keydown", this.onKey)

    this.ro = new ResizeObserver(() => this.measure())
    this.ro.observe(s)
    // Article heights change as fonts and inline images load.
    el.articles.forEach((a) => a && this.ro.observe(a))
    this.measure()
  }

  destroy() {
    const s = this.el.stage
    s.removeEventListener("pointerdown", this.onPointerDown)
    s.removeEventListener("pointermove", this.onPointerMove)
    s.removeEventListener("pointerup", this.onPointerUp)
    s.removeEventListener("pointercancel", this.onPointerUp)
    s.removeEventListener("lostpointercapture", this.onLostCapture)
    s.removeEventListener("wheel", this.onWheel)
    s.removeEventListener("keydown", this.onCardKey)
    s.removeEventListener("focusin", this.onFocusIn)
    window.removeEventListener("keydown", this.onKey)
    this.mq.removeEventListener("change", this.onReducedMotion)
    this.ro.disconnect()
    this.loop.destroy()
    clearTimeout(this.wheelTimer)
    clearTimeout(this.wheelLockTimer)
  }

  // ───────────────────────────────────────────── public intents

  get mode(): Mode {
    return this.layout.target >= 0.5 ? "carousel" : "grid"
  }

  get isOpen() {
    return this.open.target === 1
  }

  /** An article (rather than a photo) is open, or opening. */
  get articleOpen() {
    return this.isOpen && this.isArticle(this.openIndex)
  }

  isArticle(i: number) {
    return !!this.photos[i]?.article
  }

  toggleMode() {
    const n = this.photos.length
    const toCarousel = this.mode === "grid"
    if (this.isOpen) this.close(false)
    this.layout.configure(this.cfg(this.tuning.layout))

    if (toCarousel) {
      // Seed the strip with what you were looking at. Only safe to jump while
      // the carousel contributes nothing to the frame.
      if (this.layout.value < 0.02) {
        const idx =
          this.open.value > 0.01 ? this.openIndex : this.firstVisible()
        this.transport.jump(idx)
      }
      this.layout.setTarget(1)
    } else {
      if (this.layout.value > 0.98) {
        const idx = Math.round(clamp(this.transport.value, 0, n - 1))
        const r = this.grid.rects[idx]
        this.scroll.jump(
          clamp(r.y + r.h / 2 - this.stage.h / 2, 0, this.grid.maxScroll)
        )
      }
      this.layout.setTarget(0)
    }
    this.onModeChange?.(this.mode)
  }

  openCard(i: number) {
    // A fresh article starts at the top. Re-catching the same one mid-close
    // keeps your place.
    if (i !== this.openIndex || this.open.value < 0.01) this.read.jump(0)
    this.openIndex = i
    if (this.mode === "carousel") {
      // Re-anchor rather than scroll. Carousel x of card j is
      //   (j − T)·stride + shift
      // so jumping T to i and adding (i − T)·stride to shift leaves every card
      // exactly where it was, carrying the transport's velocity into shift.
      // The focus pager reads T, so its target for card i is centre-stage
      // immediately — x no longer waits on the strip to scroll across.
      const cs = this.cm.stride
      const T = this.transport.value
      const sv = this.shift.velocity - this.transport.velocity * cs
      const sx = this.shift.value + (i - T) * cs
      this.transport.jump(i)
      this.shift.jump(sx)
      this.shift.configure(this.cfg(PAN))
      this.shift.setTarget(0, sv)
    }
    this.vectorTarget = "center"
    this.reopen()
    const a = this.el.articles[i]
    if (a) {
      // Move focus into the article so screen readers and keyboard scrolling
      // start there. It's made visible first; opacity is still 0.
      this.css(a, "visibility", "visible")
      a.focus({ preventScroll: true })
    }
  }

  /** Drive p (and the grid scatter that follows it) toward open. */
  private reopen() {
    this.open.configure(this.cfg(this.tuning.open))
    this.open.setTarget(1)
    this.scatter.configure(this.cfg(this.tuning.open))
    this.scatter.setTarget(1)
    this.notifyArticle()
  }

  close(fromDrag: boolean) {
    // A drag applies force, so it earns a little bounce. A tap does not.
    const t = this.tuning.open
    const response = t.response * CLOSE_SPEED
    this.open.configure(
      this.cfg({
        response,
        bounce: fromDrag ? (t.bounce + 0.1) * CLOSE_BOUNCE : 0,
      })
    )
    this.open.setTarget(0)
    this.scatter.configure(
      this.cfg({ response: response * SCATTER_RETURN, bounce: 0 })
    )
    this.scatter.setTarget(0)
    // Focus was inside the article: hand it back to the card it came from.
    const a = this.el.articles[this.openIndex]
    if (a && a.contains(document.activeElement)) {
      this.el.cards[this.openIndex]?.focus({ preventScroll: true })
    }
    this.notifyArticle()
  }

  private notifyArticle() {
    const i = this.articleOpen ? this.openIndex : null
    if (i === this.articleShown) return
    this.articleShown = i
    this.onArticleChange?.(i)
  }

  /**
   * Fold any remaining shift back into the transport (the inverse of the
   * re-anchor in openCard) before something else drives the strip. Only
   * while nothing is focused, so no focus rect moves as a result.
   */
  private absorbShift() {
    if (this.shift.atRest && this.shift.value === 0) return
    if (this.open.value > 0.001) return
    const cs = this.cm.stride
    const T = this.transport.value - this.shift.value / cs
    const v = this.transport.velocity - this.shift.velocity / cs
    const target = this.transport.target
    this.shift.jump(0)
    this.transport.jump(T)
    this.transport.setTarget(target, v)
  }

  step(dir: 1 | -1) {
    if (this.mode !== "carousel" || this.articleOpen) return
    this.absorbShift()
    const n = this.photos.length
    const idx = clamp(Math.round(this.transport.target) + dir, 0, n - 1)
    this.transport.configure(this.cfg(this.tuning.transport))
    this.transport.setTarget(idx)
    if (this.isOpen) this.openIndex = idx
  }

  setPanel(open: boolean) {
    this.panel.setTarget(open ? 1 : 0)
  }

  setTimeScale(s: number) {
    this.loop.timeScale = s
  }

  setTuning(key: keyof Tuning, patch: Partial<SpringConfig>) {
    this.tuning[key] = { ...this.tuning[key], ...patch }
    const c = this.cfg(this.tuning[key])
    if (key === "layout") this.layout.configure(c)
    if (key === "open") this.open.configure(c)
    if (key === "transport") this.transport.configure(c)
    if (key === "drag") this.drag.configure(c)
    if (key === "squish") {
      this.squish.configure(c)
      this.configureRipples()
    }
  }

  // ───────────────────────────────────────────── helpers

  private cfg(c: SpringConfig): SpringConfig {
    return this.reduced
      ? { response: Math.min(c.response, 0.32), bounce: 0 }
      : c
  }

  private onReducedMotion = () => {
    this.reduced = this.mq.matches
  }

  private get distanceCommit() {
    return Math.min(240, Math.min(this.stage.w, this.stage.h) * 0.28)
  }

  /** Pull past the top of an article (displayed px) that commits a close. */
  private get pullCommit() {
    return Math.min(110, this.distanceCommit * 0.6)
  }

  /** Unscrolled article geometry for item i, centred on the stage. */
  private articleFrame(i: number) {
    const h = this.base[i]?.h ?? 0
    const heroBottom = this.fm.centerY + h / 2
    return {
      colW: articleColumn(this.base[i]?.w ?? 0, this.stage),
      textTop: heroBottom + articleGap(this.stage),
      heroBottom,
    }
  }

  /** How far the open article can scroll. */
  private get readMax() {
    const i = this.openIndex
    if (!this.isArticle(i)) return 0
    const f = this.articleFrame(i)
    const end = f.textTop + (this.articleH[i] ?? 0) + articleTail(this.stage)
    return Math.max(0, end - this.stage.h)
  }

  /** Write a style only when it changed (render runs every frame). */
  private css(el: HTMLElement, prop: string, value: string) {
    let c = this.styleCache.get(el)
    if (!c) this.styleCache.set(el, (c = {}))
    if (c[prop] === value) return
    c[prop] = value
    el.style.setProperty(prop, value)
  }

  private get pageCommit() {
    return Math.min(180, this.stage.w * 0.22)
  }

  private firstVisible() {
    const S = this.scroll.value
    let best = 0
    let bestScore = Infinity
    this.grid.rects.forEach((r, i) => {
      const top = r.y - S
      if (top + r.h * 0.5 < 0 || top > this.stage.h) return
      const score = top * 2 + r.x
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    })
    return best
  }

  private local(e: PointerEvent) {
    return { x: e.clientX - this.origin.x, y: e.clientY - this.origin.y }
  }

  private measure() {
    const r = this.el.stage.getBoundingClientRect()
    this.origin = { x: r.left, y: r.top }
    this.stage = { w: Math.max(1, r.width), h: Math.max(1, r.height) }
    this.grid = gridLayout(this.photos, this.stage)
    this.cm = carouselMetrics(this.photos, this.stage)
    this.fm = focusMetrics(this.photos, this.stage)
    this.base = this.photos.map((p) => fitSize(p, this.fm.maxW, this.fm.maxH))
    this.el.cards.forEach((c, i) => {
      c.style.width = `${this.base[i].w}px`
      c.style.height = `${this.base[i].h}px`
    })
    this.writes.forEach((w) => {
      w.t = ""
      w.r = ""
    })
    this.el.articles.forEach((a, i) => {
      if (!a) return
      this.css(a, "width", `${this.articleFrame(i).colW}px`)
      this.articleH[i] = a.offsetHeight
    })
    if (this.articleOpen && !this.read.held) {
      const max = this.readMax
      if (this.read.target > max) this.read.setTarget(max)
    }
    if (this.scroll.value > this.grid.maxScroll && !this.scroll.held) {
      this.scroll.jump(this.grid.maxScroll)
    }
    this.loop.renderNow()
  }

  // ───────────────────────────────────────────── squish + ripple

  /**
   * Neighbours take a softened share of the squish spring's bounce, and
   * respond more slowly the further they are from the squished card, so the
   * reflow travels outward as a ripple instead of the row moving as a rigid
   * block.
   */
  private configureRipples() {
    const k = this.squishIndex
    const { bounce, response } = this.tuning.squish
    const scale = response / DEFAULT_TUNING.squish.response
    this.ripples.forEach((r, i) => {
      const d = Math.max(1, Math.abs(i - k))
      r.configure(
        this.cfg({
          response: (RIPPLE_BASE + RIPPLE_STEP * (d - 1)) * scale,
          bounce: bounce * RIPPLE_BOUNCE,
        })
      )
    })
  }

  /** Width each side of the squished card gives up (negative = pushes out). */
  private get squishGap() {
    return (this.cm.cardW * (1 - squishScale(this.squish.value))) / 2
  }

  /**
   * Runs before every physics step. Ripple targets are derived from the
   * squish spring, so they're retargeted here (only when they change — an
   * unchanged target must not wake a resting spring).
   */
  private update = () => {
    const k = this.squishIndex
    if (k < 0) return
    const gap = this.squishGap
    this.ripples.forEach((r, i) => {
      const t = i < k ? gap : i > k ? -gap : 0
      if (r.target !== t) r.setTarget(t)
    })
  }

  // ───────────────────────────────────────────── render

  private render = () => {
    const n = this.photos.length
    const { w: W, h: H } = this.stage
    const L = this.layout.value
    const P = this.open.value
    const S = this.scroll.value
    const Traw = this.transport.value
    const Tc = clamp(Traw, 0, n - 1)
    const over = Traw - Tc
    const dX = this.drag.x.value
    const dY = this.drag.y.value
    const art = this.isArticle(this.openIndex)
    const R = art ? this.read.value : 0
    // Article pull = how far the page is dragged down past its top.
    const q = art
      ? Math.max(0, -R) / this.pullCommit
      : Math.hypot(dX, dY) / this.distanceCommit
    const qe = smoothstep(q)
    const dragScale = 1 - (art ? ARTICLE_PULL_SCALE : 0.2) * qe
    let textX = 0
    let textY = 0
    const press = this.press.value
    const openI = this.openIndex
    const active = L >= 0.5 ? Math.round(Tc) : openI

    // How much wider the opening card currently is than a carousel card;
    // each neighbour is pushed out by half of it, like a real row reflowing.
    const op = this.photos[openI]
    const growHalf =
      P > 1e-5 && op
        ? (mix(
            this.cm.cardW,
            fitSize(op, this.fm.maxW, this.fm.maxH).w,
            yWeight(P)
          ) -
            this.cm.cardW) /
          2
        : 0

    // Grid scatter origin: the opened card's slot on screen. Pulling the open
    // card to dismiss lets the grid drift partway back in (linked to q).
    const go = this.grid.rects[openI]
    const gox = go ? go.x + go.w / 2 : W / 2
    const goy = go ? go.y - S + go.h / 2 : H / 2
    const pe = this.scatter.value * (1 - 0.5 * qe)
    const diag = Math.hypot(W, H)

    const sk = this.squishIndex
    const squishing =
      sk >= 0 && (this.g?.intent === "squish" || !this.squish.atRest)
    this.dbg.q = squishing ? this.squish.value : q
    this.dbg.left = sk > 0 ? this.ripples[sk - 1].value : 0
    this.dbg.right = sk >= 0 && sk < n - 1 ? this.ripples[sk + 1].value : 0
    this.dbg.over = over
    this.dbg.active = active
    this.dbg.scale = 1

    for (let i = 0; i < n; i++) {
      const p = this.photos[i]
      // Edge ripple: past either end, spacing stretches with a falloff from
      // the edge instead of the strip translating as one rigid block.
      const fall =
        over < 0
          ? Math.exp(-i * 0.45)
          : over > 0
            ? Math.exp(-(n - 1 - i) * 0.45)
            : 0
      const pos = Tc + over * fall

      const g = this.grid.rects[i]
      const gridR = { x: g.x, y: g.y - S, w: g.w, h: g.h }
      if (i !== openI && pe > 1e-5 && L < 1) {
        const e = exitOffset(gridR, gox, goy, W, H)
        const d = SCATTER_STAGGER * clamp(e.dist / diag, 0, 1)
        const k = smoothstep((pe - d) / (1 - d))
        gridR.x += e.x * k
        gridR.y += e.y * k
      }
      const carR = carouselRect(p, i, pos, this.cm, this.stage)
      carR.x +=
        this.ripples[i].value +
        this.shift.value +
        Math.sign(i - openI) * growHalf
      if (i === this.squishIndex) {
        // Shrink toward the baseline: bottom edge and centre stay put.
        const s = squishScale(this.squish.value)
        const w = carR.w * s
        const h = carR.h * s
        carR.x += (carR.w - w) / 2
        carR.y += carR.h - h
        carR.w = w
        carR.h = h
      }
      let r: Rect = L <= 0 ? gridR : L >= 1 ? carR : mixRect(gridR, carR, L)
      const source = r

      // In the grid only the opened card focuses; in the carousel the whole
      // strip blends into a full-size pager centred on the transport.
      const wf = P * mix(i === openI ? 1 : 0, 1, L)
      let target: Rect | null = null
      if (wf > 1e-5 || i === active) {
        const fpos = mix(openI, pos, L)
        let f = focusRect(p, i, fpos, this.fm, this.stage)
        // The pan rides on the pager too, so blending toward it never cancels
        // the pan out: the opening card's x is exactly the strip's x.
        f.x += this.shift.value * L
        if (i === openI && art) {
          // The text column hangs off the unscaled hero and scrolls 1:1.
          const fr = this.articleFrame(i)
          textX = f.x + f.w / 2 - fr.colW / 2
          textY = f.y + f.h + articleGap(this.stage) - R
          this.articleSpan = {
            l: Math.min(textX, f.x),
            r: Math.max(textX + fr.colW, f.x + f.w),
          }
          // The hero scrolls with the page, but once it's out of view it
          // parks just above the stage — so closing from deep in an article
          // drops it in from the top edge instead of from thousands of px.
          const lift = Math.min(R, f.y + f.h + HERO_PARK)
          const fw = f.w * dragScale
          const fh = f.h * dragScale
          // Shrink toward the bottom edge so it stays attached to the title.
          f = {
            x: f.x + (f.w - fw) / 2,
            y: f.y - lift + (f.h - fh),
            w: fw,
            h: fh,
          }
        } else if (i === openI) {
          const cx = f.x + f.w / 2 + dX
          const cy = f.y + f.h / 2 + dY
          const fw = f.w * dragScale
          const fh = f.h * dragScale
          f = { x: cx - fw / 2, y: cy - fh / 2, w: fw, h: fh }
        }
        target = f
        if (wf > 1e-5) {
          r = mixFocus(r, f, i === openI ? wf : Math.pow(wf, NEIGHBOUR_LAG), L)
        }
      }

      let scaleMul = i === openI ? mix(1, dragScale, wf) : 1
      if (i === this.pressIndex && press > 0.0005) {
        const k = 1 - 0.035 * press
        const ox = r.x + r.w * this.tapOrigin.x
        const oy = r.y + r.h * this.tapOrigin.y
        r = {
          x: ox + (r.x - ox) * k,
          y: oy + (r.y - oy) * k,
          w: r.w * k,
          h: r.h * k,
        }
        scaleMul *= k
      }
      this.rects[i] = r

      if (i === active) {
        this.dbg.src = source
        this.dbg.tgt = target
        this.dbg.cur = r
        this.dbg.scale = scaleMul
      }

      this.writeCard(i, r, W, H, i === openI && P > 0.002 ? 30 : 10)
    }

    this.renderCaption(active, P, q)
    this.renderArticles(P, qe, textX, textY)
    this.renderCounter(active, L)
    this.renderPanel()
  }

  private writeCard(i: number, r: Rect, W: number, H: number, z: number) {
    const el = this.el.cards[i]
    const w = this.writes[i]
    const s = r.w / this.base[i].w
    const vis = !(
      r.x > W + 40 ||
      r.x + r.w < -40 ||
      r.y > H + 40 ||
      r.y + r.h < -40
    )
    if (vis !== w.vis) {
      el.style.visibility = vis ? "visible" : "hidden"
      w.vis = vis
    }
    if (!vis) return
    const t = `translate3d(${r.x.toFixed(2)}px,${r.y.toFixed(2)}px,0) scale(${s.toFixed(5)})`
    if (t !== w.t) {
      el.style.transform = t
      w.t = t
    }
    const rad = `${(RADIUS / Math.max(s, 0.01)).toFixed(1)}px`
    if (rad !== w.r) {
      el.style.borderRadius = rad
      w.r = rad
    }
    if (z !== w.z) {
      el.style.zIndex = String(z)
      w.z = z
    }
  }

  private renderArticles(P: number, qe: number, x: number, y: number) {
    const rise = this.reduced ? 0 : TEXT_RISE
    const fade = 1 - Math.min(1, qe * 1.2)
    this.el.articles.forEach((a, k) => {
      if (!a) return
      const on = k === this.openIndex && (this.isOpen || P > 0.002)
      this.css(a, "visibility", on ? "visible" : "hidden")
      this.css(a, "pointer-events", on && this.isOpen ? "auto" : "none")
      if (!on) return
      this.css(
        a,
        "transform",
        `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`
      )
      this.articleParts[k].forEach((part, j) => {
        const start = TEXT_IN + TEXT_STAGGER * j
        const t = smoothstep((P - start) / (1 - start))
        this.css(part, "opacity", (t * fade).toFixed(3))
        this.css(
          part,
          "transform",
          `translate3d(0,${((1 - t) * rise).toFixed(2)}px,0)`
        )
      })
    })
  }

  private renderCaption(active: number, P: number, q: number) {
    const c = this.el.caption
    const o = P * (1 - Math.min(1, q * 1.4)) * (this.isArticle(active) ? 0 : 1)
    c.style.opacity = o.toFixed(3)
    c.style.visibility = o > 0.01 ? "visible" : "hidden"
    if (o <= 0.01) return
    if (active !== this.captionIndex) {
      c.textContent = this.photos[active]?.title ?? ""
      this.captionIndex = active
    }
    const r = this.rects[active]
    if (r) {
      c.style.transform = `translate3d(${(r.x + r.w / 2).toFixed(1)}px,${(r.y + r.h + 14).toFixed(1)}px,0) translateX(-50%)`
    }
  }

  private renderCounter(active: number, L: number) {
    const c = this.el.counter
    if (!c) return
    c.style.opacity = L.toFixed(3)
    if (active !== this.counterIndex) {
      const n = this.photos.length
      c.textContent = `${String(active + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`
      this.counterIndex = active
    }
  }

  private renderPanel() {
    const p = this.el.panel
    if (!p) return
    const v = this.panel.value
    p.style.opacity = v.toFixed(3)
    p.style.transform = `translateY(${((1 - v) * -6).toFixed(2)}px) scale(${(0.97 + 0.03 * v).toFixed(4)})`
    p.style.visibility = v > 0.001 ? "visible" : "hidden"
    p.style.pointerEvents = this.panel.target === 1 ? "auto" : "none"
    if (v > 0.001) this.renderReadouts()
  }

  private renderReadouts() {
    const n = this.photos.length
    const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—")
    const d = this.dbg
    const showRects = this.layout.value >= 0.02 || this.open.value > 0.0005
    const pair = (a?: number, b?: number, dd = 1) =>
      a === undefined || b === undefined ? "—" : `${f(a, dd)} / ${f(b, dd)}`
    const g = this.g
    const tO = this.tapOrigin
    const set: Record<string, string> = {
      p: f(this.open.value, 4),
      pTarget: f(this.open.target, 4),
      pVel: `${f(this.open.velocity, 4)} p/s`,
      source: showRects && d.src ? pair(d.src.w, d.src.h) : "—",
      target: showRects && d.tgt ? pair(d.tgt.w, d.tgt.h) : "—",
      current: showRects && d.cur ? pair(d.cur.x, d.cur.y) : "—",
      currentSize: showRects && d.cur ? pair(d.cur.w, d.cur.h) : "—",
      scale: showRects ? f(d.scale, 4) : "—",
      vecTarget: this.vectorTarget,
      vecVel: `${pair(this.drag.x.velocity, this.drag.y.velocity)} px/s`,
      stage: `${f(xWeight(this.open.value), 3)} / ${f(yWeight(this.open.value), 3)}`,
      intent: g
        ? g.intent
        : this.stats.intent === "idle"
          ? "idle"
          : `${this.stats.intent} (released)`,
      tapOrigin: `${f(tO.x * 100)}% / ${f(tO.y * 100)}%`,
      dragDist: `${f(this.stats.dragDistance)} px`,
      releaseVel: `${f(this.stats.releaseVelocity, 3)} px/ms`,
      pull: f(d.q, 4),
      ripple: `${f(d.left)} / ${f(d.right)} px`,
      squishScale:
        this.squishIndex >= 0
          ? `${f(squishScale(this.squish.value), 4)} · #${this.squishIndex + 1}`
          : "—",
      edge: f(d.over, 4),
      distCommit: `${f(this.distanceCommit)} px`,
      velCommit: `${f(VELOCITY_COMMIT, 2)} px/ms`,
      layout: f(this.layout.value, 4),
      layoutVel: `${f(this.layout.velocity, 4)} p/s`,
      transport: f(
        clamp(this.transport.value, 0, n - 1) / Math.max(1, n - 1),
        4
      ),
      transportIdx: `${f(this.transport.value, 3)} → ${f(this.transport.target, 0)}`,
      transportVel: `${f(this.transport.velocity, 3)} idx/s`,
      shift: `${f(this.shift.value)} px`,
      scroll: `${f(this.scroll.value)} → ${f(this.scroll.target)} px`,
      read: this.isArticle(this.openIndex)
        ? `${f(this.read.value)} / ${f(this.readMax)} px`
        : "—",
      readVel: `${f(this.read.velocity)} px/s`,
      textIn: (() => {
        const t = (j: number) =>
          smoothstep(
            (this.open.value - (TEXT_IN + TEXT_STAGGER * j)) /
              (1 - (TEXT_IN + TEXT_STAGGER * j))
          )
        return `${f(t(0), 3)} / ${f(t(1), 3)}`
      })(),
      pullCommit: `${f(this.pullCommit)} px`,
      springs: `${this.loop.activeCount} / ${this.loop.count}`,
      fps: f(this.loop.fps, 0),
    }
    for (const k in set) {
      const el = this.el.readouts[k]
      if (el && this.readoutCache[k] !== set[k]) {
        el.textContent = set[k]
        this.readoutCache[k] = set[k]
      }
    }
  }

  // ───────────────────────────────────────────── pointer

  private onPointerDown = (e: PointerEvent) => {
    if (this.g) return
    if (e.pointerType === "mouse" && e.button !== 0) return
    const t = e.target as Element
    if (t.closest("[data-ui]")) return
    const inArticle = this.articleOpen
    if (inArticle && t.closest("[data-article] :is(a, button, input)")) return
    // Mouse on article text selects it (the wheel scrolls). Touch and pen
    // drag the page like everywhere else in the gallery.
    if (inArticle && e.pointerType === "mouse" && t.closest("[data-article]"))
      return
    const cardEl = t.closest<HTMLElement>("[data-index]")
    const card = cardEl ? Number(cardEl.dataset.index) : -1
    const { x, y } = this.local(e)

    let caught: Gesture["caught"] = "none"
    if (!this.isOpen && card === this.openIndex && this.open.value > 0.15) {
      // Catch a card mid-close: p reverses with the velocity it has.
      this.reopen()
      caught = "open"
    } else if (inArticle) {
      if (Math.abs(this.read.velocity) > 120) {
        this.read.track(this.read.value, 0)
        caught = "read"
      }
    } else if (!this.isOpen) {
      if (this.mode === "carousel") this.absorbShift()
      if (this.mode === "carousel" && Math.abs(this.transport.velocity) > 0.8) {
        this.transport.track(this.transport.value, 0)
        caught = "transport"
      } else if (this.mode === "grid" && Math.abs(this.scroll.velocity) > 120) {
        this.scroll.track(this.scroll.value, 0)
        caught = "scroll"
      }
    }

    const tapCard = this.isOpen ? this.openIndex : card
    const r = tapCard >= 0 ? this.rects[tapCard] : null
    if (r) {
      this.tapOrigin = {
        x: clamp((x - r.x) / r.w, 0, 1),
        y: clamp((y - r.y) / r.h, 0, 1),
      }
    }
    if (card >= 0 && !this.isOpen && caught === "none") {
      this.pressIndex = card
      this.press.configure(PRESS)
      this.press.setTarget(1)
    }

    try {
      this.el.stage.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort */
    }
    this.tracker.reset(e.timeStamp, x, y)
    this.stats.dragDistance = 0
    this.g = {
      id: e.pointerId,
      x0: x,
      y0: y,
      ax: x,
      ay: y,
      x,
      y,
      intent: "pending",
      card,
      caught,
      startT: 0,
      startS: 0,
      startD: { x: 0, y: 0 },
      startQ: 0,
      startR: 0,
      t0: e.timeStamp,
    }
  }

  private stride(intent: Intent) {
    return intent === "page" ? this.fm.stride : this.cm.stride
  }

  private onPointerMove = (e: PointerEvent) => {
    const g = this.g
    if (!g || e.pointerId !== g.id) return
    const { x, y } = this.local(e)
    this.tracker.push(e.timeStamp, x, y)
    g.x = x
    g.y = y
    const n = this.photos.length

    if (g.intent === "pending") {
      const dx = x - g.x0
      const dy = y - g.y0
      if (Math.hypot(dx, dy) < TAP_SLOP) return
      if (this.articleOpen) {
        g.intent = "read"
      } else if (this.isOpen) {
        g.intent =
          this.mode === "carousel" && Math.abs(dx) > Math.abs(dy)
            ? "page"
            : "dismiss"
      } else if (this.mode === "carousel") {
        // Pulling a card up or down squishes it; anything else scrubs the
        // strip. A different card can only take over the squish once the
        // previous one has (nearly) settled, so no card ever pops back to
        // full size.
        const canSquish =
          g.card >= 0 &&
          g.caught === "none" &&
          Math.abs(dy) > Math.abs(dx) &&
          (g.card === this.squishIndex || Math.abs(this.squish.value) < 0.02)
        g.intent = canSquish ? "squish" : "scrub"
        if (canSquish && g.card !== this.squishIndex) {
          this.squishIndex = g.card
          this.squish.jump(0)
          this.configureRipples()
        }
      } else {
        g.intent = "scroll"
      }
      // Anchor here so the content doesn't jump by the slop distance, and
      // resume from wherever the spring was — including mid-rubber-band.
      g.ax = x
      g.ay = y
      const st = this.stride(g.intent)
      g.startT =
        unrubberClamp(
          this.transport.value * st,
          0,
          (n - 1) * st,
          this.stage.w
        ) / st
      g.startS = unrubberClamp(
        this.scroll.value,
        0,
        this.grid.maxScroll,
        this.stage.h
      )
      g.startD = { x: this.drag.x.value, y: this.drag.y.value }
      g.startQ = this.squish.value
      g.startR = unrubberClamp(this.read.value, 0, this.readMax, this.stage.h)
      this.press.setTarget(0)
    }

    const v = this.tracker.velocity(e.timeStamp)
    const dx = x - g.ax
    const dy = y - g.ay
    this.stats.dragDistance = Math.hypot(x - g.x0, y - g.y0)

    switch (g.intent) {
      case "scroll": {
        const raw = g.startS - dy
        this.scroll.track(
          rubberClamp(raw, 0, this.grid.maxScroll, this.stage.h),
          -v.y * 1000
        )
        break
      }
      case "scrub":
      case "page": {
        const st = this.stride(g.intent)
        const rawPx = g.startT * st - dx
        const val = rubberClamp(rawPx, 0, (n - 1) * st, this.stage.w) / st
        this.transport.track(val, (-v.x * 1000) / st)
        break
      }
      case "read": {
        const raw = g.startR - dy
        this.read.track(
          rubberClamp(raw, 0, this.readMax, this.stage.h),
          -v.y * 1000
        )
        break
      }
      case "squish": {
        // q is pull distance over the commit distance (down +, up −); the
        // exponential in squishScale supplies the resistance, so tracking
        // stays 1:1 in q.
        const c = this.distanceCommit
        const q = g.startQ + dy / c
        this.squish.track(q, (v.y * 1000) / c)
        break
      }
      case "dismiss": {
        this.vectorTarget = "center"
        this.drag.track(
          g.startD.x + dx,
          g.startD.y + dy,
          v.x * 1000,
          v.y * 1000
        )
        break
      }
    }
  }

  private onLostCapture = (e: PointerEvent) => {
    if (this.g && e.pointerId === this.g.id) this.finish(e, true)
  }

  private onPointerUp = (e: PointerEvent) => {
    const g = this.g
    if (!g || e.pointerId !== g.id) return
    this.finish(e, e.type === "pointercancel")
  }

  private finish(e: PointerEvent, cancelled: boolean) {
    const g = this.g
    if (!g) return
    this.g = null
    const n = this.photos.length
    const v = this.tracker.velocity(e.timeStamp)
    const speed = Math.hypot(v.x, v.y)
    this.stats.releaseVelocity = speed
    this.stats.intent = g.intent
    this.press.setTarget(0)
    const proj = this.reduced ? 0 : 1

    switch (g.intent) {
      case "pending": {
        if (g.caught === "transport") {
          this.transport.configure(this.cfg(this.tuning.transport))
          this.transport.release(
            clamp(Math.round(this.transport.value), 0, n - 1),
            0
          )
          break
        }
        if (g.caught === "scroll") {
          this.scroll.configure(MOMENTUM)
          this.scroll.release(
            clamp(this.scroll.value, 0, this.grid.maxScroll),
            0
          )
          break
        }
        if (g.caught === "read") {
          this.read.configure(MOMENTUM)
          this.read.release(clamp(this.read.value, 0, this.readMax), 0)
          break
        }
        if (g.caught === "open" || cancelled) break
        if (this.articleOpen) {
          // Quick taps on the hero or out in the side margins dismiss. A tap
          // on the text (or the gap between hero and title) never does, so
          // reading can't close it by accident.
          const quick = e.timeStamp - g.t0 < ARTICLE_TAP_MS
          const onHero = g.card === this.openIndex
          const inMargin = g.x < this.articleSpan.l || g.x > this.articleSpan.r
          if (!cancelled && quick && (onHero || inMargin)) this.close(false)
          break
        }
        if (this.isOpen) this.close(false)
        else if (g.card >= 0) this.openCard(g.card)
        break
      }
      case "read": {
        const R = this.read.value
        const commit =
          !cancelled &&
          R < -8 &&
          ((-R > this.pullCommit && v.y > -0.2) || v.y > READ_VELOCITY_COMMIT)
        if (commit) {
          // Same hand-off as the photo dismiss: the page springs back to its
          // top carrying the throw while p falls, so the hero arcs home.
          this.close(true)
          this.read.configure(
            this.cfg({
              response: this.tuning.drag.response,
              bounce: this.tuning.drag.bounce * CLOSE_BOUNCE,
            })
          )
          this.read.release(0, -v.y * 1000)
        } else {
          const target = clamp(
            R - v.y * SCROLL_PROJECTION_MS * proj,
            0,
            this.readMax
          )
          this.read.configure(this.cfg(MOMENTUM))
          this.read.release(target, -v.y * 1000)
        }
        break
      }
      case "squish": {
        // Released with the finger's velocity: the card springs back up,
        // overshoots slightly past full size, and the neighbours ripple.
        this.squish.configure(this.cfg(this.tuning.squish))
        this.squish.release(0, (v.y * 1000) / this.distanceCommit)
        break
      }
      case "scroll": {
        const target = clamp(
          this.scroll.value - v.y * SCROLL_PROJECTION_MS * proj,
          0,
          this.grid.maxScroll
        )
        this.scroll.configure(this.cfg(MOMENTUM))
        this.scroll.release(target, -v.y * 1000)
        break
      }
      case "scrub": {
        const st = this.cm.stride
        const projected =
          this.transport.value + (-v.x * SCRUB_PROJECTION_MS * proj) / st
        const idx = clamp(Math.round(projected), 0, n - 1)
        this.transport.configure(this.cfg(this.tuning.transport))
        this.transport.release(idx, (-v.x * 1000) / st)
        break
      }
      case "page": {
        const st = this.fm.stride
        const dx = g.x - g.ax
        const start = clamp(Math.round(g.startT), 0, n - 1)
        let dir = 0
        if (Math.abs(v.x) > PAGE_VELOCITY_COMMIT) dir = v.x < 0 ? 1 : -1
        else if (Math.abs(dx) > this.pageCommit) dir = dx < 0 ? 1 : -1
        const idx = clamp(start + dir, 0, n - 1)
        this.openIndex = idx
        this.transport.configure(this.cfg(this.tuning.transport))
        this.transport.release(idx, (-v.x * 1000) / st)
        break
      }
      case "dismiss": {
        const dx = this.drag.x.value
        const dy = this.drag.y.value
        const dist = Math.hypot(dx, dy)
        const radial = dist > 0 ? (v.x * dx + v.y * dy) / dist : 0
        const commit =
          !cancelled &&
          ((dist > this.distanceCommit && radial > -0.2) ||
            radial > VELOCITY_COMMIT)
        this.vectorTarget = commit ? "source" : "center"
        if (commit) this.close(true)
        const db = this.tuning.drag.bounce
        this.drag.configure(
          this.cfg({
            response: this.tuning.drag.response,
            bounce: commit ? db * CLOSE_BOUNCE : db,
          })
        )
        // Either way the offset springs home carrying the throw: on commit
        // p is falling too, so the card arcs back into its slot.
        this.drag.release(0, 0, v.x * 1000, v.y * 1000)
        break
      }
    }
  }

  // ───────────────────────────────────────────── wheel + keys

  private onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return
    e.preventDefault()
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.stage.h : 1
    const dx = e.deltaX * k
    const dy = e.deltaY * k
    const n = this.photos.length

    if (this.articleOpen) {
      this.read.configure(this.cfg(FOLLOW))
      this.read.setTarget(clamp(this.read.target + dy, 0, this.readMax))
      return
    }

    if (this.isOpen) {
      this.wheelAcc.x += dx
      this.wheelAcc.y += dy
      clearTimeout(this.wheelLockTimer)
      this.wheelLockTimer = window.setTimeout(() => {
        this.wheelLocked = false
        this.wheelAcc = { x: 0, y: 0 }
      }, 220)
      if (this.wheelLocked) return
      if (this.mode === "carousel" && Math.abs(this.wheelAcc.x) > 50) {
        this.step(this.wheelAcc.x > 0 ? 1 : -1)
        this.wheelLocked = true
      } else if (Math.abs(this.wheelAcc.y) > 70) {
        this.close(false)
        this.wheelLocked = true
      }
      return
    }

    if (this.mode === "carousel") {
      this.absorbShift()
      const d = Math.abs(dx) > Math.abs(dy) ? dx : dy
      const st = this.cm.stride
      this.transport.configure(this.cfg(FOLLOW))
      this.transport.setTarget(
        clamp(this.transport.target + d / st, -0.2, n - 1 + 0.2)
      )
      clearTimeout(this.wheelTimer)
      this.wheelTimer = window.setTimeout(() => {
        // Hand off from the follow spring to the snap spring mid-flight.
        this.transport.configure(this.cfg(this.tuning.transport))
        this.transport.setTarget(
          clamp(Math.round(this.transport.target), 0, n - 1)
        )
      }, 130)
    } else {
      this.scroll.configure(this.cfg(FOLLOW))
      this.scroll.setTarget(
        clamp(this.scroll.target + dy, 0, this.grid.maxScroll)
      )
    }
  }

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === "INPUT" || t.isContentEditable)) return
    if (this.articleOpen && e.key !== "Escape") {
      const page = this.stage.h * 0.85
      const max = this.readMax
      const by: Record<string, number> = {
        ArrowDown: 72,
        ArrowUp: -72,
        PageDown: page,
        PageUp: -page,
      }
      if (e.key === " " && t?.tagName !== "BUTTON")
        by[" "] = e.shiftKey ? -page : page
      let next: number | null = null
      if (e.key in by) next = this.read.target + by[e.key]
      else if (e.key === "Home") next = 0
      else if (e.key === "End") next = max
      if (next !== null) {
        e.preventDefault()
        this.read.configure(this.cfg(MOMENTUM))
        this.read.setTarget(clamp(next, 0, max))
      }
      return
    }
    if (e.key === "Escape" && this.isOpen) {
      this.close(false)
    } else if (e.key === "ArrowRight") {
      this.step(1)
      if (this.mode === "carousel") e.preventDefault()
    } else if (e.key === "ArrowLeft") {
      this.step(-1)
      if (this.mode === "carousel") e.preventDefault()
    }
  }

  private onCardKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return
    const el = (e.target as Element).closest<HTMLElement>("[data-index]")
    if (!el) return
    e.preventDefault()
    const i = Number(el.dataset.index)
    if (this.isOpen && this.openIndex === i) this.close(false)
    else this.openCard(i)
  }

  private onFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement
    if (
      this.articleOpen &&
      target.closest("[data-article]") &&
      !target.matches("[data-article]")
    ) {
      const r = target.getBoundingClientRect()
      const top = r.top - this.origin.y
      const bottom = r.bottom - this.origin.y
      let d = 0
      if (top < 72) d = top - 72
      else if (bottom > this.stage.h - 48) d = bottom - (this.stage.h - 48)
      if (d) {
        this.read.configure(this.cfg(MOMENTUM))
        this.read.setTarget(clamp(this.read.target + d, 0, this.readMax))
      }
      return
    }
    const el = (e.target as Element).closest<HTMLElement>("[data-index]")
    if (!el || !el.matches(":focus-visible")) return
    const i = Number(el.dataset.index)
    if (this.mode === "carousel") {
      if (!this.isOpen) {
        this.absorbShift()
        this.transport.configure(this.cfg(this.tuning.transport))
        this.transport.setTarget(i)
      }
    } else {
      const r = this.grid.rects[i]
      const S = this.scroll.target
      let next = S
      if (r.y < S + 16) next = r.y - 24
      else if (r.y + r.h > S + this.stage.h - 16)
        next = r.y + r.h - this.stage.h + 24
      if (next !== S) {
        this.scroll.configure(this.cfg(MOMENTUM))
        this.scroll.setTarget(clamp(next, 0, this.grid.maxScroll))
      }
    }
  }
}

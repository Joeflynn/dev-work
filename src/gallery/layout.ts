import type { Rect } from "./motion/math"
import type { Photo } from "./photos"

/**
 * Pure layout functions. Each returns the rect a card *would* occupy in one
 * state; the controller blends between them with spring progress values.
 * Every rect keeps the photo's aspect ratio, so a card can always be drawn as
 * a translate + uniform scale of a single base element.
 */

export interface Stage {
  w: number
  h: number
}

export interface GridLayout {
  rects: Rect[]
  contentHeight: number
  maxScroll: number
}

export function gridLayout(photos: Photo[], stage: Stage): GridLayout {
  const cols = stage.w < 560 ? 2 : stage.w < 960 ? 3 : 4
  const pad = stage.w < 560 ? 12 : 24
  const gap = stage.w < 560 ? 8 : 12
  const top = pad
  const colW = (stage.w - pad * 2 - gap * (cols - 1)) / cols
  const heights = new Array(cols).fill(top)
  const rects = photos.map((p) => {
    let c = 0
    for (let i = 1; i < cols; i++) if (heights[i] < heights[c] - 1) c = i
    const h = colW * (p.height / p.width)
    const r = { x: pad + c * (colW + gap), y: heights[c], w: colW, h }
    heights[c] += h + gap
    return r
  })
  const contentHeight = Math.max(...heights) - gap + pad
  return {
    rects,
    contentHeight,
    maxScroll: Math.max(0, contentHeight - stage.h),
  }
}

export interface CarouselMetrics {
  cardW: number
  stride: number
  baseline: number
}

/** Equal-width cards, bottom-aligned on a shared baseline. */
export function carouselMetrics(
  photos: Photo[],
  stage: Stage
): CarouselMetrics {
  const cardW =
    stage.w < 560
      ? Math.min(stage.w * 0.46, stage.h * 0.3)
      : Math.max(132, Math.min(240, stage.w * 0.2, stage.h * 0.32))
  const gap = stage.w < 560 ? 12 : 18
  const tallest = Math.max(...photos.map((p) => p.height / p.width)) * cardW
  const baseline = stage.h / 2 + tallest / 2
  return { cardW, stride: cardW + gap, baseline }
}

export function carouselRect(
  p: Photo,
  i: number,
  transport: number,
  m: CarouselMetrics,
  stage: Stage
): Rect {
  const h = m.cardW * (p.height / p.width)
  return {
    x: stage.w / 2 - m.cardW / 2 + (i - transport) * m.stride,
    y: m.baseline - h,
    w: m.cardW,
    h,
  }
}

export interface FocusMetrics {
  maxW: number
  maxH: number
  centerY: number
  stride: number
}

export function focusMetrics(photos: Photo[], stage: Stage): FocusMetrics {
  const padX = stage.w < 560 ? 16 : 72
  const top = stage.w < 560 ? 64 : 72
  const bottom = stage.w < 560 ? 88 : 96
  const maxW = stage.w - padX * 2
  const maxH = Math.max(120, stage.h - top - bottom)
  let widest = 0
  for (const p of photos) widest = Math.max(widest, fitSize(p, maxW, maxH).w)
  return {
    maxW,
    maxH,
    centerY: top + maxH / 2,
    // Neighbours sit just past the stage edge, so paging slides them in.
    stride: stage.w / 2 + widest / 2 + 32,
  }
}

export function fitSize(p: Photo, maxW: number, maxH: number) {
  const a = p.width / p.height
  let w = maxW
  let h = w / a
  if (h > maxH) {
    h = maxH
    w = h * a
  }
  return { w, h }
}

export function focusRect(
  p: Photo,
  i: number,
  position: number,
  m: FocusMetrics,
  stage: Stage
): Rect {
  const { w, h } = fitSize(p, m.maxW, m.maxH)
  return {
    x: stage.w / 2 - w / 2 + (i - position) * m.stride,
    y: m.centerY - h / 2,
    w,
    h,
  }
}

/**
 * Article reading column. It matches the hero's width when that's a
 * comfortable measure (so title and body line up with the image edges, as in
 * the focus view), and clamps otherwise — wide heroes get a narrower column
 * centred under them, tall heroes a slightly wider one.
 */
export function articleColumn(heroW: number, stage: Stage) {
  const pad = stage.w < 560 ? 16 : 72
  return Math.min(stage.w - pad * 2, Math.max(560, Math.min(760, heroW)))
}

/** Space between the bottom of the hero and the article title. */
export const articleGap = (stage: Stage) => (stage.w < 560 ? 28 : 40)

/** Space below the last line of the article when scrolled to the end. */
export const articleTail = (stage: Stage) => (stage.w < 560 ? 64 : 120)

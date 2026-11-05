export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v))

export const mix = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Apple's rubber-band: past a bound, displacement is compressed so the
 * further you pull the less it moves. `dim` is the size of the scroll view.
 */
export function rubber(overshoot: number, dim: number, c = 0.55) {
  const sign = Math.sign(overshoot)
  const x = Math.abs(overshoot)
  return sign * ((x * dim * c) / (dim + c * x))
}

/** Clamp to [lo, hi] with a rubber-band beyond either edge. */
export function rubberClamp(v: number, lo: number, hi: number, dim: number) {
  if (v < lo) return lo + rubber(v - lo, dim)
  if (v > hi) return hi + rubber(v - hi, dim)
  return v
}

/** Inverse of rubberClamp, so a gesture can resume from a rubber-banded value. */
export function unrubberClamp(v: number, lo: number, hi: number, dim: number) {
  const inv = (r: number) => {
    const sign = Math.sign(r)
    const y = Math.abs(r)
    const c = 0.55
    if (y >= dim * 0.999) return sign * dim * 50
    return sign * ((y * dim) / (dim * c - c * y))
  }
  if (v < lo) return lo + inv(v - lo)
  if (v > hi) return hi + inv(v - hi)
  return v
}

export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const mixRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
  w: mix(a.w, b.w, t),
  h: mix(a.h, b.h, t),
})

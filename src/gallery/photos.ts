import type { CSSProperties } from "react"

import type { Article } from "./articles"

/** A rectangle in the item's own units — the same units as `width`/`height`. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface RiveSpec {
  /** URL of the .riv, loaded only when the item opens. */
  src: string
  artboard?: string
  stateMachine?: string
  /**
   * Where the artboard sits in the card. Omit for full-bleed. Small widgets
   * sit centred on a backdrop so they read at a sensible size.
   */
  art?: Box
  /**
   * The canvas rect, when it should be larger than `art` — room for content
   * that spills past the artboard edge, like an open dropdown's list.
   */
  canvas?: Box
  /** Where the artboard anchors inside a canvas larger than it. */
  align?: "center" | "top"
  /** Backdrop behind a widget that doesn't fill its card. */
  bg?: string
  /**
   * The file's scripts draw with the GPU (WGSL shaders, 3D). Needs the
   * runtime's experimental GPU canvas, so it's opt-in per file.
   */
  gpu?: boolean
}

export interface Photo {
  /** Preview image, shown in the grid and until the Rive file is playing. */
  src: string
  title: string
  /** When present, opening this item reads as an article, not a lightbox. */
  article?: Article
  /** When present, opening this item plays the Rive file over the preview. */
  rive?: RiveSpec
  /** Natural pixel size — the aspect ratio is preserved in every layout. */
  width: number
  height: number
}

/** A box as CSS percentages of the card. */
export function boxStyle(b: Box | undefined, p: Photo): CSSProperties {
  // Explicit width/height: a canvas sized only by `inset` falls back to its
  // drawing-surface size, which then feeds back into the next resize.
  if (!b) return { left: 0, top: 0, width: "100%", height: "100%" }
  return {
    left: `${(b.x / p.width) * 100}%`,
    top: `${(b.y / p.height) * 100}%`,
    width: `${(b.w / p.width) * 100}%`,
    height: `${(b.h / p.height) * 100}%`,
  }
}

const BASE = `${import.meta.env.BASE_URL}rive/`
const WIDGET_BG = "#1d1d1d"

/** An artboard that fills its whole card. */
function full(
  slug: string,
  title: string,
  width: number,
  height: number,
  rive: Omit<RiveSpec, "src"> = {}
): Photo {
  return {
    src: `${BASE}${slug}.jpg`,
    title,
    width,
    height,
    rive: {
      src: `${BASE}${slug}.riv`,
      stateMachine: "State Machine 1",
      // Shows in the 24px padding around every animation.
      bg: WIDGET_BG,
      ...rive,
    },
  }
}

/** A small artboard centred on a backdrop of `width` × `height`. */
function widget(
  slug: string,
  title: string,
  width: number,
  height: number,
  art: Box,
  rive: Omit<RiveSpec, "src" | "art"> = {}
): Photo {
  return full(slug, title, width, height, { art, ...rive })
}

/**
 * Rive examples from the joeflynn workspace, exported with the Rive CLI
 * (`rive create --from-remote-file`, `rive --publish`, `rive --screenshot`)
 * into public/rive.
 */
export const PHOTOS: Photo[] = [
  full("game-controller", "Game controller", 1600, 1200, { artboard: "Main" }),
  full("dynamic-icon", "Dynamic icon", 500, 500, { artboard: "Main" }),
  widget(
    "styled-slider",
    "Styled slider",
    392,
    294,
    { x: 98, y: 105, w: 196, h: 84 },
    // Wider than the artboard so the thumb's glow isn't clipped at the ends.
    { artboard: "Main", canvas: { x: 68, y: 105, w: 256, h: 84 } }
  ),
  full("radial-menu", "Radial menu", 630, 630, { artboard: "Main" }),
  full("project-card", "Project card", 1000, 1000, {
    artboard: "Project-Card",
  }),
  widget(
    "num-input",
    "Number input",
    640,
    480,
    { x: 108, y: 152, w: 424, h: 176 },
    { artboard: "Main" }
  ),
  full("floppy-disk", "GLB importer", 1920, 1080, {
    artboard: "main",
    stateMachine: "mainSM",
    gpu: true,
  }),
  full("custom-curve-control", "Custom curve control", 800, 800, {
    artboard: "Main",
  }),
  widget(
    "styled-dropdown",
    "Styled dropdown",
    600,
    750,
    { x: 102, y: 120, w: 396, h: 104 },
    // The open list hangs ~500 units below the artboard.
    {
      artboard: "Main",
      canvas: { x: 102, y: 120, w: 396, h: 560 },
      align: "top",
    }
  ),
  full("liquid-glass", "Liquid glass", 280, 232, {
    artboard: "Pixel",
    gpu: true,
  }),
  full("funn", "Funn", 500, 500),
]

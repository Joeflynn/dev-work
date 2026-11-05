import { useState, type RefObject } from "react"

import {
  DEFAULT_TUNING,
  type GalleryController,
  type Tuning,
} from "./controller"

const SECTIONS: { title: string; rows: [key: string, label: string][] }[] = [
  {
    title: "Open",
    rows: [
      ["p", "open progress p"],
      ["pTarget", "spring target"],
      ["pVel", "spring velocity"],
      ["source", "source width / height"],
      ["target", "target width / height"],
      ["current", "current x / y"],
      ["currentSize", "current width / height"],
      ["scale", "scale"],
      ["vecTarget", "vector target"],
      ["vecVel", "vector velocity x / y"],
      ["stage", "x / y·scale weight"],
    ],
  },
  {
    title: "Gesture",
    rows: [
      ["intent", "intent"],
      ["tapOrigin", "tap origin x / y"],
      ["dragDist", "drag distance"],
      ["releaseVel", "release velocity"],
      ["pull", "pull progress q"],
      ["squishScale", "squish scale"],
      ["ripple", "left / right ripple"],
      ["distCommit", "distance commit"],
      ["velCommit", "velocity commit"],
    ],
  },
  {
    title: "Carousel",
    rows: [
      ["layout", "layout progress"],
      ["layoutVel", "layout velocity"],
      ["transport", "transport progress"],
      ["transportIdx", "transport index"],
      ["transportVel", "transport velocity"],
      ["shift", "re-anchor shift"],
      ["edge", "edge overscroll"],
      ["scroll", "grid scroll"],
    ],
  },
  {
    title: "Article",
    rows: [
      ["read", "scroll / max"],
      ["readVel", "scroll velocity"],
      ["textIn", "title / body reveal"],
      ["pullCommit", "pull-to-close commit"],
    ],
  },
  {
    title: "Engine",
    rows: [
      ["springs", "springs moving"],
      ["fps", "frame rate"],
    ],
  },
]

const TUNABLE: [keyof Tuning, string][] = [
  ["open", "open"],
  ["layout", "layout"],
  ["transport", "transport"],
  ["drag", "drag"],
  ["squish", "squish"],
]

interface Props {
  panelRef: RefObject<HTMLDivElement | null>
  readouts: RefObject<Record<string, HTMLElement | null>>
  controller: RefObject<GalleryController | null>
}

export function ValuesPanel({ panelRef, readouts, controller }: Props) {
  const [tuning, setTuning] = useState<Tuning>(() =>
    structuredClone(DEFAULT_TUNING)
  )
  const [slow, setSlow] = useState(false)

  const update = (k: keyof Tuning, field: "response" | "bounce", v: number) => {
    setTuning((t) => ({ ...t, [k]: { ...t[k], [field]: v } }))
    controller.current?.setTuning(k, { [field]: v })
  }

  return (
    <div
      ref={panelRef}
      data-ui
      role="region"
      aria-label="Motion values"
      className="absolute top-16 right-4 z-50 flex max-h-[calc(100svh-5rem)] w-[min(320px,calc(100vw-2rem))] origin-top-right flex-col overflow-hidden rounded-2xl bg-popover font-mono text-[11px] text-popover-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),0_12px_32px_-8px_rgb(0_0_0/0.18)] ring-1 ring-foreground/5"
      style={{ opacity: 0, visibility: "hidden" }}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-medium">Values</span>
        <button
          type="button"
          onClick={() => {
            const next = !slow
            setSlow(next)
            controller.current?.setTimeScale(next ? 0.2 : 1)
          }}
          aria-pressed={slow}
          className="rounded-full px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-foreground aria-pressed:text-background"
        >
          slow-mo 0.2×
        </button>
      </div>
      <div className="overflow-y-auto overscroll-contain px-2 pb-2">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h3 className="px-2 pt-3 pb-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {s.title}
            </h3>
            {s.rows.map(([key, label]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-3 border-b border-border/60 px-2 py-[5px] last:border-0"
              >
                <span className="shrink-0 text-muted-foreground">{label}</span>
                <span
                  ref={(el) => {
                    readouts.current[key] = el
                  }}
                  className="truncate text-right tabular-nums"
                >
                  —
                </span>
              </div>
            ))}
          </section>
        ))}
        <section>
          <h3 className="px-2 pt-3 pb-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Springs · response / bounce
          </h3>
          {TUNABLE.map(([k, label]) => (
            <div
              key={k}
              className="grid grid-cols-[64px_1fr_1fr] items-center gap-2 px-2 py-1.5"
            >
              <span className="text-muted-foreground">{label}</span>
              <Slider
                label={`${label} response`}
                min={0.1}
                max={1.2}
                step={0.01}
                value={tuning[k].response}
                format={(v) => `${v.toFixed(2)}s`}
                onChange={(v) => update(k, "response", v)}
              />
              <Slider
                label={`${label} bounce`}
                min={-0.5}
                max={0.6}
                step={0.01}
                value={tuning[k].bounce}
                format={(v) => v.toFixed(2)}
                onChange={(v) => update(k, "bounce", v)}
              />
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

function Slider(props: {
  label: string
  min: number
  max: number
  step: number
  value: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="sr-only">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-foreground"
      />
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {props.format(props.value)}
      </span>
    </label>
  )
}

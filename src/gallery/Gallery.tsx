import { useEffect, useRef, useState } from "react"
import { GalleryHorizontal, LayoutGrid, X } from "lucide-react"

import { ArticleView } from "./ArticleView"
import { GalleryController, type Mode } from "./controller"
import { boxStyle, PHOTOS } from "./photos"
import { RivePlayer } from "./RivePlayer"

/**
 * React renders the DOM once. After mount, GalleryController owns every
 * moving value and writes transforms directly — no React state changes per
 * frame. React state is only used for discrete UI (mode icon, panel toggle).
 */
export function Gallery() {
  const stageRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  const captionRef = useRef<HTMLDivElement>(null)
  const articleRefs = useRef<(HTMLElement | null)[]>([])
  const controller = useRef<GalleryController | null>(null)
  const [mode, setMode] = useState<Mode>("grid")
  const [article, setArticle] = useState<number | null>(null)
  const [live, setLive] = useState<number | null>(null)
  // The live item whose canvas has fully faded in. Its preview is hidden then:
  // transparent artboards would otherwise show the still frame through.
  const [drawn, setDrawn] = useState<number | null>(null)
  const closable = article !== null || live !== null

  useEffect(() => {
    const c = new GalleryController(
      PHOTOS,
      {
        stage: stageRef.current!,
        cards: cardRefs.current.filter(Boolean) as HTMLElement[],
        caption: captionRef.current!,
        counter: null,
        panel: null,
        readouts: {},
        articles: PHOTOS.map((_, i) => articleRefs.current[i] ?? null),
      },
      {
        onModeChange: setMode,
        onArticleChange: setArticle,
        onLiveChange: setLive,
      }
    )
    controller.current = c
    return () => {
      c.destroy()
      controller.current = null
    }
  }, [])

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 touch-none overflow-hidden bg-background select-none"
    >
      {PHOTOS.map((p, i) => (
        <button
          key={p.src}
          ref={(el) => {
            cardRefs.current[i] = el
          }}
          type="button"
          data-index={i}
          aria-label={p.title}
          className="absolute top-0 left-0 z-10 origin-top-left cursor-pointer overflow-hidden bg-muted will-change-transform outline-none [backface-visibility:hidden] focus-visible:ring-2 focus-visible:ring-foreground/60"
          style={{
            transform: "translate3d(-9999px,0,0)",
            background: p.rive?.bg,
          }}
        >
          {p.rive ? (
            // Rive content sits 24px in from the card edge (at its open size;
            // the inset scales with the card everywhere else).
            <div className="absolute inset-6">
              <img
                src={p.src}
                alt=""
                draggable={false}
                decoding="async"
                className="pointer-events-none absolute object-contain"
                style={{
                  ...boxStyle(p.rive.art, p),
                  visibility: live === i && drawn === i ? "hidden" : undefined,
                }}
              />
              {live === i && (
                <RivePlayer
                  photo={p}
                  onReady={(r) => setDrawn(r ? i : null)}
                />
              )}
            </div>
          ) : (
            <img
              src={p.src}
              alt=""
              draggable={false}
              decoding="async"
              className="pointer-events-none size-full object-cover"
            />
          )}
        </button>
      ))}

      {PHOTOS.map((p, i) =>
        p.article ? (
          <ArticleView
            key={p.src}
            article={p.article}
            index={i}
            articleRef={(el) => {
              articleRefs.current[i] = el
            }}
          />
        ) : null
      )}

      <div
        ref={captionRef}
        aria-live="polite"
        className="pointer-events-none absolute top-0 left-0 z-40 font-mono text-[11px] whitespace-nowrap text-muted-foreground"
        style={{ opacity: 0, visibility: "hidden" }}
      />

      <div
        data-ui
        className="absolute top-4 right-4 z-50 flex items-center gap-2"
      >
        <button
          type="button"
          onClick={() =>
            closable
              ? controller.current?.close(false)
              : controller.current?.toggleMode()
          }
          aria-label={
            closable
              ? article !== null
                ? "Close article"
                : "Close"
              : mode === "grid"
                ? "Show as carousel"
                : "Show as grid"
          }
          className="grid size-9 place-items-center rounded-full bg-popover text-popover-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),0_4px_12px_-4px_rgb(0_0_0/0.16)] ring-1 ring-foreground/5 transition-transform duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 active:scale-[0.96]"
        >
          {closable ? (
            <X className="size-4" strokeWidth={1.75} />
          ) : mode === "grid" ? (
            <GalleryHorizontal className="size-4" strokeWidth={1.75} />
          ) : (
            <LayoutGrid className="size-4" strokeWidth={1.75} />
          )}
        </button>
      </div>
    </div>
  )
}

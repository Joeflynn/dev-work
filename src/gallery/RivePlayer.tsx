import { useEffect, useRef, useState } from "react"
import { Alignment, Fit, Layout, Rive, RuntimeLoader } from "@rive-app/webgl2"
import riveWasm from "@rive-app/webgl2/rive.wasm?url"
import riveFallbackWasm from "@rive-app/webgl2/rive_fallback.wasm?url"

import { boxStyle, type Photo } from "./photos"

// Serve the runtime from this site rather than a third-party CDN.
RuntimeLoader.setWasmUrl(riveWasm)
RuntimeLoader.setWasmFallbackUrl(riveFallbackWasm)

/**
 * The live half of a Rive item. Mounted by the gallery only while the item is
 * open; it fades in over the preview image once the first frame is drawn, and
 * is torn down (WebGL context and all) as soon as the item starts to close.
 */
export function RivePlayer({ photo }: { photo: Photo }) {
  const spec = photo.rive!
  const ref = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = ref.current!
    const layout = new Layout({
      fit: Fit.Contain,
      alignment: spec.align === "top" ? Alignment.TopCenter : Alignment.Center,
    })

    // The card is scaled with a CSS transform while it flies. Size the drawing
    // surface from the layout box (which ignores transforms) so it's sharp at
    // rest, where the card's scale is 1.
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(canvas.offsetWidth * dpr))
      const h = Math.max(1, Math.round(canvas.offsetHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        r.resizeToCanvas()
      }
    }

    const r = new Rive({
      src: spec.src,
      canvas,
      artboard: spec.artboard,
      stateMachine: spec.stateMachine,
      autoplay: true,
      autoBind: true,
      enableGPUCanvas: spec.gpu,
      layout,
      onLoad: () => {
        size()
        requestAnimationFrame(() => setReady(true))
      },
      onLoadError: (e) => console.warn(`Rive: ${spec.src}`, e),
    })

    const ro = new ResizeObserver(size)
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      r.cleanup()
    }
  }, [spec])

  return (
    <canvas
      ref={ref}
      data-rive-live
      className="absolute cursor-auto transition-opacity duration-200 ease-out"
      style={{
        ...boxStyle(spec.canvas ?? spec.art, photo),
        opacity: ready ? 1 : 0,
      }}
    />
  )
}

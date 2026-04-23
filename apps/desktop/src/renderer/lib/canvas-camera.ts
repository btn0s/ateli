import type { Editor } from "tldraw"

export const ZOOM_ANIMATION = { duration: 120 } as const
const ZOOM_FIT_INSET_PX = 32

export type PageBounds = { x: number; y: number; w: number; h: number }

export type FitPageBoundsOptions = {
  maxTargetZoom?: number
  zoomOutFactor?: number
  /**
   * Screen rect (CSS pixels) used for insets and the zoom anchor.
   * Pass the same “lane” as the bottom zoom bar so fit/sel match +/- buttons.
   * Omitted: use the full tldraw viewport.
   */
  screenRect?: PageBounds
}

/**
 * Resolve the center lane (between sidebars) in screen space.
 * Falls back to full tldraw viewport when lane markup is unavailable.
 */
export function getCenterLaneScreenRect(editor: Editor): PageBounds {
  if (typeof document !== "undefined") {
    const lane = document.querySelector<HTMLElement>("[data-center-lane]")
    const rect = lane?.getBoundingClientRect()
    if (rect && rect.width > 0 && rect.height > 0) {
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
    }
  }
  const viewport = editor.getViewportScreenBounds()
  return { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h }
}

/**
 * Fit page-space bounds into the current editor viewport with deterministic
 * target zoom (same math as the canvas “Fit / Sel” controls; avoids
 * `zoomToSelection`’s implicit dual behavior).
 */
export function fitPageBoundsInViewport(
  editor: Editor,
  bounds: PageBounds,
  opts?: FitPageBoundsOptions,
) {
  const rect = opts?.screenRect ?? editor.getViewportScreenBounds()
  const laneCenter = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  const zoomSteps = editor.getCameraOptions().zoomSteps
  const minZoom = zoomSteps[0] ?? 0.1
  const maxZoom = zoomSteps[zoomSteps.length - 1] ?? 8
  const availableW = Math.max(1, rect.w - ZOOM_FIT_INSET_PX * 2)
  const availableH = Math.max(1, rect.h - ZOOM_FIT_INSET_PX * 2)
  const boundsW = Math.max(1, bounds.w)
  const boundsH = Math.max(1, bounds.h)
  const fitZoom = Math.min(
    maxZoom,
    Math.max(minZoom, Math.min(availableW / boundsW, availableH / boundsH)),
  )
  const zoomOutFactor = opts?.zoomOutFactor ?? 1
  const maxTargetZoom = opts?.maxTargetZoom ?? maxZoom
  const targetZoom = Math.max(
    minZoom,
    Math.min(maxZoom, Math.min(maxTargetZoom, fitZoom * zoomOutFactor)),
  )

  const centerX = bounds.x + bounds.w / 2
  const centerY = bounds.y + bounds.h / 2
  editor.setCamera(
    {
      x: laneCenter.x / targetZoom - centerX,
      y: laneCenter.y / targetZoom - centerY,
      z: targetZoom,
    },
    { animation: ZOOM_ANIMATION },
  )
}

/** Zoom to the current selection using bounded viewport camera math. */
export function zoomToSelectionInViewport(
  editor: Editor,
  opts?: {
    maxTargetZoom?: number
    zoomOutFactor?: number
    screenRect?: PageBounds
  },
) {
  const bounds = editor.getSelectionPageBounds()
  if (!bounds) return
  fitPageBoundsInViewport(editor, bounds, opts)
}

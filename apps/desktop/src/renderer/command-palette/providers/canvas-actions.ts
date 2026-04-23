import { Maximize2, Minus, Plus, Scan, SquareDashed } from "lucide-react"
import { ZOOM_ANIMATION, fitPageBoundsInViewport, zoomToSelectionInViewport } from "@/lib/canvas-camera"
import type { CommandDefinition, CommandExecutionContext } from "../types"

function getLaneScreenPoint(ctx: CommandExecutionContext) {
  const center = {
    x: ctx.palette.centerLaneScreenRect.x + ctx.palette.centerLaneScreenRect.w / 2,
    y: ctx.palette.centerLaneScreenRect.y + ctx.palette.centerLaneScreenRect.h / 2,
  }
  const point = ctx.editor.getViewportScreenCenter().clone()
  point.x = center.x
  point.y = center.y
  return point
}

export function createCanvasActionCommands(): CommandDefinition[] {
  return [
    {
      id: "canvas:zoom-fit",
      title: "Zoom to fit page",
      subtitle: "Fit all content in the viewport",
      icon: Maximize2,
      keywords: ["fit", "zoom", "page", "view", "all"],
      group: "canvas",
      contextBadge: "Canvas",
      emptyQuerySection: "actions",
      when: (ctx: CommandExecutionContext) =>
        ctx.editor.getCurrentPageBounds() != null,
      run: (ctx: CommandExecutionContext) => {
        const bounds = ctx.editor.getCurrentPageBounds()
        if (!bounds) return
        fitPageBoundsInViewport(ctx.editor, bounds, {
          screenRect: ctx.palette.centerLaneScreenRect,
        })
      },
    },
    {
      id: "canvas:zoom-selection",
      title: "Zoom to selection",
      subtitle: "Cap zoom at 100% (same as canvas “Sel” control)",
      icon: Scan,
      keywords: ["selection", "sel", "zoom", "frame", "focus"],
      group: "canvas",
      contextBadge: "Selection",
      emptyQuerySection: "suggested",
      when: (ctx: CommandExecutionContext) =>
        ctx.editor.getSelectionPageBounds() != null,
      score: (ctx: CommandExecutionContext) =>
        ctx.palette.selection !== "none" ? 0.4 : 0,
      run: (ctx: CommandExecutionContext) => {
        if (!ctx.editor.getSelectionPageBounds()) {
          return
        }
        zoomToSelectionInViewport(ctx.editor, {
          maxTargetZoom: 1,
          zoomOutFactor: 0.9,
          screenRect: ctx.palette.centerLaneScreenRect,
        })
      },
    },
    {
      id: "canvas:zoom-in",
      title: "Zoom in",
      icon: Plus,
      keywords: ["larger", "bigger", "magnify", "zoom"],
      group: "canvas",
      contextBadge: "Canvas",
      emptyQuerySection: "actions",
      when: () => true,
      run: (ctx: CommandExecutionContext) => {
        const p = getLaneScreenPoint(ctx)
        ctx.editor.zoomIn(p, { animation: ZOOM_ANIMATION })
      },
    },
    {
      id: "canvas:zoom-out",
      title: "Zoom out",
      icon: Minus,
      keywords: ["smaller", "zoom"],
      group: "canvas",
      contextBadge: "Canvas",
      emptyQuerySection: "actions",
      when: () => true,
      run: (ctx: CommandExecutionContext) => {
        const p = getLaneScreenPoint(ctx)
        ctx.editor.zoomOut(p, { animation: ZOOM_ANIMATION })
      },
    },
    {
      id: "canvas:reset-zoom",
      title: "Reset zoom to 100%",
      icon: SquareDashed,
      keywords: ["100", "reset", "actual", "one", "to", "pixel"],
      group: "canvas",
      contextBadge: "Canvas",
      emptyQuerySection: "actions",
      when: () => true,
      run: (ctx: CommandExecutionContext) => {
        const p = getLaneScreenPoint(ctx)
        ctx.editor.resetZoom(p, { animation: ZOOM_ANIMATION })
      },
    },
  ]
}

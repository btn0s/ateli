import { GUTTER } from "./constants"
import { boundsOf } from "./geometry"
import type { ShapeRect } from "./types"

export type OrganizePlanEntry = { id: string; x: number; y: number }

/**
 * Pack shapes into a grid keyed to the bounding-box top-left.
 * cols = round(sqrt(n)), biased +1 when viewport aspect > 1.3 (wider screens).
 * Cell = max(w) + GUTTER × max(h) + GUTTER across inputs.
 * Row-major, sorted by existing (y, x) to preserve rough ordering.
 */
export function planOrganizeGrid(
  shapes: ShapeRect[],
  opts: { aspect: number }
): OrganizePlanEntry[] {
  if (shapes.length === 0) return []

  const bbox = boundsOf(shapes)
  const maxW = Math.max(...shapes.map((s) => s.w))
  const maxH = Math.max(...shapes.map((s) => s.h))
  const cellW = maxW + GUTTER
  const cellH = maxH + GUTTER

  const baseCols = Math.max(1, Math.round(Math.sqrt(shapes.length)))
  const cols = opts.aspect > 1.3 ? baseCols + 1 : baseCols

  const sorted = [...shapes].sort((a, b) => a.y - b.y || a.x - b.x)

  return sorted.map((s, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    return { id: s.id, x: bbox.x + col * cellW, y: bbox.y + row * cellH }
  })
}

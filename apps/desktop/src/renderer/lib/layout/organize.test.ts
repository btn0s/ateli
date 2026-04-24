import { describe, expect, it } from "vitest"
import { planOrganizeGrid } from "./organize"
import { GUTTER } from "./constants"
import type { ShapeRect } from "./types"

function shape(id: string, x: number, y: number, w = 100, h = 80): ShapeRect {
  return { id, x, y, w, h, groupKey: "wt", lastUsedAt: 0 }
}

describe("planOrganizeGrid", () => {
  it("returns empty plan for empty input", () => {
    expect(planOrganizeGrid([], { aspect: 1 })).toEqual([])
  })

  it("preserves top-left of bounding box", () => {
    const shapes = [shape("a", 10, 20), shape("b", 200, 300)]
    const plan = planOrganizeGrid(shapes, { aspect: 1 })
    const minX = Math.min(...plan.map((p) => p.x))
    const minY = Math.min(...plan.map((p) => p.y))
    expect(minX).toBe(10)
    expect(minY).toBe(20)
  })

  it("uses max cell size + gutter", () => {
    const shapes = [shape("a", 0, 0, 100, 80), shape("b", 1000, 1000, 200, 150)]
    const plan = planOrganizeGrid(shapes, { aspect: 1 })
    // 2 shapes → 2x1 grid (cols = round(sqrt(2)) = 1, but aspect=1 → 1 col, so 2 rows)
    // Either way, one axis has step = max cell size + GUTTER
    const xs = plan.map((p) => p.x).sort((a, b) => a - b)
    const ys = plan.map((p) => p.y).sort((a, b) => a - b)
    const stepX = xs[1] - xs[0]
    const stepY = ys[1] - ys[0]
    const expected = 200 + GUTTER // max(w)
    const expectedY = 150 + GUTTER
    expect(stepX === 0 || stepX === expected).toBe(true)
    expect(stepY === 0 || stepY === expectedY).toBe(true)
  })

  it("produces a plan entry per shape, keyed by id", () => {
    const shapes = [shape("a", 0, 0), shape("b", 1000, 0), shape("c", 0, 1000)]
    const plan = planOrganizeGrid(shapes, { aspect: 1 })
    expect(new Set(plan.map((p) => p.id))).toEqual(new Set(["a", "b", "c"]))
  })
})

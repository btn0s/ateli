import { describe, expect, it } from "vitest"
import { planPlacement } from "./plan"
import type { PlanInput, ShapeRect } from "./types"

function shape(id: string, x: number, y: number, groupKey = "wt"): ShapeRect {
  return { id, x, y, w: 100, h: 80, groupKey, lastUsedAt: 0 }
}

const BASE: Omit<PlanInput, "shapes" | "targetGroupKey"> = {
  size: { w: 100, h: 80 },
  viewport: { x: 0, y: 0, w: 2000, h: 1500 },
  now: 0,
}

describe("planPlacement", () => {
  it("returns viewport-centered point on empty canvas", () => {
    const p = planPlacement({ ...BASE, shapes: [], targetGroupKey: "x" })
    expect(p).toEqual({ x: 950, y: 710 })
  })

  it("never overlaps existing shapes", () => {
    const shapes = [shape("a", 900, 700, "x")]
    const p = planPlacement({ ...BASE, shapes, targetGroupKey: "x" })
    // result rect inflated by GUTTER must not overlap existing shape
    const overlaps =
      p.x < 900 + 100 && p.x + 100 > 900 && p.y < 700 + 80 && p.y + 80 > 700
    expect(overlaps).toBe(false)
  })

  it("lands near same-group neighbors", () => {
    const shapes = [
      shape("a", 0, 0, "x"),
      shape("b", 150, 0, "x"),
      shape("far", 1800, 1300, "y"),
    ]
    const p = planPlacement({ ...BASE, shapes, targetGroupKey: "x" })
    expect(p.x).toBeLessThan(500)
    expect(p.y).toBeLessThan(500)
  })
})

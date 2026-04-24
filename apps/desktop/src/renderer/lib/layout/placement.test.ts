import { describe, expect, it } from "vitest"
import { pickAnchor, spiralSearch } from "./placement"
import { GUTTER } from "./constants"
import type { Cluster, Rect, ShapeRect } from "./types"

function shape(id: string, x: number, y: number, groupKey = "wt"): ShapeRect {
  return { id, x, y, w: 100, h: 80, groupKey, lastUsedAt: 0 }
}

function clusterOf(shapes: ShapeRect[]): Cluster {
  const composition = new Map<string, number>()
  for (const s of shapes) composition.set(s.groupKey, (composition.get(s.groupKey) ?? 0) + 1)
  const minX = Math.min(...shapes.map((s) => s.x))
  const minY = Math.min(...shapes.map((s) => s.y))
  const maxX = Math.max(...shapes.map((s) => s.x + s.w))
  const maxY = Math.max(...shapes.map((s) => s.y + s.h))
  const cx = shapes.reduce((a, s) => a + s.x + s.w / 2, 0) / shapes.length
  const cy = shapes.reduce((a, s) => a + s.y + s.h / 2, 0) / shapes.length
  return {
    shapes,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    centroid: { x: cx, y: cy },
    composition,
    lastUsedAt: 0,
  }
}

const VIEWPORT: Rect = { x: 0, y: 0, w: 2000, h: 1500 }

describe("pickAnchor", () => {
  it("falls back to viewport center when no clusters", () => {
    const a = pickAnchor([], "x", VIEWPORT, 0, { w: 600, h: 400 })
    expect(a).toEqual({ x: 1000 - 300, y: 750 - 200 })
  })

  it("hugs X-members inside a mixed cluster", () => {
    // X at (0,0), Y at (200,0). Cluster centroid ≈ 150,40; X-centroid = 50,40
    const c = clusterOf([shape("a", 0, 0, "x"), shape("b", 200, 0, "y")])
    const a = pickAnchor([c], "x", VIEWPORT, 0, { w: 100, h: 80 })
    expect(a.x).toBeCloseTo(50 - 50, 4)  // centroid.x - size.w/2
    expect(a.y).toBeCloseTo(40 - 40, 4)
  })

  it("picks the heaviest X cluster", () => {
    // pure-X 3-shape vs. mixed 40% X 5-shape — pure wins
    const pureX = clusterOf([
      shape("a", 0, 0, "x"),
      shape("b", 150, 0, "x"),
      shape("c", 300, 0, "x"),
    ])
    const mixed = clusterOf([
      shape("d", 2000, 1000, "x"),
      shape("e", 2150, 1000, "x"),
      shape("f", 2300, 1000, "y"),
      shape("g", 2000, 1080, "y"),
      shape("h", 2150, 1080, "y"),
    ])
    const a = pickAnchor([pureX, mixed], "x", VIEWPORT, 0, { w: 100, h: 80 })
    expect(a.x).toBeLessThan(1000)
  })
})

describe("spiralSearch", () => {
  it("returns anchor when no obstacles", () => {
    const a = { x: 100, y: 100 }
    const result = spiralSearch(a, { w: 100, h: 80 }, [])
    expect(result).toEqual(a)
  })

  it("finds free slot near occupied anchor", () => {
    const obstacles: Rect[] = [{ x: 100, y: 100, w: 100, h: 80 }]
    const a = { x: 100, y: 100 }
    const result = spiralSearch(a, { w: 100, h: 80 }, obstacles)
    // Result must not overlap obstacle inflated by GUTTER
    const gutterInflated: Rect = {
      x: obstacles[0].x - GUTTER,
      y: obstacles[0].y - GUTTER,
      w: obstacles[0].w + GUTTER * 2,
      h: obstacles[0].h + GUTTER * 2,
    }
    const resultRect: Rect = { x: result.x, y: result.y, w: 100, h: 80 }
    const overlaps =
      resultRect.x < gutterInflated.x + gutterInflated.w &&
      resultRect.x + resultRect.w > gutterInflated.x &&
      resultRect.y < gutterInflated.y + gutterInflated.h &&
      resultRect.y + resultRect.h > gutterInflated.y
    expect(overlaps).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import { detectClusters } from "./clusters"
import type { ShapeRect } from "./types"

function shape(
  id: string,
  x: number,
  y: number,
  groupKey = "wt",
  lastUsedAt = 0
): ShapeRect {
  return { id, x, y, w: 100, h: 80, groupKey, lastUsedAt }
}

describe("detectClusters", () => {
  it("returns empty for no shapes", () => {
    expect(detectClusters([])).toEqual([])
  })

  it("puts distant shapes in separate clusters", () => {
    const clusters = detectClusters([shape("a", 0, 0), shape("b", 1000, 1000)])
    expect(clusters).toHaveLength(2)
  })

  it("merges shapes within CLUSTER_GAP", () => {
    // 100 + 100 + 20 = 220 apart horizontally — within 2x CLUSTER_GAP/2 = 120 inflate
    const clusters = detectClusters([shape("a", 0, 0), shape("b", 150, 0)])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].shapes).toHaveLength(2)
  })

  it("chain-merges via single-link", () => {
    // a-b close, b-c close, a-c far → all one cluster
    const clusters = detectClusters([
      shape("a", 0, 0),
      shape("b", 150, 0),
      shape("c", 300, 0),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].shapes).toHaveLength(3)
  })

  it("computes composition by groupKey", () => {
    const clusters = detectClusters([
      shape("a", 0, 0, "wt1"),
      shape("b", 150, 0, "wt2"),
      shape("c", 300, 0, "wt1"),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].composition.get("wt1")).toBe(2)
    expect(clusters[0].composition.get("wt2")).toBe(1)
  })

  it("records max lastUsedAt across members", () => {
    const clusters = detectClusters([
      shape("a", 0, 0, "wt", 100),
      shape("b", 150, 0, "wt", 500),
    ])
    expect(clusters[0].lastUsedAt).toBe(500)
  })

  it("computes tight bounds and centroid", () => {
    const clusters = detectClusters([shape("a", 0, 0), shape("b", 150, 0)])
    expect(clusters[0].bounds).toEqual({ x: 0, y: 0, w: 250, h: 80 })
    expect(clusters[0].centroid).toEqual({ x: 125, y: 40 })
  })
})

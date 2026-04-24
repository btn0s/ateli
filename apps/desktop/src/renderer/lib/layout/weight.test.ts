import { describe, expect, it } from "vitest"
import { scoreCluster } from "./weight"
import { RECENCY_HALF_LIFE_MS, RECENCY_LAMBDA } from "./constants"
import type { Cluster, ShapeRect } from "./types"

function shape(groupKey: string): ShapeRect {
  return { id: `s-${Math.random()}`, x: 0, y: 0, w: 10, h: 10, groupKey, lastUsedAt: 0 }
}

function cluster(groupKeys: string[], lastUsedAt = 0): Cluster {
  const shapes = groupKeys.map(shape)
  const composition = new Map<string, number>()
  for (const k of groupKeys) composition.set(k, (composition.get(k) ?? 0) + 1)
  return {
    shapes,
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    centroid: { x: 0, y: 0 },
    composition,
    lastUsedAt,
  }
}

describe("scoreCluster", () => {
  it("returns 0 when group is absent", () => {
    expect(scoreCluster(cluster(["a", "b"]), "c", 0)).toBe(0)
  })

  it("favors pure over larger mixed", () => {
    // 3-terminal pure-X: 3 * 1.0 = 3.0
    // 5-terminal 40% X:  2 * 0.4 = 0.8
    const pureX = scoreCluster(cluster(["x", "x", "x"]), "x", 0)
    const mixed = scoreCluster(cluster(["x", "x", "y", "y", "y"]), "x", 0)
    expect(pureX).toBeGreaterThan(mixed)
  })

  it("applies recency boost within cap", () => {
    const stale = scoreCluster(cluster(["x"], 0), "x", 40 * RECENCY_HALF_LIFE_MS)
    const fresh = scoreCluster(cluster(["x"], 10 * RECENCY_HALF_LIFE_MS), "x", 10 * RECENCY_HALF_LIFE_MS)
    // Stale: decay ≈ 2^-40 ≈ 0, boost ≈ 1, score ≈ 1
    // Fresh: age = 0, decay = 1, boost = 1 + LAMBDA, score = 1 + LAMBDA
    expect(stale).toBeCloseTo(1, 4)
    expect(fresh).toBeCloseTo(1 + RECENCY_LAMBDA, 4)
  })
})

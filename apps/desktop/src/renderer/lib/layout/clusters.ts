import { CLUSTER_GAP } from "./constants"
import { boundsOf, centroidOf, inflate, rectsOverlap } from "./geometry"
import type { Cluster, ShapeRect } from "./types"

/** Single-link agglomerative clustering by proximity (CLUSTER_GAP). */
export function detectClusters(shapes: ShapeRect[]): Cluster[] {
  const n = shapes.length
  if (n === 0) return []

  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i]! !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const pad = CLUSTER_GAP / 2
  const inflated = shapes.map((s) => inflate(s, pad))

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rectsOverlap(inflated[i]!, inflated[j]!)) union(i, j)
    }
  }

  const groups = new Map<number, ShapeRect[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(shapes[i]!)
    groups.set(root, list)
  }

  const clusters: Cluster[] = []
  for (const list of groups.values()) {
    const composition = new Map<string, number>()
    let lastUsedAt = 0
    for (const s of list) {
      composition.set(s.groupKey, (composition.get(s.groupKey) ?? 0) + 1)
      if (s.lastUsedAt > lastUsedAt) lastUsedAt = s.lastUsedAt
    }
    clusters.push({
      shapes: list,
      bounds: boundsOf(list),
      centroid: centroidOf(list),
      composition,
      lastUsedAt,
    })
  }

  return clusters
}

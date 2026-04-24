import { RECENCY_HALF_LIFE_MS, RECENCY_LAMBDA } from "./constants"
import type { Cluster } from "./types"

export function scoreCluster(c: Cluster, targetGroupKey: string, now: number): number {
  const count = c.composition.get(targetGroupKey) ?? 0
  if (count === 0) return 0
  const purity = count / c.shapes.length
  const age = Math.max(0, now - c.lastUsedAt)
  const decay = Math.exp((-Math.LN2 * age) / RECENCY_HALF_LIFE_MS)
  const recencyBoost = 1 + RECENCY_LAMBDA * decay
  return count * purity * recencyBoost
}

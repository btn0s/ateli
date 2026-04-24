import { detectClusters } from "./clusters"
import { obstaclesFromShapes, pickAnchor, spiralSearch } from "./placement"
import type { PlanInput } from "./types"

export function planPlacement(input: PlanInput): { x: number; y: number } {
  const clusters = detectClusters(input.shapes)
  const anchor = pickAnchor(
    clusters,
    input.targetGroupKey,
    input.viewport,
    input.now,
    input.size
  )
  return spiralSearch(anchor, input.size, obstaclesFromShapes(input.shapes))
}

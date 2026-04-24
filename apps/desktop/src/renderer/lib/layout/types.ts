export type Rect = { x: number; y: number; w: number; h: number }

export type ShapeRect = {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** Grouping key for composition (worktree path, or cwd when no worktree match). */
  groupKey: string
  /** Epoch ms; 0 when unknown. */
  lastUsedAt: number
}

export type Cluster = {
  shapes: ShapeRect[]
  bounds: Rect
  centroid: { x: number; y: number }
  composition: Map<string, number>
  lastUsedAt: number
}

export type PlanInput = {
  shapes: ShapeRect[]
  targetGroupKey: string
  size: { w: number; h: number }
  viewport: Rect
  now: number
}

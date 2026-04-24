import type { Editor, TLShape, TLShapeId } from "tldraw"
import { findWorktreeForCwd } from "@/lib/terminal-worktree-title"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import { detectClusters } from "./clusters"
import { planPlacement } from "./plan"
import { planOrganizeGrid } from "./organize"
import type { Rect, ShapeRect } from "./types"

function rectFromShape(editor: Editor, shape: TLShape): ShapeRect | null {
  const bounds = editor.getShapePageBounds(shape.id)
  if (!bounds) return null
  const props = shape.props as { cwd?: string; w?: number; h?: number }
  const meta = shape.meta as { lastUsedAt?: number } | undefined
  return {
    id: shape.id,
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    groupKey: props.cwd ?? "",
    lastUsedAt: meta?.lastUsedAt ?? 0,
  }
}

function resolveGroupKey(cwd: string, worktrees: WorktreeIndexEntry[]): string {
  if (!cwd) return ""
  return findWorktreeForCwd(cwd, worktrees)?.path ?? cwd
}

function viewportRect(editor: Editor): Rect {
  const b = editor.getViewportPageBounds()
  return { x: b.x, y: b.y, w: b.w, h: b.h }
}

export function placeTerminal(
  editor: Editor,
  opts: {
    cwd: string
    worktrees: WorktreeIndexEntry[]
    size: { w: number; h: number }
  }
): { x: number; y: number } {
  const target = resolveGroupKey(opts.cwd, opts.worktrees)

  const shapes: ShapeRect[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (s.type !== "terminal") continue
    const r = rectFromShape(editor, s)
    if (!r) continue
    const props = s.props as { cwd?: string }
    shapes.push({ ...r, groupKey: resolveGroupKey(props.cwd ?? "", opts.worktrees) })
  }

  return planPlacement({
    shapes,
    targetGroupKey: target,
    size: opts.size,
    viewport: viewportRect(editor),
    now: Date.now(),
  })
}

export function organizeShapes(editor: Editor, shapeIds: TLShapeId[]): void {
  if (shapeIds.length === 0) return
  const shapes: ShapeRect[] = []
  for (const id of shapeIds) {
    const s = editor.getShape(id)
    if (!s) continue
    const bounds = editor.getShapePageBounds(id)
    if (!bounds) continue
    shapes.push({
      id,
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      groupKey: "",
      lastUsedAt: 0,
    })
  }
  if (shapes.length === 0) return

  const viewport = viewportRect(editor)
  const aspect = viewport.w / Math.max(1, viewport.h)
  const plan = planOrganizeGrid(shapes, { aspect })

  editor.updateShapes(
    plan.map((p) => {
      const shape = editor.getShape(p.id as TLShapeId)!
      return { id: p.id as TLShapeId, type: shape.type, x: p.x, y: p.y }
    })
  )
}

/** Expand a single selected terminal to its detected cluster. */
export function clusterShapeIdsFor(
  editor: Editor,
  shapeId: TLShapeId,
  worktrees: WorktreeIndexEntry[]
): TLShapeId[] {
  const shapes: ShapeRect[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (s.type !== "terminal") continue
    const r = rectFromShape(editor, s)
    if (!r) continue
    const props = s.props as { cwd?: string }
    shapes.push({ ...r, groupKey: resolveGroupKey(props.cwd ?? "", worktrees) })
  }
  const clusters = detectClusters(shapes)
  const hit = clusters.find((c) => c.shapes.some((s) => s.id === shapeId))
  return hit ? (hit.shapes.map((s) => s.id) as TLShapeId[]) : [shapeId]
}

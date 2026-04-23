import type { Editor } from "tldraw"
import type { CommandPaletteContext } from "./types"
import { buildWorktreeListForPalette } from "./worktree-entries"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import { getRepoPath } from "@/lib/default-actions"
import { getCenterLaneScreenRect } from "@/lib/canvas-camera"
import type { TLShapeId } from "tldraw"

function selectionSummary(
  ids: readonly TLShapeId[],
): "none" | "single" | "multi" {
  if (ids.length === 0) return "none"
  if (ids.length === 1) return "single"
  return "multi"
}

export function buildCommandPaletteContext(
  editor: Editor,
  worktrees: WorktreeIndexEntry[],
): CommandPaletteContext {
  const all = editor.getCurrentPageShapes()
  const shapeIds = editor.getSelectedShapeIds()
  const selectedShapes = all.filter((s) => shapeIds.includes(s.id))
  const types = [...new Set(selectedShapes.map((s) => s.type))]

  const terminalShapeIds = all.filter((s) => s.type === "terminal").map((s) => s.id)
  const frameShapeIds = all.filter((s) => s.type === "frame").map((s) => s.id)
  const repoPath = getRepoPath()

  return {
    selectionShapeIds: shapeIds,
    selectedShapeTypes: types,
    selection: selectionSummary(shapeIds),
    repoPath: repoPath || null,
    worktreeEntries: buildWorktreeListForPalette(repoPath, worktrees),
    terminalShapeIds,
    frameShapeIds,
    centerLaneScreenRect: getCenterLaneScreenRect(editor),
  }
}

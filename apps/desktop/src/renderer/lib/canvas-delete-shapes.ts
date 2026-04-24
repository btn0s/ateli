import type { Editor, TLShapeId } from "tldraw"

/**
 * Removes shapes as document sync (remote merge scope). Matches worktree
 * cleanup and avoids user-scoped beforeDelete handlers (e.g. terminal confirm).
 */
export function deleteCanvasShapesAsSync(editor: Editor, ids: TLShapeId[]) {
  if (ids.length === 0) return
  editor.store.mergeRemoteChanges(() => {
    editor.deleteShapes(ids)
  })
}

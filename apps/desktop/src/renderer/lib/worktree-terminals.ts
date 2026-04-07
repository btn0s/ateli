import type { TLShape } from "tldraw"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"

/** Same rules as WorktreeList: which terminals count as belonging to a worktree row. */
export function terminalsBelongingToWorktree(
  repoPath: string,
  allWorktrees: WorktreeIndexEntry[],
  wt: WorktreeIndexEntry,
  terminalShapes: TLShape[],
): TLShape[] {
  return terminalShapes.filter((s) => {
    const cwd = (s.props as { cwd?: string }).cwd
    if (!cwd) return wt.isMain
    if (wt.isMain) {
      return (
        cwd === repoPath ||
        (cwd.startsWith(repoPath) &&
          !allWorktrees.some((w) => !w.isMain && cwd.startsWith(w.path)))
      )
    }
    return cwd.startsWith(wt.path)
  })
}

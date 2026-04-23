import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"

/** Same main + worktree list construction as the legacy command menu. */
export function buildWorktreeListForPalette(
  repoPath: string | null,
  worktrees: WorktreeIndexEntry[],
): WorktreeIndexEntry[] {
  if (!repoPath || worktrees.length === 0) return []
  const mainWt = worktrees.find((w) => w.isMain)
  return [
    mainWt ?? {
      id: "",
      path: repoPath,
      branch: "main",
      head: "",
      isMain: true,
      createdAt: "",
      repoPath,
    },
    ...worktrees.filter((w) => !w.isMain),
  ]
}

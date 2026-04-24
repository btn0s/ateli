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

/** When adding a terminal, we always need at least the main checkout when a repo is open. */
export function buildNewTerminalWorktreeRows(
  repoPath: string,
  worktrees: WorktreeIndexEntry[],
): WorktreeIndexEntry[] {
  if (worktrees.length === 0) {
    return [
      {
        id: "",
        path: repoPath,
        branch: "main",
        head: "",
        isMain: true,
        createdAt: "",
        repoPath,
      },
    ]
  }
  return buildWorktreeListForPalette(repoPath, worktrees)
}

/** Branch ref to use as `git worktree` start (main checkout / default). */
export function getDefaultWorktreeStartRef(
  worktrees: WorktreeIndexEntry[],
): string {
  const main = worktrees.find((w) => w.isMain)
  if (main?.branch) {
    return main.branch
  }
  return "main"
}

/** Normalize a filesystem root path for stable comparisons. */
export function normalizeFsRoot(p: string): string {
  return p.replace(/[/\\]+$/, "") || p
}

export interface WorktreeRootCandidate {
  path: string
  isMain: boolean
}

/**
 * Git checkout root for file tree / git status: main repo path, or the
 * linked worktree directory when `cwd` lies inside a non-main worktree.
 */
export function resolveFilesRootFromCwd(
  repoPath: string,
  worktrees: WorktreeRootCandidate[],
  cwd: string,
): string {
  const normRepo = normalizeFsRoot(repoPath)
  const normCwd = normalizeFsRoot(cwd)

  const candidates = worktrees
    .filter((w) => !w.isMain)
    .map((w) => normalizeFsRoot(w.path))
    .filter(
      (wtPath) => normCwd === wtPath || normCwd.startsWith(`${wtPath}/`),
    )

  if (candidates.length === 0) return normRepo
  return candidates.reduce((a, b) => (a.length >= b.length ? a : b))
}

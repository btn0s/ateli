import { normalizeFsRoot } from "@/lib/worktree-files-root"

export interface WorktreeTitleEntry {
  path: string
  branch: string
  isMain: boolean
}

function cwdMatchesWorktree(cwdNorm: string, wtPathNorm: string): boolean {
  return (
    cwdNorm === wtPathNorm ||
    cwdNorm.startsWith(`${wtPathNorm}/`) ||
    cwdNorm.startsWith(`${wtPathNorm}\\`)
  )
}

/** Longest matching worktree path wins (nested paths). */
export function findWorktreeForCwd(
  cwd: string,
  worktrees: WorktreeTitleEntry[],
): WorktreeTitleEntry | undefined {
  const norm = normalizeFsRoot(cwd)
  let best: WorktreeTitleEntry | undefined
  let bestLen = -1
  for (const w of worktrees) {
    const wp = normalizeFsRoot(w.path)
    if (!cwdMatchesWorktree(norm, wp)) continue
    if (wp.length > bestLen) {
      best = w
      bestLen = wp.length
    }
  }
  return best
}

/** Title for terminal chrome: branch when cwd is in a known worktree, else folder basename. */
export function terminalTitleFromCwd(
  cwd: string | undefined,
  fallbackCwd: string,
  worktrees: WorktreeTitleEntry[],
): string {
  const effective = cwd?.trim() ? cwd : fallbackCwd
  const wt = findWorktreeForCwd(effective, worktrees)
  if (wt) return wt.branch || "main"
  const norm = normalizeFsRoot(effective)
  const seg = norm.split(/[/\\]/).filter(Boolean).pop()
  return seg || "Terminal"
}

export function cwdUnderRemovedWorktree(
  cwd: string | undefined,
  removedWorktreePath: string,
): boolean {
  if (!cwd?.trim()) return false
  const c = normalizeFsRoot(cwd)
  const w = normalizeFsRoot(removedWorktreePath)
  return c === w || c.startsWith(`${w}/`) || c.startsWith(`${w}\\`)
}

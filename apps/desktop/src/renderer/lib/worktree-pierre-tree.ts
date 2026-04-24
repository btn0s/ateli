import type { TLShape } from "tldraw"
import type { TLShapeId } from "tldraw"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import { terminalsBelongingToWorktree } from "@/lib/worktree-terminals"

function slugBranchLabel(branch: string): string {
  const s = branch
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return s.length > 0 ? s : "worktree"
}

/** Stable, path-safe directory basename for a worktree (Pierre row label = last segment). */
export function worktreeDirBasename(
  wt: WorktreeIndexEntry,
  index: number,
  used: Set<string>,
): string {
  if (wt.isMain) {
    used.add("main")
    return "main"
  }
  let base = `${String(index).padStart(2, "0")}-${slugBranchLabel(wt.branch)}`
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  const suffix = wt.id ? wt.id.slice(0, 8) : "wt"
  base = `${base}-${suffix}`
  used.add(base)
  return base
}

function sanitizeLeafSegment(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").slice(0, 120) || "Terminal"
}

export type WorktreePierreBuild = {
  paths: string[]
  directoryPaths: string[]
  dirPathToWt: Map<string, WorktreeIndexEntry>
  leafPathToShapeId: Map<string, TLShapeId>
  terminalCountByDirPath: Map<string, number>
}

export function buildWorktreePierrePaths(
  repoPath: string,
  worktrees: WorktreeIndexEntry[],
  terminalShapes: TLShape[],
): WorktreePierreBuild {
  const mainWt = worktrees.find((w) => w.isMain)
  const entries: WorktreeIndexEntry[] = [
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

  const usedBasenames = new Set<string>()
  const dirPathToWt = new Map<string, WorktreeIndexEntry>()
  const leafPathToShapeId = new Map<string, TLShapeId>()
  const terminalCountByDirPath = new Map<string, number>()
  const paths: string[] = []
  const directoryPaths: string[] = []

  entries.forEach((wt, index) => {
    const base = worktreeDirBasename(wt, index, usedBasenames)
    const dirPath = `${base}/`
    dirPathToWt.set(dirPath, wt)
    paths.push(dirPath)
    directoryPaths.push(dirPath)

    const terminals = terminalsBelongingToWorktree(
      repoPath,
      worktrees,
      wt,
      terminalShapes,
    )
    terminalCountByDirPath.set(dirPath, terminals.length)

    const leafCounts = new Map<string, number>()
    for (const shape of terminals) {
      const props = shape.props as { cwd?: string }
      const raw =
        props.cwd?.split("/").pop()?.split("\\").pop()?.trim() || "Terminal"
      let seg = sanitizeLeafSegment(raw)
      const n = (leafCounts.get(seg) ?? 0) + 1
      leafCounts.set(seg, n)
      if (n > 1) seg = `${seg}-${n}`
      const leafPath = `${dirPath}${seg}`
      paths.push(leafPath)
      leafPathToShapeId.set(leafPath, shape.id as TLShapeId)
    }
  })

  return {
    paths,
    directoryPaths,
    dirPathToWt,
    leafPathToShapeId,
    terminalCountByDirPath,
  }
}

export function resolveWorktreeFromMenuPath(
  itemPath: string,
  isFolder: boolean,
  dirPathToWt: Map<string, WorktreeIndexEntry>,
): WorktreeIndexEntry | null {
  if (isFolder) {
    const dir = itemPath.endsWith("/") ? itemPath : `${itemPath}/`
    return dirPathToWt.get(dir) ?? null
  }
  const i = itemPath.lastIndexOf("/")
  if (i < 0) return null
  const parent = itemPath.slice(0, i + 1)
  return dirPathToWt.get(parent) ?? null
}

/** Non-main worktrees from multi-selected directory rows, plus the row that was right-clicked. */
export function removableWorktreesFromSelection(
  treeModel: { getSelectedPaths(): readonly string[] },
  dirPathToWt: Map<string, WorktreeIndexEntry>,
  clicked: WorktreeIndexEntry,
): WorktreeIndexEntry[] {
  const byId = new Map<string, WorktreeIndexEntry>()
  for (const p of treeModel.getSelectedPaths()) {
    const dir = p.endsWith("/") ? p : `${p}/`
    const w = dirPathToWt.get(dir)
    if (!w || w.isMain || !w.id) continue
    byId.set(w.id, w)
  }
  if (clicked.id && !clicked.isMain) {
    byId.set(clicked.id, clicked)
  }
  return [...byId.values()]
}

export function terminalShapeIdFromLeafPath(
  path: string,
  leafPathToShapeId: Map<string, TLShapeId>,
): TLShapeId | null {
  return leafPathToShapeId.get(path) ?? null
}

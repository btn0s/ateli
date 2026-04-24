import path from "node:path"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  FileTree as PierreFileTreeModel,
  type GitStatusEntry,
} from "@pierre/trees"
import { FileTree as PierreFileTree } from "@pierre/trees/react"
import { Check, Minus, MoreHorizontal, Square } from "lucide-react"
import { track, useEditor } from "tldraw"
import { cn } from "@workspace/ui/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useRepoPath, useWorktrees } from "@/contexts/worktree-index-context"
import {
  normalizeFsRoot,
  resolveFilesRootFromCwd,
} from "@/lib/worktree-files-root"
import { useDiffPreviewTabs } from "@/contexts/diff-preview-tabs-context"
import { Sidebar } from "@/components/sidebar"
import { SidebarShell } from "@/components/sidebar-shell"
import {
  SidebarTabButton,
  SidebarTabStrip,
} from "@/components/sidebar-tab-button"
import {
  SidebarTerminalTabs,
  type SidebarLowerMainTab,
} from "@/components/sidebar-terminal-stack"
import { workspaceIconButtonClass } from "@/components/sidebar-workspace-chrome"
import { collectExpandedDirectoryPaths } from "@/lib/pierre-tree-expanded"
import { SIDEBAR_PIERRE_TREE_STYLE } from "@/lib/sidebar-pierre-tree-style"
import { ChangesCommitPanel } from "@/components/changes-commit-panel"

type FilesPanelTab = "files" | "changes"
type SidebarTerminalId = string
type SidebarTerminalState = {
  terminalIds: SidebarTerminalId[]
  activeMain: SidebarLowerMainTab
}

type GitChangesOverview = Awaited<ReturnType<typeof window.electron.git.status>>

type GitChangeRow = GitChangesOverview["entries"][number]

type DirEntry = Awaited<
  ReturnType<typeof window.electron.fs.readdir>
>["entries"][number]

function splitRepoPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf("/")
  if (i < 0) return { dir: "", name: p }
  return { dir: p.slice(0, i + 1), name: p.slice(i + 1) }
}

function gitStatusTitle(indexStatus: string, workTreeStatus: string): string {
  const slot = (c: string) => (c === " " ? "unchanged" : c)
  return `Git: index ${slot(indexStatus)}, worktree ${slot(workTreeStatus)}`
}

function changeEntryStagingFlags(entry: GitChangeRow): {
  hasStaged: boolean
  hasUnstaged: boolean
  fullyStaged: boolean
  partial: boolean
} {
  const ix = entry.indexStatus
  const wt = entry.workTreeStatus
  const untracked = ix === "?" && wt === "?"
  const hasStaged = !untracked && ix !== " "
  const hasUnstaged = untracked || wt !== " "
  const fullyStaged = hasStaged && !hasUnstaged
  const partial = hasStaged && hasUnstaged
  return { hasStaged, hasUnstaged, fullyStaged, partial }
}

type GitStatusBadge = {
  letter: string
  className: string
  label: string
}

function gitStatusBadge(
  letter: string,
  className: string,
  label: string
): GitStatusBadge {
  return { letter, className, label }
}

function statusLetterBadge(
  indexStatus: string,
  workTreeStatus: string
): GitStatusBadge {
  if (indexStatus === "?" && workTreeStatus === "?") {
    return gitStatusBadge("?", "text-sky-500", "Untracked")
  }
  if (indexStatus === "D" || workTreeStatus === "D") {
    return gitStatusBadge("D", "text-rose-500", "Deleted")
  }
  if (indexStatus === "U" || workTreeStatus === "U") {
    return gitStatusBadge("U", "text-orange-500", "Unmerged")
  }
  if (indexStatus === "A" && workTreeStatus === " ") {
    return gitStatusBadge("A", "text-emerald-500", "Added")
  }
  if (indexStatus === "R" || workTreeStatus === "R") {
    return gitStatusBadge("R", "text-violet-500", "Renamed")
  }
  if (indexStatus === "C" || workTreeStatus === "C") {
    return gitStatusBadge("C", "text-violet-500", "Copied")
  }
  if (indexStatus === "T" || workTreeStatus === "T") {
    return gitStatusBadge("T", "text-amber-600", "Type changed")
  }
  return gitStatusBadge("M", "text-amber-500", "Modified")
}

function mapGitStatus(entry: GitChangeRow): GitStatusEntry {
  if (entry.indexStatus === "?" && entry.workTreeStatus === "?") {
    return { path: entry.path, status: "untracked" }
  }
  if (entry.indexStatus === "D" || entry.workTreeStatus === "D") {
    return { path: entry.path, status: "deleted" }
  }
  if (entry.indexStatus === "R" || entry.workTreeStatus === "R") {
    return { path: entry.path, status: "renamed" }
  }
  if (entry.indexStatus === "A" && entry.workTreeStatus === " ") {
    return { path: entry.path, status: "added" }
  }
  return { path: entry.path, status: "modified" }
}

function toTreePath(rootPath: string, entry: DirEntry): string {
  const normalizedRoot = normalizeFsRoot(rootPath).replaceAll("\\", "/")
  const normalizedPath = entry.path.replaceAll("\\", "/")
  const relative = normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : entry.name
  return entry.isDirectory ? `${relative}/` : relative
}

async function collectTreePaths(rootPath: string): Promise<{
  directoryPaths: string[]
  pathMap: Map<string, string>
  paths: string[]
}> {
  const paths: string[] = []
  const directoryPaths: string[] = []
  const pathMap = new Map<string, string>()

  async function walk(dirPath: string): Promise<void> {
    const { entries } = await window.electron.fs.readdir(dirPath)
    for (const entry of entries) {
      const treePath = toTreePath(rootPath, entry)
      paths.push(treePath)
      pathMap.set(treePath, entry.path)
      if (entry.isDirectory) {
        directoryPaths.push(treePath)
        await walk(entry.path)
      }
    }
  }

  await walk(rootPath)
  return { directoryPaths, pathMap, paths }
}

/** Walk a subtree (same rules as readProjectDirectory / ignore) for targeted FS refresh. */
async function collectTreeSubtree(
  treeRoot: string,
  fromDir: string
): Promise<{
  directoryPaths: string[]
  pathMap: Map<string, string>
  paths: string[]
}> {
  const paths: string[] = []
  const directoryPaths: string[] = []
  const pathMap = new Map<string, string>()

  async function walk(dirPath: string): Promise<void> {
    const { entries } = await window.electron.fs.readdir(dirPath)
    for (const entry of entries) {
      const treePath = toTreePath(treeRoot, entry)
      paths.push(treePath)
      pathMap.set(treePath, entry.path)
      if (entry.isDirectory) {
        directoryPaths.push(treePath)
        await walk(entry.path)
      }
    }
  }

  await walk(fromDir)
  return { directoryPaths, pathMap, paths }
}

function directoryPrefixForAbsTree(treeRoot: string, absDir: string): string {
  const normRoot = normalizeFsRoot(treeRoot)
  const rel = path.relative(normRoot, path.resolve(absDir))
  if (!rel || rel === "") {
    return ""
  }
  const posix = rel.split(path.sep).join("/")
  return posix.endsWith("/") ? posix : `${posix}/`
}

function isPathUnderStaleSubtree(
  treePath: string,
  staleDirPrefix: string
): boolean {
  if (!staleDirPrefix) {
    return false
  }
  const p = staleDirPrefix.endsWith("/") ? staleDirPrefix : `${staleDirPrefix}/`
  return (
    treePath === staleDirPrefix.replace(/\/$/, "") || treePath.startsWith(p)
  )
}

function getClickedFilePath(event: Event): string | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue
    if (target.dataset.itemType !== "file") continue
    const path = target.dataset.itemPath
    if (path) return path
  }
  return null
}

function DiffStat({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) {
    return <span className="text-xs text-muted-foreground tabular-nums">—</span>
  }
  return (
    <span className="flex shrink-0 items-baseline gap-1 text-xs tabular-nums">
      {added > 0 ? (
        <span className="font-medium text-emerald-500/95">+{added}</span>
      ) : null}
      {removed > 0 ? (
        <span className="font-medium text-rose-500/95">−{removed}</span>
      ) : null}
    </span>
  )
}

function ChangeFileRow({
  entry,
  selected,
  onOpenDiff,
  onStagePath,
  onUnstagePath,
}: {
  entry: GitChangeRow
  selected: boolean
  onOpenDiff: (entry: GitChangeRow) => void
  onStagePath: (path: string) => void
  onUnstagePath: (path: string) => void
}) {
  const { dir, name } = splitRepoPath(entry.path)
  const badge = statusLetterBadge(entry.indexStatus, entry.workTreeStatus)
  const statusTitle = gitStatusTitle(entry.indexStatus, entry.workTreeStatus)
  const buttonTitle = `${entry.absPath}\n${statusTitle}`
  const badgeDescription = `${badge.label} — ${statusTitle}`
  const { fullyStaged, partial } = changeEntryStagingFlags(entry)
  const stageTitle = fullyStaged
    ? "Unstage"
    : partial
      ? "Stage all changes for this file"
      : "Stage"

  return (
    <div
      className={cn(
        "grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-0.5 rounded-sm py-0 pr-0 pl-0",
        selected ? "bg-accent/70" : "hover:bg-accent"
      )}
    >
      <button
        type="button"
        className={cn(
          workspaceIconButtonClass,
          "size-7 shrink-0 rounded-md border border-border/20 ateli-skeuo-input-dish",
          "bg-muted/12 text-muted-foreground",
          "focus-visible:ring-1 focus-visible:ring-ring"
        )}
        title={stageTitle}
        aria-label={stageTitle}
        onClick={(e) => {
          e.stopPropagation()
          if (fullyStaged) {
            onUnstagePath(entry.path)
          } else {
            onStagePath(entry.path)
          }
        }}
      >
        {fullyStaged ? (
          <Check className="size-3.5 text-primary" aria-hidden />
        ) : partial ? (
          <Minus className="size-3.5 opacity-90" aria-hidden />
        ) : (
          <Square className="size-3.5 opacity-50" aria-hidden />
        )}
      </button>
      <button
        type="button"
        className={cn(
          "min-w-0 rounded-sm px-0 py-0 text-left font-mono text-xs leading-tight transition-colors",
          "text-muted-foreground hover:text-accent-foreground",
          "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        )}
        title={buttonTitle}
        onClick={() => onOpenDiff(entry)}
        onDoubleClick={() => void window.electron.fs.openPath(entry.absPath)}
      >
        <span className="block min-w-0 truncate">
          {dir ? <span className="text-muted-foreground">{dir}</span> : null}
          <span className="text-foreground">{name}</span>
        </span>
      </button>
      <div className="flex min-w-[3.25rem] shrink-0 justify-end tabular-nums">
        <DiffStat added={entry.added} removed={entry.removed} />
      </div>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center font-mono text-xs font-semibold tabular-nums",
          badge.className
        )}
        title={badgeDescription}
        aria-label={`${badge.label}. ${statusTitle}`}
      >
        {badge.letter}
      </span>
    </div>
  )
}

const changesPanelHintClass = "py-1.5 pl-1 text-xs text-muted-foreground"

function ChangesList({
  overview,
  loading,
  selectedPath,
  onOpenDiff,
  onStagePath,
  onUnstagePath,
}: {
  overview: GitChangesOverview | null
  loading: boolean
  selectedPath: string | null
  onOpenDiff: (entry: GitChangeRow) => void
  onStagePath: (path: string) => void
  onUnstagePath: (path: string) => void
}) {
  if (loading && !overview) {
    return <p className={changesPanelHintClass}>Loading changes…</p>
  }

  if (!overview) return null

  if (overview.error) {
    return (
      <p className={changesPanelHintClass}>
        Could not read git status. Is this a git repository?
      </p>
    )
  }

  if (overview.entries.length === 0) {
    return <p className={changesPanelHintClass}>No local changes.</p>
  }

  return (
    <div className="space-y-px">
      {overview.entries.map((e) => (
        <ChangeFileRow
          key={`${e.path}:${e.indexStatus}${e.workTreeStatus}`}
          entry={e}
          selected={selectedPath === e.path}
          onOpenDiff={onOpenDiff}
          onStagePath={onStagePath}
          onUnstagePath={onUnstagePath}
        />
      ))}
    </div>
  )
}

export const FileTree = track(function FileTree() {
  const editor = useEditor()
  const repoPath = useRepoPath()
  const worktrees = useWorktrees()
  const { activeTab, openDiffTab } = useDiffPreviewTabs()
  const [panelTab, setPanelTab] = useState<FilesPanelTab>("files")
  const [sidebarTerminalState, setSidebarTerminalState] =
    useState<SidebarTerminalState>(() => {
      const id = crypto.randomUUID()
      return {
        terminalIds: [id],
        activeMain: { kind: "terminal", id },
      }
    })
  const [gitOverview, setGitOverview] = useState<GitChangesOverview | null>(
    null
  )
  const [gitOverviewLoading, setGitOverviewLoading] = useState(false)
  const [reloadSeq, setReloadSeq] = useState(0)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [treePathCount, setTreePathCount] = useState(0)
  const [selectedChangePath, setSelectedChangePath] = useState<string | null>(
    null
  )
  const treeWrapperRef = useRef<HTMLDivElement | null>(null)
  const treeDirectoryPathsRef = useRef<string[]>([])
  const treePathMapRef = useRef<Map<string, string>>(new Map())
  const treeModelRef = useRef<PierreFileTreeModel | null>(null)

  if (treeModelRef.current === null) {
    treeModelRef.current = new PierreFileTreeModel({
      initialExpansion: "closed",
      paths: [],
      search: false,
    })
  }

  const treeModel = treeModelRef.current

  let filesRootPath = ""
  if (repoPath) {
    const normRepo = normalizeFsRoot(repoPath)
    filesRootPath = normRepo
    const ids = editor.getSelectedShapeIds()
    if (ids.length === 1) {
      const shape = editor.getShape(ids[0]!)
      if (shape?.type === "terminal") {
        const cwd = shape.props.cwd ?? normRepo
        filesRootPath = resolveFilesRootFromCwd(repoPath, worktrees, cwd)
      }
    }
  }

  useEffect(() => {
    if (!filesRootPath) {
      treeDirectoryPathsRef.current = []
      treePathMapRef.current = new Map()
      treeModel.resetPaths([])
      treeModel.setGitStatus(undefined)
      setTreeError(null)
      setTreeLoading(false)
      setTreePathCount(0)
      return
    }

    let cancelled = false
    const norm = normalizeFsRoot(filesRootPath)

    ;(async () => {
      setTreeLoading(true)
      setTreeError(null)

      try {
        const expandedPaths = collectExpandedDirectoryPaths(
          treeModel,
          treeDirectoryPathsRef.current
        )
        const nextTree = await collectTreePaths(norm)
        if (cancelled) return

        treeDirectoryPathsRef.current = nextTree.directoryPaths
        treePathMapRef.current = nextTree.pathMap
        treeModel.resetPaths(nextTree.paths, {
          initialExpandedPaths: expandedPaths.filter((path) =>
            nextTree.pathMap.has(path)
          ),
        })
        setTreePathCount(nextTree.paths.length)
      } catch (error) {
        if (cancelled) return
        treeDirectoryPathsRef.current = []
        treePathMapRef.current = new Map()
        treeModel.resetPaths([])
        setTreePathCount(0)
        setTreeError(
          error instanceof Error ? error.message : "Could not read files."
        )
      } finally {
        if (!cancelled) setTreeLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filesRootPath, reloadSeq, treeModel])

  useEffect(() => {
    const wrapper = treeWrapperRef.current
    const host = wrapper?.querySelector("file-tree-container")
    if (!(host instanceof HTMLElement)) return

    const openTreePath = (treePath: string | null) => {
      if (!treePath) return
      const absPath = treePathMapRef.current.get(treePath)
      if (!absPath) return
      void window.electron.fs.openPath(absPath)
    }

    const handleClick = (event: Event) => {
      openTreePath(getClickedFilePath(event))
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return
      const focused = treeModel.getFocusedItem()
      if (!focused || focused.isDirectory()) return
      openTreePath(focused.getPath())
    }

    host.addEventListener("click", handleClick)
    host.addEventListener("keydown", handleKeyDown)
    return () => {
      host.removeEventListener("click", handleClick)
      host.removeEventListener("keydown", handleKeyDown)
    }
  }, [filesRootPath, treeModel, treePathCount])

  const gitOverviewLoadedRef = useRef(false)

  const refreshGitOverview = useCallback(
    async (opts?: { showLoading?: boolean }) => {
      if (!filesRootPath) {
        setGitOverview(null)
        setGitOverviewLoading(false)
        gitOverviewLoadedRef.current = false
        return
      }
      const norm = normalizeFsRoot(filesRootPath)
      const showLoading = opts?.showLoading ?? !gitOverviewLoadedRef.current
      if (showLoading) setGitOverviewLoading(true)
      const r = await window.electron.git.status(norm)
      setGitOverview(r)
      gitOverviewLoadedRef.current = true
      if (showLoading) setGitOverviewLoading(false)
    },
    [filesRootPath]
  )

  const runPartialTreeRefresh = useCallback(
    async (changedAbs: string) => {
      const norm = normalizeFsRoot(filesRootPath)
      if (!norm) {
        return
      }
      let anchor = path.resolve(changedAbs)
      try {
        await window.electron.fs.readdir(anchor)
      } catch {
        anchor = path.dirname(anchor)
      }
      const rootResolved = path.resolve(norm)
      const a = path.resolve(anchor)
      if (a !== rootResolved && !a.startsWith(rootResolved + path.sep)) {
        setReloadSeq((s) => s + 1)
        return
      }
      const stale = directoryPrefixForAbsTree(filesRootPath, a)
      if (stale === "") {
        setReloadSeq((s) => s + 1)
        return
      }
      setTreeLoading(true)
      setTreeError(null)
      try {
        const sub = await collectTreeSubtree(norm, a)
        const nextMap = new Map(treePathMapRef.current)
        for (const k of [...nextMap.keys()]) {
          if (isPathUnderStaleSubtree(k, stale)) {
            nextMap.delete(k)
          }
        }
        for (const [k, v] of sub.pathMap) {
          nextMap.set(k, v)
        }
        const nextDirs = new Set<string>()
        for (const d of treeDirectoryPathsRef.current) {
          if (!isPathUnderStaleSubtree(d, stale)) {
            nextDirs.add(d)
          }
        }
        for (const d of sub.directoryPaths) {
          nextDirs.add(d)
        }
        treeDirectoryPathsRef.current = [...nextDirs]
        treePathMapRef.current = nextMap
        const allPaths = [...nextMap.keys()].sort((x, y) =>
          x.localeCompare(y, undefined, { sensitivity: "base" })
        )
        const expandedPaths = collectExpandedDirectoryPaths(
          treeModel,
          treeDirectoryPathsRef.current
        )
        treeModel.resetPaths(allPaths, {
          initialExpandedPaths: expandedPaths.filter((p) => nextMap.has(p)),
        })
        setTreePathCount(allPaths.length)
      } catch (e) {
        setTreeError(
          e instanceof Error ? e.message : "Could not refresh files."
        )
        setReloadSeq((s) => s + 1)
      } finally {
        setTreeLoading(false)
      }
    },
    [filesRootPath, treeModel]
  )

  useEffect(() => {
    gitOverviewLoadedRef.current = false
    void refreshGitOverview({ showLoading: true })
  }, [refreshGitOverview])

  useEffect(() => {
    if (!gitOverview || gitOverview.error || gitOverview.entries.length === 0) {
      setSelectedChangePath(null)
      return
    }
    setSelectedChangePath((current) => {
      if (
        current &&
        gitOverview.entries.some((entry) => entry.path === current)
      ) {
        return current
      }
      return gitOverview.entries[0]?.path ?? null
    })
  }, [gitOverview])

  useEffect(() => {
    if (!activeTab) return
    setSelectedChangePath(activeTab.path)
  }, [activeTab])

  const openDiffPreview = useCallback(
    (entry: GitChangeRow) => {
      setSelectedChangePath(entry.path)
      openDiffTab({
        absPath: entry.absPath,
        id: `${entry.path}:${entry.indexStatus}${entry.workTreeStatus}`,
        indexStatus: entry.indexStatus,
        path: entry.path,
        workTreeStatus: entry.workTreeStatus,
      })
    },
    [openDiffTab]
  )

  useEffect(() => {
    treeModel.setGitStatus(
      gitOverview && !gitOverview.error
        ? gitOverview.entries.map(mapGitStatus)
        : undefined
    )
  }, [gitOverview, treeModel])

  useEffect(() => {
    if (!filesRootPath) return
    const norm = normalizeFsRoot(filesRootPath)
    void window.electron.fs.watchRoot(norm)
    let treeTimer: ReturnType<typeof setTimeout> | undefined
    let gitTimer: ReturnType<typeof setTimeout> | undefined
    const remove = window.electron.fs.onChanged(
      ({ rootPath: changed, changedPath }) => {
        if (normalizeFsRoot(changed) !== norm) return
        if (treeTimer !== undefined) clearTimeout(treeTimer)
        treeTimer = setTimeout(() => {
          treeTimer = undefined
          if (changedPath) {
            void runPartialTreeRefresh(changedPath).catch(() =>
              setReloadSeq((s) => s + 1)
            )
          } else {
            setReloadSeq((s) => s + 1)
          }
        }, 50)
        if (gitTimer !== undefined) clearTimeout(gitTimer)
        gitTimer = setTimeout(() => {
          gitTimer = undefined
          void refreshGitOverview({ showLoading: false })
        }, 200)
      }
    )
    return () => {
      remove()
      if (treeTimer !== undefined) clearTimeout(treeTimer)
      if (gitTimer !== undefined) clearTimeout(gitTimer)
      window.electron.fs.unwatchRoot(norm)
    }
  }, [filesRootPath, refreshGitOverview, runPartialTreeRefresh])

  const changeCount =
    gitOverview && !gitOverview.error ? gitOverview.entries.length : 0

  const changedPaths =
    gitOverview && !gitOverview.error
      ? gitOverview.entries.map((entry) => entry.path)
      : []

  const stagedPaths =
    gitOverview && !gitOverview.error
      ? gitOverview.entries
          .filter((entry) => changeEntryStagingFlags(entry).hasStaged)
          .map((entry) => entry.path)
      : []

  const stageChangePath = useCallback(
    async (relPath: string) => {
      const norm = normalizeFsRoot(filesRootPath)
      if (!norm) return
      try {
        await window.electron.git.stagePaths(norm, [relPath])
      } finally {
        await refreshGitOverview({ showLoading: false })
      }
    },
    [filesRootPath, refreshGitOverview]
  )

  const unstageChangePath = useCallback(
    async (relPath: string) => {
      const norm = normalizeFsRoot(filesRootPath)
      if (!norm) return
      try {
        await window.electron.git.unstagePaths(norm, [relPath])
      } finally {
        await refreshGitOverview({ showLoading: false })
      }
    },
    [filesRootPath, refreshGitOverview]
  )

  const refreshPanel = useCallback(() => {
    void refreshGitOverview({ showLoading: true })
    setReloadSeq((s) => s + 1)
  }, [refreshGitOverview])

  const addSidebarTerminal = useCallback(() => {
    setSidebarTerminalState((t) => {
      const id = crypto.randomUUID()
      return {
        terminalIds: [...t.terminalIds, id],
        activeMain: { kind: "terminal", id },
      }
    })
  }, [])

  const removeSidebarTerminal = useCallback((id: string) => {
    setSidebarTerminalState((t) => {
      if (t.terminalIds.length === 1 && t.terminalIds[0] === id) {
        const newId = crypto.randomUUID()
        const nextActive: SidebarLowerMainTab =
          t.activeMain.kind === "terminal" && t.activeMain.id === id
            ? { kind: "terminal", id: newId }
            : t.activeMain
        return { terminalIds: [newId], activeMain: nextActive }
      }
      const idx = t.terminalIds.indexOf(id)
      if (idx < 0) return t
      const terminalIds = t.terminalIds.filter((x) => x !== id)
      let activeMain = t.activeMain
      if (t.activeMain.kind === "terminal" && t.activeMain.id === id) {
        activeMain = {
          kind: "terminal",
          id: terminalIds[Math.min(idx, terminalIds.length - 1)]!,
        }
      }
      return { terminalIds, activeMain }
    })
  }, [])

  const selectSidebarLowerTab = useCallback((next: SidebarLowerMainTab) => {
    setSidebarTerminalState((t) => {
      if (next.kind === "terminal" && !t.terminalIds.includes(next.id)) {
        return t
      }
      return { ...t, activeMain: next }
    })
  }, [])

  if (!repoPath) return null

  const workingTitle =
    gitOverview && !gitOverview.error && gitOverview.branch
      ? gitOverview.branch
      : gitOverviewLoading
        ? "…"
        : "Working…"

  const branchLabelPending = Boolean(
    gitOverviewLoading &&
    !(gitOverview && !gitOverview.error && gitOverview.branch)
  )

  const safeArea = (
    <Sidebar.SectionHeader className="h-full min-h-9 ateli-surface-input-stripe">
      {/* The outer titlebar (z-[999]) is the drag region. Interactive
          elements in the safe zone must sit above it AND be marked
          no-drag, otherwise clicks fall through to the drag handler. */}
      <span
        className={cn(
          "relative z-[1000] min-w-0 flex-1 truncate font-mono text-xs leading-none text-foreground",
          branchLabelPending && "animate-pulse text-muted-foreground"
        )}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        title={workingTitle}
      >
        {workingTitle}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(workspaceIconButtonClass, "relative z-[1000]")}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          aria-label="Workspace menu"
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onClick={refreshPanel}>
            Refresh files and git
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void window.electron.fs.openPath(repoPath)}
          >
            Open repository folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Sidebar.SectionHeader>
  )

  return (
    <SidebarShell
      side="right"
      defaultWidth={240}
      minWidth={120}
      safeArea={safeArea}
    >
      <Sidebar.Root>
        <SidebarTabStrip ariaLabel="Workspace panel">
          <SidebarTabButton
            selected={panelTab === "files"}
            onClick={() => setPanelTab("files")}
          >
            Files
          </SidebarTabButton>
          <SidebarTabButton
            selected={panelTab === "changes"}
            onClick={() => setPanelTab("changes")}
          >
            <span>Changes</span>
            {changeCount > 0 ? (
              <span
                className={cn(
                  "font-mono text-[11px] tabular-nums",
                  panelTab === "changes"
                    ? "text-accent-foreground/80"
                    : "text-muted-foreground/60"
                )}
              >
                {changeCount}
              </span>
            ) : null}
          </SidebarTabButton>
        </SidebarTabStrip>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* px-0 here — Pierre's tree manages its own inline padding
              (overridden to 8px to match the tab strip above). Changes
              panel adds its own px-2 below for the same alignment. */}
          <Sidebar.Section className="min-h-0 flex-[2] overflow-hidden px-0 [scrollbar-gutter:stable]">
            {panelTab === "files" ? (
              treeError ? (
                <p className={cn(changesPanelHintClass, "px-2 py-1")}>
                  Could not read files.
                </p>
              ) : treeLoading && treePathCount === 0 ? (
                <p className={cn(changesPanelHintClass, "px-2 py-1")}>
                  Loading files…
                </p>
              ) : treePathCount === 0 ? (
                <p className={cn(changesPanelHintClass, "px-2 py-1")}>
                  No visible files.
                </p>
              ) : (
                <div ref={treeWrapperRef} className="h-full min-h-0">
                  <PierreFileTree
                    aria-label="Repository files"
                    model={treeModel}
                    style={SIDEBAR_PIERRE_TREE_STYLE}
                  />
                </div>
              )
            ) : (
              <div className="flex h-full min-h-0 flex-col overflow-hidden px-2 py-1">
                <ChangesCommitPanel
                  repoPath={normalizeFsRoot(filesRootPath)}
                  gitReady={Boolean(gitOverview && !gitOverview.error)}
                  stagedPaths={stagedPaths}
                  changedPaths={changedPaths}
                  onGitMutated={() =>
                    void refreshGitOverview({ showLoading: false })
                  }
                />
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                  <ChangesList
                    overview={gitOverview}
                    loading={gitOverviewLoading}
                    selectedPath={selectedChangePath}
                    onOpenDiff={openDiffPreview}
                    onStagePath={(p) => {
                      void stageChangePath(p)
                    }}
                    onUnstagePath={(p) => {
                      void unstageChangePath(p)
                    }}
                  />
                </div>
              </div>
            )}
          </Sidebar.Section>
          <div className="flex min-h-0 min-w-0 flex-[1] flex-col overflow-hidden">
            <SidebarTerminalTabs
              cwd={normalizeFsRoot(repoPath)}
              terminalIds={sidebarTerminalState.terminalIds}
              activeMain={sidebarTerminalState.activeMain}
              onSelectMain={selectSidebarLowerTab}
              onCloseTerminal={removeSidebarTerminal}
              onSessionEnded={removeSidebarTerminal}
              onAddTab={addSidebarTerminal}
            />
          </div>
        </div>
      </Sidebar.Root>
    </SidebarShell>
  )
})

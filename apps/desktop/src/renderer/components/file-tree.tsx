import type { MutableRefObject } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Eye, File, MoreHorizontal } from "lucide-react"
import { track, useEditor } from "tldraw"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { getRepoPath } from "@/lib/default-actions"
import { useWorktrees } from "@/contexts/worktree-index-context"
import { normalizeFsRoot, resolveFilesRootFromCwd } from "@/lib/worktree-files-root"
import { SidebarShell } from "@/components/sidebar-shell"
import { SidebarTerminalDock } from "@/components/sidebar-terminal-dock"
import { chromeIconTriggerClass } from "@/components/sidebar-workspace-chrome"
import {
  SidebarTreeBranch,
  SidebarTreeRow,
} from "@/components/sidebar-tree"

type FilesPanelTab = "files" | "changes" | "checks"

function filePanelTabClass(selected: boolean) {
  return cn(
    "min-h-9 px-1.5 text-center text-[10px] font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
    selected
      ? "bg-muted/45 text-foreground"
      : "text-muted-foreground hover:bg-muted/20 hover:text-foreground/90",
  )
}

type GitChangesOverview = Awaited<ReturnType<typeof window.electron.git.status>>

type GitChangeRow = GitChangesOverview["entries"][number]

function splitRepoPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf("/")
  if (i < 0) return { dir: "", name: p }
  return { dir: p.slice(0, i + 1), name: p.slice(i + 1) }
}

function gitStatusTitle(indexStatus: string, workTreeStatus: string): string {
  const slot = (c: string) => (c === " " ? "unchanged" : c)
  return `Git: index ${slot(indexStatus)}, worktree ${slot(workTreeStatus)}`
}

type GitStatusBadge = {
  letter: string
  className: string
  label: string
}

function gitStatusBadge(
  letter: string,
  className: string,
  label: string,
): GitStatusBadge {
  return { letter, className, label }
}

function statusLetterBadge(
  indexStatus: string,
  workTreeStatus: string,
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

function DiffStat({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) {
    return (
      <span className="text-[10px] text-muted-foreground tabular-nums">—</span>
    )
  }
  return (
    <span className="flex shrink-0 items-baseline gap-1 text-[10px] tabular-nums">
      {added > 0 ? (
        <span className="font-medium text-emerald-500/95">+{added}</span>
      ) : null}
      {removed > 0 ? (
        <span className="font-medium text-rose-500/95">−{removed}</span>
      ) : null}
    </span>
  )
}

function ChangeFileRow({ entry }: { entry: GitChangeRow }) {
  const { dir, name } = splitRepoPath(entry.path)
  const badge = statusLetterBadge(entry.indexStatus, entry.workTreeStatus)
  const statusTitle = gitStatusTitle(entry.indexStatus, entry.workTreeStatus)
  const buttonTitle = `${entry.absPath}\n${statusTitle}`
  const badgeDescription = `${badge.label} — ${statusTitle}`

  return (
    <div
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 rounded-sm py-px pl-1.5 pr-0",
        "hover:bg-accent",
      )}
    >
      <button
        type="button"
        className={cn(
          "min-w-0 rounded-sm px-0 py-0 text-left font-mono text-[11px] leading-tight transition-colors",
          "text-muted-foreground hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
        title={buttonTitle}
        onClick={() => void window.electron.fs.openPath(entry.absPath)}
      >
        <span className="block min-w-0 truncate">
          {dir ? (
            <span className="text-muted-foreground">{dir}</span>
          ) : null}
          <span className="text-foreground">{name}</span>
        </span>
      </button>
      <div className="flex min-w-[3.25rem] shrink-0 justify-end tabular-nums">
        <DiffStat added={entry.added} removed={entry.removed} />
      </div>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center font-mono text-[10px] font-semibold tabular-nums",
          badge.className,
        )}
        title={badgeDescription}
        aria-label={`${badge.label}. ${statusTitle}`}
      >
        {badge.letter}
      </span>
    </div>
  )
}

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

function pathDepth(p: string): number {
  return p.split(/[/\\]/).filter(Boolean).length
}

function FileTreeRows({
  rootPath,
  expanded,
  toggleDir,
  cacheRef,
}: {
  rootPath: string
  expanded: Set<string>
  toggleDir: (path: string) => void
  cacheRef: MutableRefObject<Map<string, DirEntry[]>>
}) {
  const entries = cacheRef.current.get(rootPath)
  if (!entries) return null

  return (
    <>
      {entries.map((entry) => (
        <div key={entry.path}>
          {entry.isDirectory ? (
            <>
              <SidebarTreeRow>
                <SidebarTreeRow.Trigger
                  onClick={() => toggleDir(entry.path)}
                  title={entry.path}
                >
                  <SidebarTreeRow.Disclosure
                    expanded={expanded.has(entry.path)}
                  />
                  <SidebarTreeRow.Label>{entry.name}</SidebarTreeRow.Label>
                </SidebarTreeRow.Trigger>
                <SidebarTreeRow.AlignedEnd />
              </SidebarTreeRow>
              {expanded.has(entry.path) && (
                <SidebarTreeBranch>
                  <SidebarTreeBranch.Ruler />
                  <SidebarTreeBranch.Content>
                    <FileTreeRows
                      rootPath={entry.path}
                      expanded={expanded}
                      toggleDir={toggleDir}
                      cacheRef={cacheRef}
                    />
                  </SidebarTreeBranch.Content>
                </SidebarTreeBranch>
              )}
            </>
          ) : (
            <SidebarTreeRow>
              <SidebarTreeRow.Trigger
                className="text-muted-foreground hover:text-accent-foreground"
                onClick={() => void window.electron.fs.openPath(entry.path)}
                title={entry.path}
              >
                <SidebarTreeRow.Icon>
                  <File className="size-3 shrink-0 opacity-70" />
                </SidebarTreeRow.Icon>
                <SidebarTreeRow.Label>{entry.name}</SidebarTreeRow.Label>
              </SidebarTreeRow.Trigger>
              <SidebarTreeRow.AlignedEnd />
            </SidebarTreeRow>
          )}
        </div>
      ))}
    </>
  )
}

const changesPanelHintClass =
  "py-2 pl-1.5 text-[10px] leading-tight text-muted-foreground"

function ChangesList({
  overview,
  loading,
}: {
  overview: GitChangesOverview | null
  loading: boolean
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
      {overview.entries.map((e, i) => (
        <ChangeFileRow
          key={`${i}:${e.path}:${e.indexStatus}${e.workTreeStatus}`}
          entry={e}
        />
      ))}
    </div>
  )
}

export const FileTree = track(function FileTree() {
  const editor = useEditor()
  const repoPath = getRepoPath()
  const worktrees = useWorktrees()
  const [panelTab, setPanelTab] = useState<FilesPanelTab>("files")
  const [gitOverview, setGitOverview] = useState<GitChangesOverview | null>(null)
  const [gitOverviewLoading, setGitOverviewLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    repoPath ? new Set([normalizeFsRoot(repoPath)]) : new Set(),
  )
  const [reloadSeq, setReloadSeq] = useState(0)
  const [, setRenderVersion] = useState(0)
  const cacheRef = useRef<Map<string, DirEntry[]>>(new Map())

  const bump = useCallback(() => {
    setRenderVersion((v) => v + 1)
  }, [])

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
      setExpanded(new Set())
      cacheRef.current = new Map()
      return
    }
    const norm = normalizeFsRoot(filesRootPath)
    setExpanded(new Set([norm]))
    cacheRef.current = new Map()
    setReloadSeq((s) => s + 1)
  }, [filesRootPath])

  useEffect(() => {
    if (!filesRootPath) return
    const norm = normalizeFsRoot(filesRootPath)
    void window.electron.fs.watchRoot(norm)
    const remove = window.electron.fs.onChanged(({ rootPath: changed }) => {
      if (normalizeFsRoot(changed) === norm) {
        setReloadSeq((s) => s + 1)
      }
    })
    return () => {
      remove()
      window.electron.fs.unwatchRoot(norm)
    }
  }, [filesRootPath])

  useEffect(() => {
    if (!filesRootPath) return
    let cancelled = false
    const norm = normalizeFsRoot(filesRootPath)
    const dirs = [...expanded].sort((a, b) => pathDepth(a) - pathDepth(b))

    ;(async () => {
      for (const dir of dirs) {
        try {
          const { entries } = await window.electron.fs.readdir(dir)
          if (cancelled) return
          cacheRef.current.set(dir, entries)
        } catch {
          if (cancelled) return
          cacheRef.current.set(dir, [])
        }
      }
      if (!cancelled) bump()
    })()

    return () => {
      cancelled = true
    }
  }, [filesRootPath, expanded, reloadSeq, bump])

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
    [filesRootPath],
  )

  useEffect(() => {
    gitOverviewLoadedRef.current = false
    void refreshGitOverview({ showLoading: true })
  }, [refreshGitOverview])

  useEffect(() => {
    if (!filesRootPath) return
    const norm = normalizeFsRoot(filesRootPath)
    let debounce: ReturnType<typeof setTimeout> | undefined
    const remove = window.electron.fs.onChanged(({ rootPath: changed }) => {
      if (normalizeFsRoot(changed) !== norm) return
      if (debounce !== undefined) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = undefined
        void refreshGitOverview({ showLoading: false })
      }, 200)
    })
    return () => {
      if (debounce !== undefined) clearTimeout(debounce)
      remove()
    }
  }, [filesRootPath, refreshGitOverview])

  const changeCount =
    gitOverview && !gitOverview.error ? gitOverview.entries.length : 0

  const toggleDir = useCallback((dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

  const refreshPanel = useCallback(() => {
    void refreshGitOverview({ showLoading: true })
    setReloadSeq((s) => s + 1)
  }, [refreshGitOverview])

  if (!repoPath) return null

  const norm = normalizeFsRoot(filesRootPath)

  const workingTitle =
    gitOverview && !gitOverview.error && gitOverview.branch
      ? gitOverview.branch
      : gitOverviewLoading
        ? "…"
        : "Working…"

  const branchLabelPending = Boolean(
    gitOverviewLoading && !(gitOverview && !gitOverview.error && gitOverview.branch),
  )

  const safeArea = (
    <>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-[10px] leading-none text-foreground/90",
          branchLabelPending && "animate-pulse text-muted-foreground",
        )}
        title={workingTitle}
      >
        {workingTitle}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={chromeIconTriggerClass}
          aria-label="Workspace menu"
        >
          <MoreHorizontal className="size-3.5 opacity-80" />
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
    </>
  )

  return (
    <SidebarShell side="right" defaultWidth={240} minWidth={120} safeArea={safeArea}>
      <div className="box-border flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3">
        <div className="flex w-full min-w-0 items-stretch border-b border-border/50">
          <div
            className="grid min-w-0 flex-1 grid-cols-3 divide-x divide-border/40"
            role="tablist"
            aria-label="Workspace panel"
          >
            <button
              type="button"
              role="tab"
              aria-selected={panelTab === "files"}
              className={filePanelTabClass(panelTab === "files")}
              onClick={() => setPanelTab("files")}
            >
              Files
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panelTab === "changes"}
              className={cn(
                filePanelTabClass(panelTab === "changes"),
                "inline-flex items-center justify-center gap-1",
              )}
              onClick={() => setPanelTab("changes")}
            >
              <span>Changes</span>
              {changeCount > 0 ? (
                <span className="font-mono text-[9px] tabular-nums text-muted-foreground/90">
                  {changeCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panelTab === "checks"}
              className={filePanelTabClass(panelTab === "checks")}
              onClick={() => setPanelTab("checks")}
            >
              Checks
            </button>
          </div>
          <div className="flex shrink-0 items-stretch border-l border-border/40">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-pressed={panelTab === "changes"}
              className={cn(
                "h-auto min-h-9 w-9 shrink-0 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground",
                panelTab === "changes" && "bg-muted/60 text-foreground",
              )}
              title="Review changes"
              aria-label="Review changes"
              onClick={() => setPanelTab("changes")}
            >
              <Eye className="size-3.5 opacity-80" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2 pt-1 [scrollbar-gutter:stable]">
            {panelTab === "checks" ? (
              <div className="border border-dashed border-border/50 bg-muted/10 px-3 py-6 text-center">
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  No checks configured for this repo.
                </p>
              </div>
            ) : panelTab === "files" ? (
              <FileTreeRows
                rootPath={norm}
                expanded={expanded}
                toggleDir={toggleDir}
                cacheRef={cacheRef}
              />
            ) : (
              <ChangesList
                overview={gitOverview}
                loading={gitOverviewLoading}
              />
            )}
          </div>
          <SidebarTerminalDock
            editor={editor}
            repoPath={repoPath}
            worktrees={worktrees}
          />
        </div>
      </div>
    </SidebarShell>
  )
})

import { useEffect, useMemo, useState } from "react"
import { PatchDiff } from "@pierre/diffs/react"
import { Compass, ExternalLink, FileCode2, X } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { SidebarTabButton } from "@/components/sidebar-tab-button"
import { getRepoPath } from "@/lib/default-actions"
import { normalizeFsRoot } from "@/lib/worktree-files-root"
import {
  useDiffPreviewTabs,
  type DiffPreviewTab,
} from "@/contexts/diff-preview-tabs-context"

type GitDiffResult = Awaited<ReturnType<typeof window.electron.git.diff>>

function splitPath(path: string) {
  const index = path.lastIndexOf("/")
  if (index < 0) return { dir: "", name: path }
  return {
    dir: path.slice(0, index + 1),
    name: path.slice(index + 1),
  }
}

function DiffPreviewPane({ tab }: { tab: DiffPreviewTab }) {
  const repoPath = getRepoPath()
  const [patch, setPatch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!repoPath) return
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)
      const result: GitDiffResult = await window.electron.git.diff({
        repoPath: normalizeFsRoot(repoPath),
        path: tab.path,
        absPath: tab.absPath,
        indexStatus: tab.indexStatus,
        workTreeStatus: tab.workTreeStatus,
      })
      if (cancelled) return
      setPatch(result.patch)
      setError(result.error)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [repoPath, tab])

  if (loading && !patch) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">Loading diff…</p>
    )
  }

  if (error) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Could not read diff.
      </p>
    )
  }

  if (!patch) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        No patch available.
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4 py-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-foreground">
            {tab.path}
          </p>
          <p className="text-[11px] text-muted-foreground">Diff preview</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => void window.electron.fs.openPath(tab.absPath)}
        >
          <ExternalLink className="size-3.5" />
          <span>Open File</span>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <PatchDiff
          patch={patch}
          disableWorkerPool
          className="h-full min-h-0"
          options={{
            diffStyle: "unified",
            disableLineNumbers: true,
            hunkSeparators: "line-info-basic",
            overflow: "wrap",
          }}
          style={
            {
              height: "100%",
              "--diffs-bg": "transparent",
            } as React.CSSProperties
          }
        />
      </div>
    </div>
  )
}

export function DiffPreviewTabs() {
  const {
    activeTab,
    activeTabId,
    canvasSelected,
    closeTab,
    selectCanvas,
    selectTab,
    tabs,
  } = useDiffPreviewTabs()

  if (tabs.length === 0) return null

  return (
    <div className="pointer-events-auto flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 border-b border-border bg-card/96 text-card-foreground backdrop-blur-md">
        <div
          role="tablist"
          aria-label="Center panel"
          className="flex min-h-0 w-full items-center gap-1 overflow-x-auto px-3 py-1.5"
        >
          <SidebarTabButton
            selected={canvasSelected}
            className="shrink-0"
            onClick={selectCanvas}
            title="Return to canvas"
          >
            <Compass className="size-3.5 shrink-0" />
            <span>Canvas</span>
          </SidebarTabButton>
          {tabs.map((tab) => {
            const { dir, name } = splitPath(tab.path)
            const selected = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={cn(
                  "group/tab flex max-w-[20rem] min-w-0 items-center gap-1 rounded-[3px] pr-1",
                  selected
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
              >
                <SidebarTabButton
                  selected={selected}
                  className="max-w-full min-w-0 flex-1 rounded-r-none pr-1"
                  onClick={() => selectTab(tab.id)}
                  title={tab.path}
                >
                  <FileCode2 className="size-3.5 shrink-0" />
                  <span className="truncate">{name}</span>
                </SidebarTabButton>
                <button
                  type="button"
                  className="flex size-5 shrink-0 items-center justify-center rounded-[2px] hover:bg-foreground/10"
                  aria-label={`Close ${name}`}
                  title={`Close ${dir}${name}`}
                  onClick={() => closeTab(tab.id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {activeTab ? (
        <div className="min-h-0 flex-1 overflow-hidden border-r border-l border-border bg-card/96 text-card-foreground backdrop-blur-md">
          <div className="h-full min-h-0 overflow-auto">
            <DiffPreviewPane tab={activeTab} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

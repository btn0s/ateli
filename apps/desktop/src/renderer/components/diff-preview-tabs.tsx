import { useEffect, useMemo, useState } from "react"
import { PatchDiff } from "@pierre/diffs/react"
import { FileCode2, X } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
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
    return <p className="px-4 py-3 text-xs text-muted-foreground">Loading diff…</p>
  }

  if (error) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">Could not read diff.</p>
    )
  }

  if (!patch) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">No patch available.</p>
    )
  }

  return (
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
      style={{
        height: "100%",
        "--diffs-bg": "transparent",
      } as React.CSSProperties}
    />
  )
}

export function DiffPreviewTabs() {
  const { activeTabId, closeTab, selectTab, tabs } = useDiffPreviewTabs()

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
  )

  if (tabs.length === 0) return null

  return (
    <div className="pointer-events-auto flex h-full min-h-0 flex-1 flex-col overflow-hidden border-l border-r border-border bg-card/96 text-card-foreground backdrop-blur-md">
      <div
        role="tablist"
        aria-label="Diff previews"
        className="flex min-h-0 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5"
      >
        {tabs.map((tab) => {
          const { dir, name } = splitPath(tab.path)
          const selected = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className={cn(
                "group/tab flex min-w-0 max-w-[20rem] items-center gap-1 rounded-[3px] pr-1",
                selected
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <SidebarTabButton
                selected={selected}
                className="min-w-0 max-w-full flex-1 rounded-r-none pr-1"
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
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab ? <DiffPreviewPane tab={activeTab} /> : null}
      </div>
    </div>
  )
}

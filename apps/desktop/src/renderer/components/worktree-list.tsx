import { useState, useEffect, useCallback } from "react"
import { track, useEditor } from "tldraw"
import type { TLShapeId } from "tldraw"
import { Plus, ChevronRight } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { addTerminalAtCenter } from "@/lib/default-actions"
import { SidebarPanelHeader } from "@/components/sidebar-panel-header"
import { cn } from "@workspace/ui/lib/utils"

interface WorktreeInfo {
  path: string
  branch: string
  head: string
  isMain: boolean
}

export const WorktreeList = track(function WorktreeList({
  repoPath,
}: {
  repoPath: string
}) {
  const editor = useEditor()
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [expanded, setExpanded] = useState(
    () => new Set<string>([repoPath]),
  )

  const refresh = useCallback(() => {
    window.electron.worktree.list(repoPath).then(setWorktrees)
  }, [repoPath])

  useEffect(() => {
    refresh()
    const remove = window.electron.rpc.onNotification(({ method }) => {
      if (method === "worktree.created" || method === "worktree.removed") {
        refresh()
      }
    })
    return remove
  }, [refresh])

  // Get all terminal shapes reactively
  const terminalShapes = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "terminal")

  // Main repo first, then non-main worktrees (avoid duplicate main)
  const mainWt = worktrees.find((w) => w.isMain)
  const entries: WorktreeInfo[] = [
    mainWt ?? { path: repoPath, branch: "main", head: "", isMain: true },
    ...worktrees.filter((w) => !w.isMain),
  ]

  function toggleExpanded(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function navigateToShape(shapeId: TLShapeId) {
    editor.select(shapeId)
    editor.zoomToSelection({ animation: { duration: 200 } })
  }

  return (
    <div className="flex flex-col gap-0.5">
      <SidebarPanelHeader>
        <SidebarPanelHeader.Title>Worktrees</SidebarPanelHeader.Title>
        <SidebarPanelHeader.Trailer>
          <SidebarPanelHeader.CountSpacer />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            title="New worktree"
            onClick={() => {
              const branch = `ateli/${Date.now().toString(36)}`
              window.electron.worktree.create(repoPath, branch)
            }}
          >
            <Plus />
          </Button>
        </SidebarPanelHeader.Trailer>
      </SidebarPanelHeader>

      {entries.map((wt) => {
        const rowKey = wt.isMain ? repoPath : wt.path
        const cwdForTerminal = wt.isMain ? repoPath : wt.path

        const terminals = terminalShapes.filter((s) => {
          const cwd = (s.props as { cwd?: string }).cwd
          if (!cwd) return wt.isMain
          if (wt.isMain) {
            // Main gets terminals whose cwd is the repo root (not inside a worktree)
            return (
              cwd === repoPath ||
              (cwd.startsWith(repoPath) &&
                !worktrees.some((w) => cwd.startsWith(w.path)))
            )
          }
          return cwd.startsWith(wt.path)
        })

        const isExpanded = expanded.has(rowKey)

        return (
          <div key={rowKey}>
            <div className="flex w-full items-center gap-0.5 rounded-sm px-1 py-0.5 hover:bg-accent">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 rounded-sm px-0.5 py-0.5 text-left text-xs transition-colors"
                onClick={() => toggleExpanded(rowKey)}
                title={wt.path}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  <ChevronRight
                    className={cn(
                      "size-3 text-muted-foreground transition-transform",
                      isExpanded && "rotate-90",
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {wt.isMain ? "main" : wt.branch}
                </span>
              </button>
              <span className="min-w-[2ch] shrink-0 text-right tabular-nums text-[10px] text-muted-foreground">
                {terminals.length}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                title="Add terminal"
                onClick={() =>
                  addTerminalAtCenter(editor, { cwd: cwdForTerminal })
                }
              >
                <Plus />
              </Button>
            </div>

            {isExpanded && (
              <div className="flex items-stretch gap-1 py-0.5 pl-1">
                <div className="flex shrink-0 pl-0.5">
                  <div className="relative w-4 shrink-0">
                    <div
                      aria-hidden
                      className="bg-border/45 absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2"
                    />
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  {terminals.map((shape) => {
                    const props = shape.props as { cwd?: string }
                    const label = props.cwd
                      ? props.cwd.split("/").pop() || "Terminal"
                      : "Terminal"

                    return (
                      <button
                        type="button"
                        key={shape.id}
                        className="flex w-full rounded-sm px-1 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        onClick={() => navigateToShape(shape.id)}
                        title={props.cwd}
                      >
                        <span className="truncate">{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})

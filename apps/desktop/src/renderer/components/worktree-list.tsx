import { useState, useEffect, useCallback } from "react"
import { track, useEditor } from "tldraw"
import type { TLShapeId } from "tldraw"
import { GitBranch, Plus, TerminalSquare, ChevronRight } from "lucide-react"
import { addTerminalAtCenter } from "@/lib/default-actions"
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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

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
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Worktrees
        </span>
        <button
          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            const branch = `ateli/${Date.now().toString(36)}`
            window.electron.worktree.create(repoPath, branch)
          }}
          title="New worktree"
        >
          <Plus className="size-3" />
        </button>
      </div>

      {entries.map((wt) => {
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

        const isExpanded = expanded.has(wt.path)
        const hasTerminals = terminals.length > 0

        return (
          <div key={wt.path}>
            <button
              className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent"
              onClick={() => {
                if (hasTerminals) {
                  toggleExpanded(wt.path)
                } else {
                  addTerminalAtCenter(editor, { cwd: wt.path })
                }
              }}
              title={wt.path}
            >
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {wt.isMain ? "main" : wt.branch}
              </span>
              {hasTerminals && (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {terminals.length}
                </span>
              )}
              <div className="flex-1" />
              {hasTerminals && (
                <ChevronRight
                  className={cn(
                    "size-3 shrink-0 text-muted-foreground transition-transform",
                    isExpanded && "rotate-90",
                  )}
                />
              )}
            </button>

            {isExpanded &&
              terminals.map((shape) => {
                const props = shape.props as { cwd?: string }
                const label = props.cwd
                  ? props.cwd.split("/").pop() || "Terminal"
                  : "Terminal"

                return (
                  <button
                    key={shape.id}
                    className="flex w-full items-center gap-1.5 rounded-sm py-0.5 pl-8 pr-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={() => navigateToShape(shape.id)}
                    title={props.cwd}
                  >
                    <TerminalSquare className="size-3 shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                )
              })}
          </div>
        )
      })}
    </div>
  )
})

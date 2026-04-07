import { useState, useEffect } from "react"
import { track, useEditor } from "tldraw"
import type { TLShapeId } from "tldraw"
import { Plus, Terminal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { addTerminalAtCenter } from "@/lib/default-actions"
import { SidebarPanelHeader } from "@/components/sidebar-panel-header"
import {
  SidebarTreeBranch,
  SidebarTreeRow,
} from "@/components/sidebar-tree"
import {
  useWorktrees,
  type WorktreeIndexEntry,
} from "@/contexts/worktree-index-context"
import { terminalsBelongingToWorktree } from "@/lib/worktree-terminals"

export const WorktreeList = track(function WorktreeList({
  repoPath,
}: {
  repoPath: string
}) {
  const editor = useEditor()
  const worktrees = useWorktrees()
  const [expanded, setExpanded] = useState(
    () => new Set<string>([repoPath]),
  )

  useEffect(() => {
    setExpanded(new Set([repoPath]))
  }, [repoPath])

  // Get all terminal shapes reactively
  const terminalShapes = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "terminal")

  // Main repo first, then non-main worktrees (avoid duplicate main)
  const mainWt = worktrees.find((w) => w.isMain)
  const entries: WorktreeIndexEntry[] = [
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
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
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

        const terminals = terminalsBelongingToWorktree(
          repoPath,
          worktrees,
          wt,
          terminalShapes,
        )

        const isExpanded = expanded.has(rowKey)

        return (
          <div key={rowKey}>
            <SidebarTreeRow>
              <SidebarTreeRow.Trigger
                onClick={() => toggleExpanded(rowKey)}
                title={wt.path}
              >
                <SidebarTreeRow.Disclosure expanded={isExpanded} />
                <SidebarTreeRow.Label>
                  {wt.isMain ? "main" : wt.branch}
                </SidebarTreeRow.Label>
              </SidebarTreeRow.Trigger>
              <SidebarTreeRow.Meta>{terminals.length}</SidebarTreeRow.Meta>
              <SidebarTreeRow.Actions>
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
              </SidebarTreeRow.Actions>
            </SidebarTreeRow>

            {isExpanded && (
              <SidebarTreeBranch>
                <SidebarTreeBranch.Ruler />
                <SidebarTreeBranch.Content>
                  {terminals.map((shape) => {
                    const props = shape.props as { cwd?: string }
                    const label = props.cwd
                      ? props.cwd.split("/").pop() || "Terminal"
                      : "Terminal"

                    return (
                      <SidebarTreeRow key={shape.id}>
                        <SidebarTreeRow.Trigger
                          className="text-muted-foreground hover:text-accent-foreground"
                          onClick={() => navigateToShape(shape.id)}
                          title={props.cwd}
                        >
                          <SidebarTreeRow.Icon>
                            <Terminal className="size-3 shrink-0 opacity-70" />
                          </SidebarTreeRow.Icon>
                          <SidebarTreeRow.Label>{label}</SidebarTreeRow.Label>
                        </SidebarTreeRow.Trigger>
                        <SidebarTreeRow.AlignedEnd />
                      </SidebarTreeRow>
                    )
                  })}
                </SidebarTreeBranch.Content>
              </SidebarTreeBranch>
            )}
          </div>
        )
      })}
    </div>
  )
})

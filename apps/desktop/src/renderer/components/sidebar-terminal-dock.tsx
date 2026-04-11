import { Plus } from "lucide-react"
import type { Editor } from "tldraw"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { WORKSPACE_PANEL_BLEED } from "@/components/sidebar-workspace-chrome"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import { addTerminalAtCenter } from "@/lib/default-actions"
import { terminalTitleFromCwd } from "@/lib/terminal-worktree-title"

function selectedTerminalShape(editor: Editor) {
  const ids = editor.getSelectedShapeIds()
  if (ids.length !== 1) return null
  const s = editor.getShape(ids[0]!)
  if (s?.type !== "terminal") return null
  return s
}

export function SidebarTerminalDock({
  editor,
  repoPath,
  worktrees,
}: {
  editor: Editor
  repoPath: string
  worktrees: WorktreeIndexEntry[]
}) {
  const shape = selectedTerminalShape(editor)
  const title = shape
    ? terminalTitleFromCwd(shape.props.cwd, repoPath, worktrees)
    : null

  return (
    <div
      className={cn(
        WORKSPACE_PANEL_BLEED,
        "flex shrink-0 flex-col border-t border-border bg-muted",
      )}
    >
      <div className="flex h-8 items-center justify-between gap-1 border-b border-border px-2">
        <span className="text-xs font-medium text-muted-foreground uppercase">
          Terminal
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          title="New terminal on canvas"
          aria-label="New terminal on canvas"
          onClick={() => addTerminalAtCenter(editor)}
        >
          <Plus />
        </Button>
      </div>
      <div className="px-2 py-2">
        {shape ? (
          <div className="flex flex-col gap-2">
            <p className="truncate font-mono text-xs text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">
              Session I/O stays on the canvas; select the shape there to type.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                editor.zoomToSelection({ animation: { duration: 200 } })
              }
            >
              Zoom to terminal
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Select a terminal on the canvas to show its session title here.
          </p>
        )}
      </div>
    </div>
  )
}

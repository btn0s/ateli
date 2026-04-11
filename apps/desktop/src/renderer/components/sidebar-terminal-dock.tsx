import { Plus } from "lucide-react"
import type { Editor } from "tldraw"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
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
        "-mx-3 flex w-[calc(100%+1.5rem)] max-w-none shrink-0 flex-col border-border/50 border-t",
        "bg-muted/10 dark:bg-muted/5",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-border/40 border-b px-3 py-1.5">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Terminal
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title="New terminal on canvas"
          onClick={() => addTerminalAtCenter(editor)}
        >
          <Plus className="size-3.5 opacity-90" />
        </Button>
      </div>
      <div className="px-3 py-2.5">
        {shape ? (
          <div className="flex flex-col gap-2.5">
            <p className="truncate font-mono text-[10px] leading-tight text-foreground/95">
              {title}
            </p>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Session I/O is on the canvas — select the shape there to type.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-fit rounded-md text-[10px] font-medium"
              onClick={() =>
                editor.zoomToSelection({ animation: { duration: 200 } })
              }
            >
              Zoom to terminal
            </Button>
          </div>
        ) : (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Select one terminal on the canvas to pin its session details here.
          </p>
        )}
      </div>
    </div>
  )
}

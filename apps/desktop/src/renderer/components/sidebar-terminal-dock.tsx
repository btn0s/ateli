import { ChevronDown, Plus } from "lucide-react"
import type { Editor } from "tldraw"
import { Button } from "@workspace/ui/components/button"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import { addTerminalAtCenter } from "@/lib/default-actions"
import { terminalTitleFromCwd } from "@/lib/terminal-worktree-title"

const FULL_BLEED =
  "-mx-3 flex w-[calc(100%+1.5rem)] max-w-none shrink-0 flex-col border-border/50 border-t bg-card/50"

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
    <div className={FULL_BLEED}>
      <div className="flex items-center gap-2 border-border/50 border-b px-2 py-1">
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span
          className="text-[10px] text-muted-foreground/50"
          title="Coming soon"
        >
          Setup
        </span>
        <span
          className="text-[10px] text-muted-foreground/50"
          title="Use the command palette"
        >
          Spotlight
        </span>
        <span
          className="border-foreground -mb-px border-b-2 pb-0.5 text-[10px] font-medium text-foreground"
          role="tab"
          aria-selected
        >
          Terminal
        </span>
        <div className="min-w-0 flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          title="New terminal on canvas"
          onClick={() => addTerminalAtCenter(editor)}
        >
          <Plus />
        </Button>
      </div>
      <div className="min-h-[100px] px-2 py-2">
        {shape ? (
          <div className="flex flex-col gap-2">
            <p className="truncate text-[11px] font-medium text-foreground">
              {title}
            </p>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Interactive I/O runs on the canvas. Select this shape there to type.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-fit text-[10px]"
              onClick={() =>
                editor.zoomToSelection({ animation: { duration: 200 } })
              }
            >
              Zoom to terminal
            </Button>
          </div>
        ) : (
          <p className="text-[10px] leading-snug text-muted-foreground">
            Select a single terminal on the canvas to see its session title and
            shortcuts here.
          </p>
        )}
      </div>
    </div>
  )
}

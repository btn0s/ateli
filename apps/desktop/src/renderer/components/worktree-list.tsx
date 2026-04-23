import { useState, useEffect } from "react"
import { track, useEditor } from "tldraw"
import type { TLShapeId } from "tldraw"
import { Plus, Terminal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { addTerminalAtCenter } from "@/lib/default-actions"
import { Sidebar } from "@/components/sidebar"
import {
  SidebarTreeBranch,
  SidebarTreeRow,
} from "@/components/sidebar-tree"
import {
  useWorktrees,
  type WorktreeIndexEntry,
} from "@/contexts/worktree-index-context"
import { terminalsBelongingToWorktree } from "@/lib/worktree-terminals"
import { useTerminalKillConfirmation } from "@/components/terminal-kill-dialog"
import { useWorktreeRemoveConfirmation } from "@/components/worktree-remove-dialog"

export const WorktreeList = track(function WorktreeList({
  repoPath,
}: {
  repoPath: string
}) {
  const editor = useEditor()
  const worktrees = useWorktrees()
  const { requestKill, dialog: killDialog } = useTerminalKillConfirmation()
  const { requestRemove, dialog: removeDialog } = useWorktreeRemoveConfirmation()
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
    mainWt ?? {
      id: "",
      path: repoPath,
      branch: "main",
      head: "",
      isMain: true,
      createdAt: "",
      repoPath,
    },
    ...worktrees.filter((w) => !w.isMain),
  ]

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
  }

  async function revealInFinder(p: string) {
    try {
      await window.electron.fs.openPath(p)
    } catch {
      // ignore
    }
  }

  function removeWorktree(wt: WorktreeIndexEntry) {
    if (!wt.id || wt.isMain) return
    requestRemove({
      repoPath,
      id: wt.id,
      branch: wt.branch,
      path: wt.path,
    })
  }

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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Sidebar.SectionHeader>
        <span className="text-xs text-muted-foreground">Worktrees</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-mr-1 text-muted-foreground"
          title="New worktree"
          onClick={() => {
            const branch = `ateli/${Date.now().toString(36)}`
            window.electron.worktree.create(repoPath, branch)
          }}
        >
          <Plus />
        </Button>
      </Sidebar.SectionHeader>
      <Sidebar.Section className="min-h-0 flex-1 overflow-y-auto">

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
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div>
                  <SidebarTreeRow active={isExpanded}>
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
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="z-[300] min-w-48">
                <ContextMenuItem
                  onClick={() =>
                    addTerminalAtCenter(editor, { cwd: cwdForTerminal })
                  }
                >
                  Add terminal here
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => copyText(wt.path)}>
                  Copy path
                </ContextMenuItem>
                <ContextMenuItem onClick={() => revealInFinder(wt.path)}>
                  Reveal in Finder
                </ContextMenuItem>
                {!wt.isMain && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      disabled={!wt.id}
                      onClick={() => removeWorktree(wt)}
                    >
                      Remove worktree
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>

            {isExpanded && (
              <SidebarTreeBranch>
                <SidebarTreeBranch.Ruler />
                <SidebarTreeBranch.Content>
                  {terminals.map((shape) => {
                    const props = shape.props as {
                      cwd?: string
                      sessionId?: string
                    }
                    const label = props.cwd
                      ? props.cwd.split("/").pop() || "Terminal"
                      : "Terminal"

                    return (
                      <ContextMenu key={shape.id}>
                        <ContextMenuTrigger asChild>
                          <div>
                            <SidebarTreeRow>
                              <SidebarTreeRow.Trigger
                                className="text-muted-foreground hover:text-accent-foreground"
                                onClick={() => navigateToShape(shape.id)}
                                title={props.cwd}
                              >
                                <SidebarTreeRow.Icon>
                                  <Terminal className="size-3 shrink-0 opacity-70" />
                                </SidebarTreeRow.Icon>
                                <SidebarTreeRow.Label>
                                  {label}
                                </SidebarTreeRow.Label>
                              </SidebarTreeRow.Trigger>
                              <SidebarTreeRow.AlignedEnd />
                            </SidebarTreeRow>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="z-[300] min-w-44">
                          <ContextMenuItem
                            onClick={() => navigateToShape(shape.id)}
                          >
                            Focus on canvas
                          </ContextMenuItem>
                          {props.cwd && (
                            <>
                              <ContextMenuItem
                                onClick={() => copyText(props.cwd!)}
                              >
                                Copy cwd
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => revealInFinder(props.cwd!)}
                              >
                                Reveal in Finder
                              </ContextMenuItem>
                            </>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            variant="destructive"
                            disabled={!props.sessionId}
                            onClick={() => {
                              if (!props.sessionId) return
                              requestKill({ sessionId: props.sessionId })
                            }}
                          >
                            Kill session
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    )
                  })}
                </SidebarTreeBranch.Content>
              </SidebarTreeBranch>
            )}
          </div>
        )
      })}
      </Sidebar.Section>
      {killDialog}
      {removeDialog}
    </div>
  )
})

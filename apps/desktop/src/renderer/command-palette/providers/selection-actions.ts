import { PenLine, Trash2, FolderGit2, Flame } from "lucide-react"
import type { TLShapeId } from "tldraw"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import type { ManagementPolicy } from "@/contexts/management-policy-context"
import type { TerminalRenameRequest } from "@/components/terminal-rename-dialog"
import type { WorktreeRenameRequest } from "@/components/worktree-rename-dialog"
import type { WorktreeRemoveRequest } from "@/components/worktree-remove-dialog"
import { findWorktreeForCwd, terminalTitleFromCwd } from "@/lib/terminal-worktree-title"
import type { CommandDefinition, CommandExecutionContext } from "../types"

type Env = {
  worktrees: WorktreeIndexEntry[]
  policy: ManagementPolicy["user"]
  requestRenameTerminal: (request: TerminalRenameRequest) => void
  requestRenameWorktree: (request: WorktreeRenameRequest) => void
  requestRemoveWorktrees: (requests: readonly WorktreeRemoveRequest[]) => void
  requestKillSession: (request: { sessionId: string }) => void
}

type SelectedTerminal = {
  id: TLShapeId
  sessionId?: string
  cwd?: string
}

function selectedShapeIds(ctx: CommandExecutionContext): TLShapeId[] {
  return [...ctx.palette.selectionShapeIds] as TLShapeId[]
}

function onlySelectedTerminal(ctx: CommandExecutionContext): SelectedTerminal | null {
  const shape = ctx.editor.getOnlySelectedShape()
  if (!shape || shape.type !== "terminal") {
    return null
  }
  const props = shape.props as { sessionId?: string; cwd?: string }
  return {
    id: shape.id as TLShapeId,
    sessionId: props.sessionId,
    cwd: props.cwd,
  }
}

function worktreeForSelectedTerminal(
  ctx: CommandExecutionContext,
  worktrees: WorktreeIndexEntry[],
): WorktreeIndexEntry | null {
  const terminal = onlySelectedTerminal(ctx)
  if (!terminal?.cwd) return null
  const match = findWorktreeForCwd(terminal.cwd, worktrees)
  if (!match) return null
  return worktrees.find((entry) => entry.path === match.path) ?? null
}

export function createSelectionActionCommands(env: Env): CommandDefinition[] {
  const { worktrees, policy } = env

  const commands: CommandDefinition[] = [
    {
      id: "selection:delete",
      title: "Delete selection",
      subtitle: "Delete the currently selected items from the canvas.",
      icon: Trash2,
      keywords: ["delete", "remove", "selection", "selected"],
      group: "action",
      emptyQuerySection: "suggested",
      when: (ctx) => ctx.palette.selection !== "none",
      score: (ctx) => (ctx.palette.selection !== "none" ? 0.5 : 0),
      run: (ctx) => {
        const ids = selectedShapeIds(ctx)
        if (ids.length === 0) return
        ctx.editor.deleteShapes(ids)
      },
    },
    {
      id: "selection:terminal:rename",
      title: "Rename selected terminal",
      subtitle: "Open the rename dialog for the selected terminal.",
      icon: PenLine,
      keywords: ["rename", "terminal", "selection", "label"],
      group: "action",
      emptyQuerySection: "suggested",
      when: (ctx) =>
        policy.renameTerminal && !!onlySelectedTerminal(ctx)?.sessionId,
      score: () => 0.75,
      run: (ctx) => {
        const terminal = onlySelectedTerminal(ctx)
        if (!terminal?.sessionId) return
        env.requestRenameTerminal({
          sessionKey: terminal.sessionId,
          fallbackLabel: terminalTitleFromCwd(
            terminal.cwd,
            worktrees.find((w) => w.isMain)?.path ?? "",
            worktrees,
          ),
        })
      },
    },
    {
      id: "selection:terminal:kill",
      title: "Kill selected terminal session",
      subtitle: "Terminate the process attached to the selected terminal.",
      icon: Flame,
      keywords: ["kill", "session", "terminal", "stop", "selection"],
      group: "action",
      emptyQuerySection: "actions",
      when: (ctx) => !!onlySelectedTerminal(ctx)?.sessionId,
      run: (ctx) => {
        const terminal = onlySelectedTerminal(ctx)
        if (!terminal?.sessionId) return
        env.requestKillSession({ sessionId: terminal.sessionId })
      },
    },
    {
      id: "selection:worktree:rename",
      title: "Rename selected worktree branch",
      subtitle: "Rename this worktree's branch with git branch -m.",
      icon: FolderGit2,
      keywords: ["rename", "worktree", "branch", "selection"],
      group: "action",
      emptyQuerySection: "suggested",
      when: (ctx) => {
        if (!policy.renameBranch) return false
        const wt = worktreeForSelectedTerminal(ctx, worktrees)
        return !!wt?.id && !wt.isMain
      },
      score: () => 0.65,
      run: (ctx) => {
        const wt = worktreeForSelectedTerminal(ctx, worktrees)
        if (!wt?.id || wt.isMain) return
        env.requestRenameWorktree({
          repoPath: wt.repoPath,
          id: wt.id,
          currentBranch: wt.branch,
        })
      },
    },
    {
      id: "selection:worktree:remove",
      title: "Remove selected worktree",
      subtitle: "Remove the selected terminal's worktree and kill its terminals.",
      icon: Trash2,
      keywords: ["remove", "delete", "worktree", "branch", "selection"],
      group: "action",
      emptyQuerySection: "actions",
      when: (ctx) => {
        const wt = worktreeForSelectedTerminal(ctx, worktrees)
        return !!wt?.id && !wt.isMain
      },
      run: (ctx) => {
        const wt = worktreeForSelectedTerminal(ctx, worktrees)
        if (!wt?.id || wt.isMain) return
        env.requestRemoveWorktrees([
          {
            repoPath: wt.repoPath,
            id: wt.id,
            branch: wt.branch,
            path: wt.path,
          },
        ])
      },
    },
  ]

  return commands
}

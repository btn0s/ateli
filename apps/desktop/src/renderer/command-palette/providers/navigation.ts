import {
  Copy,
  Flame,
  FolderOpen,
  GitBranch,
  PanelsTopLeft,
  TerminalSquare,
} from "lucide-react"
import type { Editor } from "tldraw"
import type { TLShapeId } from "tldraw"
import type { ManagementPolicy } from "@/contexts/management-policy-context"
import type { TerminalRenameRequest } from "@/components/terminal-rename-dialog"
import type { WorktreeRenameRequest } from "@/components/worktree-rename-dialog"
import type { WorktreeRemoveRequest } from "@/components/worktree-remove-dialog"
import { zoomToSelectionInViewport } from "@/lib/canvas-camera"
import { addTerminalAtCenter } from "@/lib/default-actions"
import { findWorktreeForCwd, terminalTitleFromCwd } from "@/lib/terminal-worktree-title"
import { terminalsBelongingToWorktree } from "@/lib/worktree-terminals"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import type { CommandDefinition, CommandExecutionContext } from "../types"
import { buildWorktreeListForPalette } from "../worktree-entries"

type NavEnv = {
  onUnavailable: (message: string) => void
  editor: Editor
  repoPath: string
  worktrees: WorktreeIndexEntry[]
  policy: ManagementPolicy["user"]
  requestRenameTerminal: (request: TerminalRenameRequest) => void
  requestRenameWorktree: (request: WorktreeRenameRequest) => void
  requestRemoveWorktrees: (requests: readonly WorktreeRemoveRequest[]) => void
  requestKillSession: (request: { sessionId: string }) => void
}

function focusWorktree(
  env: NavEnv,
  ctx: CommandExecutionContext,
  wt: WorktreeIndexEntry,
) {
  const { editor, worktrees, repoPath } = env
  if (!repoPath) {
    env.onUnavailable("No repository is open for this worktree action.")
    return
  }
  const terminalShapes = ctx.palette.terminalShapeIds
    .map((id) => editor.getShape(id))
    .filter((s): s is NonNullable<typeof s> => !!s && s.type === "terminal")
  const inWt = terminalsBelongingToWorktree(
    repoPath,
    worktrees,
    wt,
    terminalShapes,
  )
  if (inWt.length > 0) {
    const validIds = inWt
      .map((s) => s.id)
      .filter((id) => !!editor.getShape(id))
    if (validIds.length === 0) {
      addTerminalAtCenter(editor, { cwd: wt.isMain ? repoPath : wt.path })
      return
    }
    editor.setSelectedShapes(validIds)
    zoomToSelectionInViewport(editor, {
      maxTargetZoom: 1,
      zoomOutFactor: 0.9,
      screenRect: ctx.palette.centerLaneScreenRect,
    })
    return
  }
  addTerminalAtCenter(editor, { cwd: wt.isMain ? repoPath : wt.path })
}

function newTerminalInWorktree(
  env: NavEnv,
  wt: WorktreeIndexEntry,
) {
  if (!env.repoPath) {
    env.onUnavailable("Repository path is not available yet.")
    return false
  }
  addTerminalAtCenter(env.editor, { cwd: wt.isMain ? env.repoPath : wt.path })
  return true
}

function indexedWorktreeForCwd(
  cwd: string,
  worktrees: WorktreeIndexEntry[],
): WorktreeIndexEntry | null {
  const wt = findWorktreeForCwd(cwd, worktrees)
  if (!wt) return null
  return worktrees.find((entry) => entry.path === wt.path) ?? null
}

function copyToClipboard(value: string) {
  void navigator.clipboard.writeText(value)
}

function terminalsInFrame(
  editor: Editor,
  frameId: TLShapeId,
): { id: TLShapeId; sessionId?: string }[] {
  return editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "terminal" && s.parentId === frameId)
    .map((s) => ({
      id: s.id as TLShapeId,
      sessionId: (s.props as { sessionId?: string }).sessionId,
    }))
}

export function createNavigationCommands(env: NavEnv): CommandDefinition[] {
  const { onUnavailable, editor, worktrees, policy, repoPath } = env
  const all = editor.getCurrentPageShapes()
  const terminalShapes = all.filter((s) => s.type === "terminal")
  const frameShapes = all.filter((s) => s.type === "frame")
  const entries = buildWorktreeListForPalette(repoPath, worktrees)

  const wts: CommandDefinition[] = entries.map((wt) => {
    const key = wt.isMain ? repoPath || "main" : wt.path
    const label = wt.isMain ? "main" : wt.branch
    return {
      id: `worktree-focus:${key}`,
      title: label,
      icon: GitBranch,
      keywords: [label, wt.branch, wt.path, "worktree", "branch"],
      group: "worktree",
      emptyQuerySection: "navigation",
      when: () => true,
      score: () => 0.1,
      run: (ctx) => {
        if (!repoPath) {
          onUnavailable("Repository path is not available yet.")
          return
        }
        focusWorktree(env, ctx, wt)
      },
      actions: () => [
        {
          id: `worktree-focus:${key}:focus`,
          title: `Reveal ${label}`,
          subtitle: "Select existing terminals in this worktree, or create one if needed.",
          icon: GitBranch,
          keywords: [label, wt.branch, wt.path, "focus", "reveal", "worktree"],
          group: "worktree",
          emptyQuerySection: "navigation",
          when: () => true,
          run: (ctx) => {
            if (!repoPath) {
              onUnavailable("Repository path is not available yet.")
              return
            }
            focusWorktree(env, ctx, wt)
          },
        },
        {
          id: `worktree-focus:${key}:new-terminal`,
          title: "New terminal here",
          subtitle: wt.isMain ? "Create a terminal in the main checkout." : `Create a terminal in ${wt.branch}.`,
          icon: TerminalSquare,
          keywords: [label, wt.branch, wt.path, "new", "terminal", "cwd"],
          group: "create",
          emptyQuerySection: "actions",
          when: () => true,
          run: () => {
            newTerminalInWorktree(env, wt)
          },
        },
        {
          id: `worktree-focus:${key}:copy-branch`,
          title: "Copy branch name",
          subtitle: wt.branch,
          icon: Copy,
          keywords: [label, wt.branch, "copy", "clipboard", "branch"],
          group: "action",
          emptyQuerySection: "actions",
          when: () => true,
          run: () => copyToClipboard(wt.branch),
        },
        {
          id: `worktree-focus:${key}:copy-path`,
          title: "Copy path",
          subtitle: wt.path,
          icon: Copy,
          keywords: [label, wt.path, "copy", "clipboard", "path"],
          group: "action",
          emptyQuerySection: "actions",
          when: () => true,
          run: () => copyToClipboard(wt.path),
        },
        {
          id: `worktree-focus:${key}:reveal-finder`,
          title: "Reveal in Finder",
          subtitle: "Open this worktree directory in Finder.",
          icon: FolderOpen,
          keywords: [label, wt.path, "reveal", "finder", "open"],
          group: "action",
          emptyQuerySection: "actions",
          when: () => true,
          run: () => {
            void window.electron.fs.openPath(wt.path)
          },
        },
        ...(wt.id && !wt.isMain && policy.renameBranch
          ? [
              {
                id: `worktree-focus:${key}:rename-branch`,
                title: "Rename branch",
                subtitle: `Rename ${wt.branch} with git branch -m.`,
                icon: GitBranch,
                keywords: [label, wt.branch, wt.path, "rename", "branch", "worktree"],
                group: "action",
                emptyQuerySection: "actions",
                when: () => true,
                run: () => {
                  env.requestRenameWorktree({
                    repoPath: wt.repoPath,
                    id: wt.id,
                    currentBranch: wt.branch,
                  })
                },
              } satisfies CommandDefinition,
            ]
          : []),
        ...(wt.id && !wt.isMain
          ? [
              {
                id: `worktree-focus:${key}:remove`,
                title: "Remove worktree",
                subtitle: "Remove this worktree and kill terminals rooted in it.",
                icon: GitBranch,
                keywords: [label, wt.branch, wt.path, "remove", "delete", "worktree"],
                group: "action",
                emptyQuerySection: "actions",
                when: () => true,
                run: () => {
                  env.requestRemoveWorktrees([
                    {
                      repoPath: wt.repoPath,
                      id: wt.id,
                      branch: wt.branch,
                      path: wt.path,
                    },
                  ])
                },
              } satisfies CommandDefinition,
            ]
          : []),
      ],
    } satisfies CommandDefinition
  })

  const terms: CommandDefinition[] = terminalShapes.map((s) => {
    const id = s.id as TLShapeId
    const props = s.props as { cwd?: string; sessionId?: string }
    const cwd = props.cwd
    const sessionId = props.sessionId
    const title = terminalTitleFromCwd(
      cwd,
      repoPath || "",
      worktrees,
    )
    return {
      id: `terminal-focus:${id}`,
      title,
      icon: TerminalSquare,
      keywords: [title, cwd ?? "", "terminal", "console"],
      group: "terminal",
      emptyQuerySection: "navigation",
      when: () => true,
      run: (ctx) => {
        if (!ctx.editor.getShape(id)) {
          onUnavailable("That terminal is no longer on the canvas.")
          return
        }
        ctx.editor.select(id)
        zoomToSelectionInViewport(ctx.editor, {
          maxTargetZoom: 1,
          zoomOutFactor: 0.9,
          screenRect: ctx.palette.centerLaneScreenRect,
        })
      },
      actions: () => [
        {
          id: `terminal-focus:${id}:focus`,
          title: "Reveal terminal",
          subtitle: "Select this terminal on the canvas and center it.",
          icon: TerminalSquare,
          keywords: [title, cwd ?? "", "focus", "reveal", "terminal"],
          group: "terminal",
          emptyQuerySection: "actions",
          when: () => true,
          run: (ctx) => {
            if (!ctx.editor.getShape(id)) {
              onUnavailable("That terminal is no longer on the canvas.")
              return
            }
            ctx.editor.select(id)
            zoomToSelectionInViewport(ctx.editor, {
              maxTargetZoom: 1,
              zoomOutFactor: 0.9,
              screenRect: ctx.palette.centerLaneScreenRect,
            })
          },
        },
        ...(cwd
          ? [
              {
                id: `terminal-focus:${id}:duplicate`,
                title: "New terminal in same folder",
                subtitle: "Create another terminal using this terminal's cwd.",
                icon: GitBranch,
                keywords: [title, cwd, "duplicate", "terminal", "cwd"],
                group: "create",
                emptyQuerySection: "actions",
                when: () => true,
                run: (ctx: CommandExecutionContext) => {
                  addTerminalAtCenter(ctx.editor, { cwd })
                },
              } satisfies CommandDefinition,
              {
                id: `terminal-focus:${id}:copy-path`,
                title: "Copy working directory",
                subtitle: cwd,
                icon: Copy,
                keywords: [title, cwd, "copy", "clipboard", "path", "cwd"],
                group: "action",
                emptyQuerySection: "actions",
                when: () => true,
                run: () => copyToClipboard(cwd),
              } satisfies CommandDefinition,
            ]
          : []),
        ...(sessionId && policy.renameTerminal
          ? [
              {
                id: `terminal-focus:${id}:rename`,
                title: "Rename terminal",
                subtitle: "Open the rename dialog for this terminal.",
                icon: TerminalSquare,
                keywords: [title, cwd ?? "", "rename", "terminal", "label"],
                group: "action",
                emptyQuerySection: "actions",
                when: () => true,
                run: () => {
                  env.requestRenameTerminal({
                    sessionKey: sessionId,
                    fallbackLabel: title,
                  })
                },
              } satisfies CommandDefinition,
            ]
          : []),
        ...(sessionId
          ? [
              {
                id: `terminal-focus:${id}:kill`,
                title: "Kill session",
                subtitle: "Terminate the process attached to this terminal.",
                icon: TerminalSquare,
                keywords: [title, cwd ?? "", "kill", "session", "terminal"],
                group: "action",
                emptyQuerySection: "actions",
                when: () => true,
                run: () => {
                  env.requestKillSession({ sessionId })
                },
              } satisfies CommandDefinition,
            ]
          : []),
        ...(cwd
          ? (() => {
              const wt = indexedWorktreeForCwd(cwd, worktrees)
              if (!wt?.id || wt.isMain) return []
              const extra: CommandDefinition[] = []
              if (policy.renameBranch) {
                extra.push({
                  id: `terminal-focus:${id}:rename-branch`,
                  title: "Rename branch",
                  subtitle: `Rename ${wt.branch} with git branch -m.`,
                  icon: GitBranch,
                  keywords: [title, cwd, wt.branch, "rename", "branch", "worktree"],
                  group: "action",
                  emptyQuerySection: "actions",
                  when: () => true,
                  run: () => {
                    env.requestRenameWorktree({
                      repoPath: wt.repoPath,
                      id: wt.id,
                      currentBranch: wt.branch,
                    })
                  },
                })
              }
              extra.push({
                id: `terminal-focus:${id}:remove-worktree`,
                title: "Remove worktree",
                subtitle: `Remove the ${wt.branch} worktree and kill rooted terminals.`,
                icon: GitBranch,
                keywords: [title, cwd, wt.branch, "remove", "delete", "worktree"],
                group: "action",
                emptyQuerySection: "actions",
                when: () => true,
                run: () => {
                  env.requestRemoveWorktrees([
                    {
                      repoPath: wt.repoPath,
                      id: wt.id,
                      branch: wt.branch,
                      path: wt.path,
                    },
                  ])
                },
              })
              return extra
            })()
          : []),
      ],
    } satisfies CommandDefinition
  })

  const frames: CommandDefinition[] = frameShapes.map((s) => {
    const id = s.id as TLShapeId
    const name = (s.props as { name?: string }).name?.trim() || "Frame"
    return {
      id: `frame-focus:${id}`,
      title: name,
      icon: PanelsTopLeft,
      keywords: [name, "frame", "artboard"],
      group: "navigation",
      emptyQuerySection: "navigation",
      when: () => true,
      run: (ctx) => {
        if (!ctx.editor.getShape(id)) {
          onUnavailable("That frame is no longer on the canvas.")
          return
        }
        ctx.editor.select(id)
        zoomToSelectionInViewport(ctx.editor, {
          maxTargetZoom: 1,
          zoomOutFactor: 0.9,
          screenRect: ctx.palette.centerLaneScreenRect,
        })
      },
      actions: () => [
        {
          id: `frame-focus:${id}:focus`,
          title: "Reveal frame",
          subtitle: "Select this frame and center it in the lane.",
          icon: PanelsTopLeft,
          keywords: [name, "frame", "reveal", "focus"],
          group: "navigation",
          emptyQuerySection: "actions",
          when: () => true,
          run: (ctx) => {
            if (!ctx.editor.getShape(id)) {
              onUnavailable("That frame is no longer on the canvas.")
              return
            }
            ctx.editor.select(id)
            zoomToSelectionInViewport(ctx.editor, {
              maxTargetZoom: 1,
              zoomOutFactor: 0.9,
              screenRect: ctx.palette.centerLaneScreenRect,
            })
          },
        },
        {
          id: `frame-focus:${id}:duplicate`,
          title: "Duplicate frame",
          subtitle: "Copy this frame and everything inside it.",
          icon: PanelsTopLeft,
          keywords: [name, "frame", "duplicate", "copy"],
          group: "action",
          emptyQuerySection: "actions",
          when: () => true,
          run: (ctx) => {
            if (!ctx.editor.getShape(id)) {
              onUnavailable("That frame is no longer on the canvas.")
              return
            }
            ctx.editor.duplicateShapes([id])
          },
        },
        {
          id: `frame-focus:${id}:kill-all-terminals`,
          title: "Kill all terminal sessions in frame",
          subtitle: "Terminate every terminal session inside this frame.",
          icon: Flame,
          keywords: [name, "frame", "kill", "terminals", "sessions"],
          group: "action",
          emptyQuerySection: "actions",
          when: (ctx) =>
            !!ctx.editor.getShape(id) &&
            terminalsInFrame(ctx.editor, id).some((t) => t.sessionId),
          run: (ctx) => {
            const children = terminalsInFrame(ctx.editor, id).filter(
              (t): t is { id: TLShapeId; sessionId: string } => !!t.sessionId,
            )
            if (children.length === 0) return
            for (const child of children) {
              env.requestKillSession({ sessionId: child.sessionId })
            }
          },
        },
        {
          id: `frame-focus:${id}:delete`,
          title: "Delete frame",
          subtitle: "Remove this frame from the canvas.",
          icon: PanelsTopLeft,
          keywords: [name, "frame", "delete", "remove"],
          group: "action",
          emptyQuerySection: "actions",
          when: () => true,
          run: (ctx) => {
            if (!ctx.editor.getShape(id)) {
              onUnavailable("That frame is no longer on the canvas.")
              return
            }
            ctx.editor.deleteShapes([id])
          },
        },
      ],
    } satisfies CommandDefinition
  })

  return [...wts, ...terms, ...frames]
}

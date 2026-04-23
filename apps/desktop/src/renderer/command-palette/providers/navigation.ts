import { GitBranch, PanelsTopLeft, TerminalSquare } from "lucide-react"
import type { Editor } from "tldraw"
import type { TLShapeId } from "tldraw"
import { zoomToSelectionInViewport } from "@/lib/canvas-camera"
import { addTerminalAtCenter, getRepoPath } from "@/lib/default-actions"
import { terminalTitleFromCwd } from "@/lib/terminal-worktree-title"
import { terminalsBelongingToWorktree } from "@/lib/worktree-terminals"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import type { CommandDefinition, CommandExecutionContext } from "../types"
import { buildWorktreeListForPalette } from "../worktree-entries"

type NavEnv = {
  onUnavailable: (message: string) => void
  editor: Editor
  worktrees: WorktreeIndexEntry[]
}

function focusWorktree(
  env: NavEnv,
  ctx: CommandExecutionContext,
  wt: WorktreeIndexEntry,
) {
  const { editor, worktrees } = env
  const repoPath = getRepoPath()
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

export function createNavigationCommands(env: NavEnv): CommandDefinition[] {
  const { onUnavailable, editor, worktrees } = env
  const repoPath = getRepoPath()
  const all = editor.getCurrentPageShapes()
  const terminalShapes = all.filter((s) => s.type === "terminal")
  const frameShapes = all.filter((s) => s.type === "frame")
  const entries = buildWorktreeListForPalette(repoPath, worktrees)

  const wts: CommandDefinition[] = entries.map((wt) => {
    const key = wt.isMain ? (repoPath ?? "main") : wt.path
    const label = wt.isMain ? "main" : wt.branch
    const inWt = repoPath
      ? terminalsBelongingToWorktree(
          repoPath,
          worktrees,
          wt,
          terminalShapes,
        )
      : []
    const suffix =
      inWt.length === 0 ? " · add terminal" : ` · ${inWt.length} terminals`
    return {
      id: `worktree-focus:${key}`,
      title: label,
      subtitle: `Worktree${suffix}`,
      icon: GitBranch,
      keywords: [label, wt.branch, wt.path, "worktree", "branch"],
      group: "worktree",
      contextBadge: "Worktree",
      emptyQuerySection: "navigation",
      when: () => true,
      score: () => 0.1,
      run: (ctx) => {
        if (!getRepoPath()) {
          onUnavailable("Repository path is not available yet.")
          return
        }
        focusWorktree(env, ctx, wt)
      },
    } satisfies CommandDefinition
  })

  const terms: CommandDefinition[] = terminalShapes.map((s) => {
    const id = s.id as TLShapeId
    const cwd = (s.props as { cwd?: string }).cwd
    const title = terminalTitleFromCwd(
      cwd,
      repoPath || "",
      worktrees,
    )
    return {
      id: `terminal-focus:${id}`,
      title,
      subtitle: "Terminal on canvas",
      icon: TerminalSquare,
      keywords: [title, cwd ?? "", "terminal", "console"],
      group: "terminal",
      contextBadge: "Terminal",
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
    } satisfies CommandDefinition
  })

  const frames: CommandDefinition[] = frameShapes.map((s) => {
    const id = s.id as TLShapeId
    const name = (s.props as { name?: string }).name?.trim() || "Frame"
    return {
      id: `frame-focus:${id}`,
      title: name,
      subtitle: "Frame on canvas",
      icon: PanelsTopLeft,
      keywords: [name, "frame", "artboard"],
      group: "navigation",
      contextBadge: "Frame",
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
    } satisfies CommandDefinition
  })

  return [...wts, ...terms, ...frames]
}

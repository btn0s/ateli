import { GitBranch } from "lucide-react"
import {
  addTerminalAtCenter,
  randomAteliWorktreeBranchName,
} from "@/lib/default-actions"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import {
  buildNewTerminalWorktreeRows,
  getDefaultWorktreeStartRef,
} from "../worktree-entries"
import type { CommandDefinition } from "../types"

type Env = {
  onUnavailable: (message: string) => void
  repoPath: string
  worktrees: WorktreeIndexEntry[]
}

/**
 * Worktree (including main) + "create new worktree" for the 2nd step of
 * new terminal from the command palette.
 */
export function createNewTerminalPickCommands(env: Env): CommandDefinition[] {
  const { repoPath } = env
  if (!repoPath) {
    return []
  }

  const rows = buildNewTerminalWorktreeRows(repoPath, env.worktrees)

  const worktreeOptions: CommandDefinition[] = rows.map((wt) => {
    const key = wt.isMain ? repoPath : wt.path
    const label = wt.isMain ? "main" : wt.branch
    return {
      id: `new-terminal:wt:${key}`,
      title: label,
      icon: GitBranch,
      keywords: [label, wt.branch, wt.path, "worktree", "folder", "cwd", "root"],
      group: "worktree" as const,
      emptyQuerySection: "suggested" as const,
      when: () => true,
      run: (ctx) => {
        const cwd = wt.isMain ? repoPath : wt.path
        addTerminalAtCenter(ctx.editor, { cwd }, env.worktrees)
      },
    } satisfies CommandDefinition
  })

  const createNew: CommandDefinition = {
    id: "new-terminal:create-wt",
    title: "New worktree, then new terminal",
    icon: GitBranch,
    keywords: [
      "create",
      "new",
      "worktree",
      "branch",
      "add",
    ],
    group: "create" as const,
    emptyQuerySection: "suggested" as const,
    when: () => true,
    mutatesState: true,
    run: async (ctx) => {
      if (!repoPath) {
        env.onUnavailable("No repository is open for this worktree action.")
        return
      }
      const branch = randomAteliWorktreeBranchName()
      const { path } = await window.electron.worktree.create(repoPath, branch, {
        startPoint: getDefaultWorktreeStartRef(env.worktrees),
      })
      addTerminalAtCenter(ctx.editor, { cwd: path }, env.worktrees)
    },
  } satisfies CommandDefinition

  return [...worktreeOptions, createNew]
}

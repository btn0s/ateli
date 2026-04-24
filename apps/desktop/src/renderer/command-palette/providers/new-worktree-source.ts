import { GitBranch, GitPullRequest, LayoutList } from "lucide-react"
import { getRepoPath, randomAteliWorktreeBranchName } from "@/lib/default-actions"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import { getDefaultWorktreeStartRef } from "../worktree-entries"
import type { CommandDefinition } from "../types"

type Env = {
  onUnavailable: (message: string) => void
  worktrees: WorktreeIndexEntry[]
}

/**
 * Step 2 for “New Git worktree”: main / Linear (stub) / branch·PR (stub).
 */
export function createNewWorktreeSourceCommands(
  env: Env,
): CommandDefinition[] {
  if (!getRepoPath()) {
    return []
  }

  const fromMain: CommandDefinition = {
    id: "new-wt:from-main",
    title: "From main (default branch)",
    icon: GitBranch,
    keywords: [
      "main",
      "default",
      "trunk",
      "master",
      "head",
      "new",
      "worktree",
    ],
    group: "worktree" as const,
    contextBadge: "Git",
    emptyQuerySection: "suggested" as const,
    when: () => true,
    mutatesState: true,
    run: async () => {
      const repo = getRepoPath()
      if (!repo) {
        env.onUnavailable("No repository is open for this worktree action.")
        return
      }
      const branch = randomAteliWorktreeBranchName()
      const startPoint = getDefaultWorktreeStartRef(env.worktrees)
      await window.electron.worktree.create(repo, branch, {
        startPoint,
      })
    },
  } satisfies CommandDefinition

  const fromLinear: CommandDefinition = {
    id: "new-wt:from-linear",
    title: "From a Linear issue",
    icon: LayoutList,
    keywords: [
      "linear",
      "issue",
      "ticket",
      "task",
    ],
    group: "suggested" as const,
    contextBadge: "Soon",
    emptyQuerySection: "suggested" as const,
    when: () => true,
    disabled: true,
    run: () => {},
  } satisfies CommandDefinition

  const fromBranchOrPr: CommandDefinition = {
    id: "new-wt:from-branch-pr",
    title: "From a branch or pull request",
    icon: GitPullRequest,
    keywords: [
      "branch",
      "pr",
      "pull request",
      "remote",
    ],
    group: "suggested" as const,
    contextBadge: "Soon",
    emptyQuerySection: "suggested" as const,
    when: () => true,
    disabled: true,
    run: () => {},
  } satisfies CommandDefinition

  return [fromMain, fromLinear, fromBranchOrPr]
}

import { getCommandMenuActions } from "@/lib/tool-registry"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import type { CommandDefinition, CommandExecutionContext } from "../types"

export function createStaticRegistryCommands(
  worktrees: WorktreeIndexEntry[],
): CommandDefinition[] {
  return getCommandMenuActions().map((a) => {
    const push = a.openPaletteRoute
    return {
      id: `tool:${a.id}`,
      title: a.label,
      icon: a.icon,
      keywords: [a.label.toLowerCase(), "action", a.id],
      group: a.id === "add-terminal" || a.id === "add-worktree" ? "create" : "action",
      emptyQuerySection: a.id === "add-worktree" ? "actions" : "suggested",
      when: (ctx: CommandExecutionContext) =>
        !a.when || a.when({ editor: ctx.editor, worktrees }),
      score: () => (a.id === "add-terminal" ? 0.15 : 0.05),
      push,
      run: push
        ? () => "continue" as const
        : (ctx: CommandExecutionContext) => {
            a.execute?.({ editor: ctx.editor, worktrees })
          },
      mutatesState: a.id === "add-worktree",
      shortcut: a.shortcut,
    } satisfies CommandDefinition
  })
}

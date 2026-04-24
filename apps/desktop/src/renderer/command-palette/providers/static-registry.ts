import { getCommandMenuActions } from "@/lib/tool-registry"
import type { CommandDefinition, CommandExecutionContext } from "../types"

export function createStaticRegistryCommands(): CommandDefinition[] {
  return getCommandMenuActions().map((a) => {
    const push = a.openPaletteRoute
    return {
      id: `tool:${a.id}`,
      title: a.label,
      icon: a.icon,
      keywords: [a.label.toLowerCase(), "action", a.id],
      group: a.id === "add-terminal" || a.id === "add-worktree" ? "create" : "action",
      emptyQuerySection: a.id === "add-worktree" ? "actions" : "suggested",
      when: () => true,
      score: () => (a.id === "add-terminal" ? 0.15 : 0.05),
      push,
      run: push
        ? () => "continue" as const
        : (ctx: CommandExecutionContext) => {
            a.execute?.(ctx.editor)
          },
      mutatesState: a.id === "add-worktree",
      shortcut: a.shortcut,
    } satisfies CommandDefinition
  })
}

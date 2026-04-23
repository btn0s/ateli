import { getCommandMenuActions } from "@/lib/tool-registry"
import type { CommandDefinition, CommandExecutionContext } from "../types"

export function createStaticRegistryCommands(): CommandDefinition[] {
  return getCommandMenuActions().map(
    (a) =>
      ({
        id: `tool:${a.id}`,
        title: a.label,
        icon: a.icon,
        keywords: [a.label.toLowerCase(), "action", a.id],
        group: a.id === "add-terminal" || a.id === "add-worktree" ? "create" : "action",
        contextBadge: "Action",
        emptyQuerySection: a.id === "add-worktree" ? "actions" : "suggested",
        when: () => true,
        score: () => (a.id === "add-terminal" ? 0.15 : 0.05),
        run: (ctx: CommandExecutionContext) => {
          a.execute(ctx.editor)
        },
        mutatesState: a.id === "add-worktree",
        shortcut: a.shortcut,
      }) satisfies CommandDefinition
  )
}

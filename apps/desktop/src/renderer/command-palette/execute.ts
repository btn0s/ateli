import type { CommandDefinition, CommandExecutionContext } from "./types"

/** `true` = success (close), `false` = error, `"continue"` = keep palette open. */
export async function runCommand(
  def: CommandDefinition,
  ctx: CommandExecutionContext,
  onUnavailable: (message: string) => void,
): Promise<boolean | "continue"> {
  if (!def.when(ctx)) {
    onUnavailable("That command is not available in the current context.")
    return false
  }
  try {
    const r = await def.run(ctx)
    if (r === "continue") return "continue"
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Command failed to run."
    onUnavailable(msg)
    return false
  }
}

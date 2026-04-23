import type { CommandDefinition, CommandExecutionContext } from "./types"

/** Returns `true` when the command actually ran; `false` when user feedback is shown. */
export async function runCommand(
  def: CommandDefinition,
  ctx: CommandExecutionContext,
  onUnavailable: (message: string) => void,
): Promise<boolean> {
  if (!def.when(ctx)) {
    onUnavailable("That command is not available in the current context.")
    return false
  }
  try {
    await def.run(ctx)
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Command failed to run."
    onUnavailable(msg)
    return false
  }
}

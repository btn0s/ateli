/** Connects the toolbar "new terminal" action to the same subflow as the palette. */
type Opener = () => void
let openPicker: Opener | null = null

export function registerNewTerminalWorktreeOpener(opener: Opener): () => void {
  openPicker = opener
  return () => {
    if (openPicker === opener) openPicker = null
  }
}

/** Opens the command palette on the "choose worktree" step (toolbar / context). */
export function openNewTerminalWorktreePicker() {
  openPicker?.()
}

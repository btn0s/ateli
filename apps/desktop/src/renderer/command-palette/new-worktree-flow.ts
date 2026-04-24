type Opener = () => void
let openPicker: Opener | null = null

export function registerNewWorktreeSourceOpener(opener: Opener): () => void {
  openPicker = opener
  return () => {
    if (openPicker === opener) openPicker = null
  }
}

/** Opens the palette on the “new worktree → choose source” step (toolbar / menu). */
export function openNewWorktreeSourcePicker() {
  openPicker?.()
}

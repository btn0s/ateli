import { createShapeId, type Editor, type TLShapeId } from "tldraw"
import { TerminalSquare, GitBranch } from "lucide-react"
import { registerAction } from "./tool-registry"

export function addTerminalAtCenter(
  editor: Editor,
  props?: Record<string, unknown>,
): TLShapeId {
  const center = editor.getViewportPageBounds().center
  const id = createShapeId()
  editor.createShape({
    id,
    type: "terminal",
    x: center.x - 300,
    y: center.y - 200,
    props,
  })
  return id
}

registerAction({
  id: "add-terminal",
  label: "New terminal",
  icon: TerminalSquare,
  tldrawIcon: "code",
  showInToolbar: true,
  showInCommandMenu: true,
  showInContextMenu: true,
  openPaletteRoute: { kind: "new-terminal" },
})

const adjectives = [
  "swift", "calm", "bold", "warm", "keen", "bright", "quiet", "vivid",
  "fresh", "crisp", "smooth", "sharp", "clear", "rapid", "steady",
]
const nouns = [
  "maple", "cedar", "river", "ridge", "stone", "brook", "trail", "grove",
  "cliff", "marsh", "field", "crest", "shore", "dune", "peak",
]

export function randomAteliWorktreeBranchName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  const suffix = Math.floor(Math.random() * 100)
  return `ateli/${adj}-${noun}-${suffix}`
}

registerAction({
  id: "add-worktree",
  label: "New Worktree",
  icon: GitBranch,
  tldrawIcon: "plus",
  showInToolbar: true,
  showInCommandMenu: true,
  showInContextMenu: true,
  openPaletteRoute: { kind: "new-worktree" },
})

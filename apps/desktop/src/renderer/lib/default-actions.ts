import { createShapeId, type Editor, type TLShapeId } from "tldraw"
import { TerminalSquare, GitBranch, LayoutGrid } from "lucide-react"
import { registerAction } from "./tool-registry"
import { placeTerminal, organizeShapes, clusterShapeIdsFor } from "./layout"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"

const DEFAULT_TERMINAL_W = 600
const DEFAULT_TERMINAL_H = 400

export function addTerminalAtCenter(
  editor: Editor,
  props: Record<string, unknown> = {},
  worktrees: WorktreeIndexEntry[] = [],
): TLShapeId {
  const id = createShapeId()
  const cwd = typeof props.cwd === "string" ? props.cwd : ""
  const { x, y } = placeTerminal(editor, {
    cwd,
    worktrees,
    size: { w: DEFAULT_TERMINAL_W, h: DEFAULT_TERMINAL_H },
  })
  editor.createShape({
    id,
    type: "terminal",
    x,
    y,
    props: { w: DEFAULT_TERMINAL_W, h: DEFAULT_TERMINAL_H, ...props },
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

registerAction({
  id: "organize-selection",
  label: "Organize",
  icon: LayoutGrid,
  tldrawIcon: "grid",
  showInCommandMenu: true,
  showInContextMenu: true,
  when: ({ editor }) => {
    const ids = editor.getSelectedShapeIds()
    if (ids.length === 0) return false
    const shapes = ids
      .map((id) => editor.getShape(id))
      .filter((s): s is NonNullable<typeof s> => s != null)
    const terminals = shapes.filter((s) => s.type === "terminal")
    return terminals.length >= 1
  },
  execute: ({ editor, worktrees }) => {
    const ids = editor.getSelectedShapeIds()
    if (ids.length === 0) return
    const firstId = ids[0]
    const firstIsTerminal =
      firstId != null && editor.getShape(firstId)?.type === "terminal"
    const targets =
      ids.length === 1 && firstIsTerminal && firstId != null
        ? clusterShapeIdsFor(editor, firstId, worktrees)
        : ids
    organizeShapes(editor, targets)
  },
})

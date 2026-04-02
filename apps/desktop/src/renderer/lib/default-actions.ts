import type { Editor } from "tldraw"
import { TerminalSquare, GitBranch } from "lucide-react"
import { registerAction } from "./tool-registry"

function addTerminalAtCenter(editor: Editor) {
  const center = editor.getViewportPageBounds().center
  editor.createShape({
    type: "terminal",
    x: center.x - 300,
    y: center.y - 200,
  })
}

registerAction({
  id: "add-terminal",
  label: "Add Terminal",
  icon: TerminalSquare,
  showInToolbar: true,
  showInCommandMenu: true,
  showInContextMenu: true,
  execute: addTerminalAtCenter,
})

registerAction({
  id: "add-worktree",
  label: "New Worktree",
  icon: GitBranch,
  showInCommandMenu: true,
  showInContextMenu: true,
  execute: (_editor) => {
    // TODO: prompt for branch name, then call worktree.create RPC
    // For now this is a placeholder — the RPC flow works, UI prompt is next
  },
})

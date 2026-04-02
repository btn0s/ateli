import type { Editor } from "tldraw"
import { TerminalSquare, GitBranch } from "lucide-react"
import { registerAction } from "./tool-registry"

let _repoPath = ""

export function setRepoPath(repoPath: string) {
  _repoPath = repoPath
}

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
  showInToolbar: true,
  showInCommandMenu: true,
  showInContextMenu: true,
  execute: async () => {
    if (!_repoPath) return
    const branch = window.prompt("Branch name:")
    if (!branch) return
    // IPC call — the worktree.created notification will spawn the terminal shape
    await window.electron.worktree.create(_repoPath, branch)
  },
})

import type { Editor } from "tldraw"
import { TerminalSquare, GitBranch } from "lucide-react"
import { registerAction } from "./tool-registry"

let _repoPath = ""

export function setRepoPath(repoPath: string) {
  _repoPath = repoPath
}

export function addTerminalAtCenter(editor: Editor, props?: Record<string, unknown>) {
  const center = editor.getViewportPageBounds().center
  editor.createShape({
    type: "terminal",
    x: center.x - 300,
    y: center.y - 200,
    props,
  })
}

registerAction({
  id: "add-terminal",
  label: "Add Terminal",
  icon: TerminalSquare,
  tldrawIcon: "code",
  showInToolbar: true,
  showInCommandMenu: true,
  showInContextMenu: true,
  execute: addTerminalAtCenter,
})

const adjectives = [
  "swift", "calm", "bold", "warm", "keen", "bright", "quiet", "vivid",
  "fresh", "crisp", "smooth", "sharp", "clear", "rapid", "steady",
]
const nouns = [
  "maple", "cedar", "river", "ridge", "stone", "brook", "trail", "grove",
  "cliff", "marsh", "field", "crest", "shore", "dune", "peak",
]

function generateBranchName(): string {
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
  execute: async () => {
    if (!_repoPath) return
    const branch = generateBranchName()
    await window.electron.worktree.create(_repoPath, branch)
  },
})

import type { LucideIcon } from "lucide-react"
import type { Editor } from "tldraw"

export interface ToolAction {
  id: string
  label: string
  icon: LucideIcon
  shortcut?: string
  showInToolbar?: boolean
  showInCommandMenu?: boolean
  showInContextMenu?: boolean
  execute: (editor: Editor) => void
}

const registry: ToolAction[] = []

export function registerAction(action: ToolAction): void {
  registry.push(action)
}

export function getToolbarActions(): ToolAction[] {
  return registry.filter((a) => a.showInToolbar)
}

export function getCommandMenuActions(): ToolAction[] {
  return registry.filter((a) => a.showInCommandMenu)
}

export function getContextMenuActions(): ToolAction[] {
  return registry.filter((a) => a.showInContextMenu)
}

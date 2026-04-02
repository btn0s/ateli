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
  group: string
  /** If true, this is a tldraw tool toggle (select, draw, etc.) */
  isToolToggle?: boolean
  /** Execute the action. Receives the tldraw editor instance. */
  execute: (editor: Editor) => void
}

const registry: ToolAction[] = []

export function registerAction(action: ToolAction): void {
  registry.push(action)
}

export function getActions(): ToolAction[] {
  return registry
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

/** Group actions by their `group` field */
export function groupActions(actions: ToolAction[]): Map<string, ToolAction[]> {
  const groups = new Map<string, ToolAction[]>()
  for (const action of actions) {
    const list = groups.get(action.group) ?? []
    list.push(action)
    groups.set(action.group, list)
  }
  return groups
}

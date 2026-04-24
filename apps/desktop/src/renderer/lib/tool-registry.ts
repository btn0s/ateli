import type { LucideIcon } from "lucide-react"
import type { Editor } from "tldraw"
import type { PaletteRoute } from "@/command-palette/types"

export interface ToolAction {
  id: string
  label: string
  icon: LucideIcon
  /** Icon name from tldraw's built-in icon set (for tldraw UI components) */
  tldrawIcon?: string
  shortcut?: string
  showInToolbar?: boolean
  showInCommandMenu?: boolean
  showInContextMenu?: boolean
  /**
   * When set, triggering this action opens the command palette at this route
   * (toolbar, context menu, command palette itself).
   */
  openPaletteRoute?: PaletteRoute
  /** Invoked when `openPaletteRoute` is not set. */
  execute?: (editor: Editor) => void | Promise<void>
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

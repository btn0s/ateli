import type { LucideIcon } from "lucide-react"
import type { Editor } from "tldraw"
import type { PaletteRoute } from "@/command-palette/types"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"

export interface ActionContext {
  editor: Editor
  worktrees: WorktreeIndexEntry[]
}

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
  execute?: (ctx: ActionContext) => void | Promise<void>
  /** Gate visibility in toolbar / menus. Default: always visible. */
  when?: (ctx: ActionContext) => boolean
}

const registry: ToolAction[] = []

export function registerAction(action: ToolAction): void {
  registry.push(action)
}

export function getToolbarActions(ctx?: ActionContext): ToolAction[] {
  return registry.filter(
    (a) => a.showInToolbar && (!a.when || !ctx || a.when(ctx))
  )
}

export function getCommandMenuActions(ctx?: ActionContext): ToolAction[] {
  return registry.filter(
    (a) => a.showInCommandMenu && (!a.when || !ctx || a.when(ctx))
  )
}

export function getContextMenuActions(ctx?: ActionContext): ToolAction[] {
  return registry.filter(
    (a) => a.showInContextMenu && (!a.when || !ctx || a.when(ctx))
  )
}

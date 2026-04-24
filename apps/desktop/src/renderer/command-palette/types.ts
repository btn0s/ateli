import type { LucideIcon } from "lucide-react"
import type { Editor } from "tldraw"
import type { TLShapeId } from "tldraw"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import type { PageBounds } from "@/lib/canvas-camera"

/** High-level group for search ranking and display. */
export type CommandModelGroup =
  | "navigation"
  | "create"
  | "terminal"
  | "worktree"
  | "canvas"
  | "suggested"
  | "action"

/**
 * Surface sections when the search box is empty; when searching, items are
 * still tagged for ordering hints.
 */
export type CommandPaletteSection =
  | "recent"
  | "suggested"
  | "navigation"
  | "actions"

export type CommandExecutionContext = {
  editor: Editor
  /** Snapshot for display/ranking; execution revalidates live `editor` state. */
  palette: CommandPaletteContext
}

export type PaletteRoute =
  | { kind: "root" }
  | { kind: "new-terminal" }
  | { kind: "new-worktree" }
  | {
      kind: "actions"
      sourceId: string
      sourceTitle: string
      sourceSubtitle?: string
      actions: CommandDefinition[]
    }

export type CommandPaletteContext = {
  selectionShapeIds: readonly TLShapeId[]
  /** Distinct tldraw shape `type` strings for the current selection. */
  selectedShapeTypes: readonly string[]
  selection: "none" | "single" | "multi"
  repoPath: string | null
  worktreeEntries: WorktreeIndexEntry[]
  /** Terminal shapes currently on the page. */
  terminalShapeIds: readonly TLShapeId[]
  /** Frame shapes currently on the page. */
  frameShapeIds: readonly TLShapeId[]
  /** Center lane (between sidebars) in screen space. */
  centerLaneScreenRect: PageBounds
}

export type CommandDefinition = {
  id: string
  title: string
  subtitle?: string
  /** Lucide icon for the row. */
  icon: LucideIcon
  /** Extra tokens for search (branch names, paths, etc.). */
  keywords: string[]
  group: CommandModelGroup
  /**
   * Which empty-query bucket this row prefers; ranking may still move items
   * (e.g. into Recent) based on recency and scores.
   */
  emptyQuerySection: CommandPaletteSection
  when: (ctx: CommandExecutionContext) => boolean
  /** Optional contextual score boost for ranking (0–1). */
  score?: (ctx: CommandExecutionContext) => number
  /**
   * When set, selecting the row pushes this route onto the palette stack
   * instead of invoking `run`. Use for multi-step flows.
   */
  push?: PaletteRoute
  /**
   * Return `"continue"` to keep the palette open and advance a multi-step
   * flow. Default success closes the sheet. Ignored when `push` is set.
   */
  run: (
    ctx: CommandExecutionContext,
  ) => void | "continue" | Promise<void | "continue">
  shortcut?: string
  mutatesState?: boolean
  /** Reserved for a later confirm dialog pass. */
  confirm?: { title: string; body?: string }
  alternateRun?: (ctx: CommandExecutionContext) => void | Promise<void>
  actions?: (ctx: CommandExecutionContext) => CommandDefinition[]
  /**
   * When true, the row is non-interactive and sorts after available commands.
   */
  disabled?: boolean
}

export type ScoredCommand = {
  def: CommandDefinition
  textScore: number
  contextScore: number
  recencyScore: number
  band: number
  sortKey: string
}

export type PaletteDisplay =
  | {
      mode: "search"
      list: CommandDefinition[]
      groupHeading: string
    }
  | {
      mode: "empty"
      sections: { section: string; items: CommandDefinition[] }[]
    }

import type { CSSProperties } from "react"

/** CSS vars for Pierre `FileTree` in left/right sidebar panels (matches files tab). */
export const SIDEBAR_PIERRE_TREE_STYLE = {
  height: "100%",
  width: "100%",
  "--trees-bg-override": "transparent",
  "--trees-border-color-override": "transparent",
  "--trees-fg-override": "hsl(var(--foreground))",
  "--trees-padding-inline-override": "8px",
  "--trees-selected-bg-override": "hsl(var(--accent))",
} as CSSProperties

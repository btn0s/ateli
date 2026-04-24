import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Small self-contained tab chip — used in both sidebars for panel switching.
 * Consistent vocabulary: h-7 ghost chip, bg-accent when selected.
 */
export function SidebarTabButton({
  selected,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[3px] px-2 text-xs transition-colors duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * Shared container for a sidebar tab strip. Padding matches across both
 * sidebars: pt-2 px-2 pb-1.5 (matches the terminal tab strip's pt-2 px-2).
 */
export function SidebarTabStrip({
  ariaLabel,
  children,
  trailing,
}: {
  ariaLabel: string
  children: ReactNode
  /** Optional trailing action, e.g. a '+' button. */
  trailing?: ReactNode
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex w-full min-w-0 shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5"
    >
      {children}
      {trailing ? <div className="ml-auto flex items-center">{trailing}</div> : null}
    </div>
  )
}

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react"
import { cn } from "@workspace/ui/lib/utils"

/** Shared chip surface for `SidebarTabButton` and rare non-button tabs (e.g. tab + close). */
export function sidebarTabChipClassName(
  selected: boolean,
  className?: string,
) {
  return cn(
    "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-[color,background-color,transform,box-shadow] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
    selected
      ? "ateli-skeuo-pill-inset bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground active:scale-[0.98]",
    className,
  )
}

/**
 * Small self-contained tab chip — used in both sidebars for panel switching.
 * Consistent vocabulary: h-7 ghost chip, bg-accent when selected.
 */
export const SidebarTabButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    selected?: boolean
    children: ReactNode
  }
>(function SidebarTabButton(
  { selected = false, children, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      role="tab"
      aria-selected={selected}
      className={sidebarTabChipClassName(selected, className)}
      {...props}
    >
      {children}
    </button>
  )
})

SidebarTabButton.displayName = "SidebarTabButton"

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
      className="ateli-surface-input-stripe flex w-full min-w-0 shrink-0 items-center gap-1 px-2 py-1.5"
    >
      {children}
      {trailing ? <div className="ml-auto flex items-center">{trailing}</div> : null}
    </div>
  )
}

import type { ComponentProps } from "react"
import { cn } from "@workspace/ui/lib/utils"

/** Full-height column in the shell — no horizontal padding (tabs / structure sit flush). */
function Root({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-root"
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  )
}

/** Inset body / scroll region (`px-2`). */
function Section({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-section"
      className={cn("px-2", className)}
      {...props}
    />
  )
}

/** Top stripe with actions (branch, panel tools, terminal chrome). */
function SectionHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-section-header"
      className={cn(
        "flex h-8 min-h-8 items-center justify-between gap-1 border-b border-border px-2",
        className,
      )}
      {...props}
    />
  )
}

export const Sidebar = {
  Root,
  Section,
  SectionHeader,
}

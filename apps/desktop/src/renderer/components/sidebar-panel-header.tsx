import type { ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"

function Root({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-0.5 border-border/50 border-b px-1 py-0.5",
        className,
      )}
    >
      {children}
    </div>
  )
}

function Title({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center px-0.5 py-0.5">
      <span className="truncate pl-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
    </div>
  )
}

function Trailer({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)}>
      {children}
    </div>
  )
}

/** Invisible tabular column so the header lines up with tree rows that show a count. */
function CountSpacer({ value = "0" }: { value?: string }) {
  return (
    <span
      className="min-w-[2ch] shrink-0 text-right tabular-nums text-[10px] text-transparent select-none"
      aria-hidden
    >
      {value}
    </span>
  )
}

export const SidebarPanelHeader = Object.assign(Root, {
  Title,
  Trailer,
  CountSpacer,
})

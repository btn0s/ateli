import type { ButtonHTMLAttributes, ReactNode } from "react"
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
        "-mx-3 flex w-[calc(100%+1.5rem)] max-w-none items-center gap-0.5 border-border/50 border-b px-3 py-0.5",
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

function ActionSlot({ className }: { className?: string }) {
  return <span className={cn("size-6 shrink-0", className)} aria-hidden />
}

function TabList({
  className,
  children,
  "aria-label": ariaLabel,
}: {
  className?: string
  children: ReactNode
  "aria-label"?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2",
        className,
      )}
    >
      {children}
    </div>
  )
}

function Tab({
  className,
  selected,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        "flex min-w-0 shrink-0 items-center border-0 bg-transparent p-0 shadow-none outline-none",
        "px-0.5 py-0.5",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "truncate pl-0.5 text-left text-[10px] font-medium uppercase tracking-wider transition-colors",
          selected
            ? "text-muted-foreground"
            : "text-muted-foreground/45 hover:text-muted-foreground/75",
        )}
      >
        {children}
      </span>
    </button>
  )
}

export const SidebarPanelHeader = Object.assign(Root, {
  Title,
  Trailer,
  CountSpacer,
  ActionSlot,
  TabList,
  Tab,
})

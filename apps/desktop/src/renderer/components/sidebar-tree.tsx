import type { ButtonHTMLAttributes, ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

function RowRoot({
  className,
  children,
  active = false,
}: {
  className?: string
  children: ReactNode
  /** Render a 2px amber left-edge indicator. */
  active?: boolean
}) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center gap-0 rounded-sm py-0 pl-1 pr-0 transition-colors duration-100 ease-out hover:bg-accent",
        className,
      )}
    >
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-px left-0 w-[2px] bg-signal"
        />
      )}
      {children}
    </div>
  )
}

function RowTrigger({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-w-0 flex-1 items-center gap-0.5 rounded-sm px-0 py-px text-left text-xs leading-tight transition-colors",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function RowDisclosure({
  expanded,
  className,
}: {
  expanded: boolean
  className?: string
}) {
  return (
    <span className="flex w-4 shrink-0 justify-center">
      <ChevronRight
        className={cn(
          "size-2.5 shrink-0 text-muted-foreground transition-transform",
          expanded && "rotate-90",
          className,
        )}
      />
    </span>
  )
}

function RowIcon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("flex w-4 shrink-0 justify-center", className)}>
      {children}
    </span>
  )
}

function RowLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("min-w-0 flex-1 truncate", className)}>
      {children}
    </span>
  )
}

function RowMeta({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "min-w-[2ch] shrink-0 text-right tabular-nums text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  )
}

function RowMetaPlaceholder({ value = "0" }: { value?: string }) {
  return (
    <span
      className="min-w-[2ch] shrink-0 text-right tabular-nums text-xs text-transparent select-none"
      aria-hidden
    >
      {value}
    </span>
  )
}

function RowActions({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)}>
      {children}
    </div>
  )
}

function RowActionSlot({ className }: { className?: string }) {
  return <span className={cn("size-6 shrink-0", className)} aria-hidden />
}

function RowAlignedEnd() {
  return (
    <>
      <RowMetaPlaceholder />
      <RowActions>
        <RowActionSlot />
      </RowActions>
    </>
  )
}

function BranchRoot({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex items-stretch gap-0 py-0 pl-0.5", className)}>
      {children}
    </div>
  )
}

function BranchRuler({ className }: { className?: string }) {
  return (
    <div className="relative w-4 shrink-0">
      <div
        aria-hidden
        className={cn(
          "bg-border/45 absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2",
          className,
        )}
      />
    </div>
  )
}

function BranchContent({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 space-y-0 pl-0.5",
        className,
      )}
    >
      {children}
    </div>
  )
}

function NestedItem({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full rounded-sm px-0.5 py-px text-left text-xs leading-tight text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export const SidebarTreeRow = Object.assign(RowRoot, {
  Trigger: RowTrigger,
  Disclosure: RowDisclosure,
  Icon: RowIcon,
  Label: RowLabel,
  Meta: RowMeta,
  MetaPlaceholder: RowMetaPlaceholder,
  Actions: RowActions,
  ActionSlot: RowActionSlot,
  AlignedEnd: RowAlignedEnd,
})

export const SidebarTreeBranch = Object.assign(BranchRoot, {
  Ruler: BranchRuler,
  Content: BranchContent,
})

export { NestedItem as SidebarTreeNestedItem }

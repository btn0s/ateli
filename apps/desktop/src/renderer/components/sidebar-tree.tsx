import type { ButtonHTMLAttributes, ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

function RowRoot({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-0.5 rounded-sm px-1 py-0.5 hover:bg-accent",
        className,
      )}
    >
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
        "flex min-w-0 flex-1 items-center gap-1 rounded-sm px-0.5 py-0.5 text-left text-xs transition-colors",
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
          "size-3 shrink-0 text-muted-foreground transition-transform",
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
        "min-w-[2ch] shrink-0 text-right tabular-nums text-[10px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Invisible count column — lines up with `SidebarPanelHeader.CountSpacer` and visible `RowMeta`. */
function RowMetaPlaceholder({ value = "0" }: { value?: string }) {
  return (
    <span
      className="min-w-[2ch] shrink-0 text-right tabular-nums text-[10px] text-transparent select-none"
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

/** Reserves `icon-xs` width when a row has no trailing buttons (aligns with worktree rows). */
function RowActionSlot({ className }: { className?: string }) {
  return <span className={cn("size-6 shrink-0", className)} aria-hidden />
}

/** Trailing columns matching worktrees: placeholder count + empty action slot. */
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
    <div className={cn("flex items-stretch gap-0 py-0.5 pl-1", className)}>
      {children}
    </div>
  )
}

function BranchRuler({ className }: { className?: string }) {
  return (
    <div className="flex shrink-0 pl-0.5">
      <div className="relative w-4 shrink-0">
        <div
          aria-hidden
          className={cn(
            "bg-border/45 absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2",
            className,
          )}
        />
      </div>
    </div>
  )
}

function BranchContent({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0 flex-1 space-y-0.5", className)}>
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
        "flex w-full rounded-sm px-1 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
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

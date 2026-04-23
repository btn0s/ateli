import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

export interface ShapeChromeAction {
  id: string
  icon: LucideIcon
  label: string
  onClick: () => void
}

interface ShapeChromeProps {
  /** Title shown in the top bar */
  title: string
  /** Optional icon before the title */
  icon?: LucideIcon
  /** Action buttons in the top-right */
  actions?: ShapeChromeAction[]
  /** The shape content */
  children: ReactNode
  /** Whether the shape is interactive (focused/editing) */
  isInteractive?: boolean
}

export function ShapeChrome({
  title,
  icon: Icon,
  actions,
  children,
  isInteractive,
}: ShapeChromeProps) {
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden border border-border bg-card transition-colors duration-150 ease-out"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-muted/50 px-2">
        <div className="flex items-center gap-1.5 overflow-hidden">
          {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate text-[11px] tracking-[0.02em] text-muted-foreground">
            {title}
          </span>
        </div>
        {actions && actions.length > 0 && (
          <div className="flex items-center gap-0.5">
            {actions.map((action) => (
              <button
                key={action.id}
                className="flex size-5 items-center justify-center text-muted-foreground transition-colors duration-100 ease-out hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  action.onClick()
                }}
                title={action.label}
                style={{ pointerEvents: isInteractive ? "auto" : "none" }}
              >
                <action.icon className="size-3" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

export interface ShapeChromeAction {
  id: string
  icon: LucideIcon
  label: string
  onClick: () => void
}

interface ShapeChromeProps {
  title: string
  icon?: LucideIcon
  actions?: ShapeChromeAction[]
  children: ReactNode
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
      className="flex h-full w-full flex-col overflow-hidden border border-border/60 bg-card"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate font-mono text-xs text-muted-foreground">
            {title}
          </span>
        </div>
        {actions && actions.length > 0 && (
          <div className="flex items-center gap-0.5">
            {actions.map((action) => (
              <button
                key={action.id}
                className="flex size-6 items-center justify-center rounded-[3px] text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  action.onClick()
                }}
                title={action.label}
                style={{ pointerEvents: isInteractive ? "auto" : "none" }}
              >
                <action.icon className="size-3.5" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

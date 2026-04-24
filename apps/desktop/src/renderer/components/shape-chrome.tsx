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
      className="ateli-surface-slab flex h-full w-full flex-col overflow-hidden border border-border/30 bg-gradient-to-b from-card/95 to-card/90"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="ateli-surface-input-stripe flex h-9 shrink-0 items-center justify-between border-b border-border/20 px-3">
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
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-accent hover:text-accent-foreground active:scale-[0.96]"
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

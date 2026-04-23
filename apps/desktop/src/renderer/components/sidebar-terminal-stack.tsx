import { Plus, X } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { SidebarEmbeddedTerminal } from "@/components/sidebar-embedded-terminal"

function terminalTabSurfaceClass(selected: boolean) {
  return cn(
    "inline-flex h-8 shrink-0 items-stretch overflow-hidden border-y border-transparent outline-none",
    "focus-within:ring-1 focus-within:ring-ring focus-within:ring-inset",
    selected
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  )
}

/**
 * One PTY per tab; inactive tabs stay mounted so sessions survive tab switches.
 * Index 0 is always "Terminal" and cannot be closed from the tab bar.
 */
export function SidebarTerminalTabs({
  cwd,
  tabIds,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onSessionEnded,
  onAddTab,
}: {
  cwd: string
  tabIds: string[]
  activeTabId: string | null
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onSessionEnded: (id: string) => void
  onAddTab: () => void
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-b border-border bg-muted px-0 py-0">
      <div className="flex h-8 min-h-8 shrink-0 items-stretch border-b border-border bg-background">
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]">
          <div
            role="tablist"
            aria-label="Sidebar terminals"
            className="flex h-8 min-h-8 w-max min-w-full items-stretch"
          >
            {tabIds.map((id, i) => {
              const selected = activeTabId === id
              const label = i === 0 ? "Terminal" : `T${i}`
              const canClose = i > 0
              return (
                <div
                  key={id}
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className={cn(
                    "flex shrink-0 items-stretch border-r border-border last:border-r-0",
                    terminalTabSurfaceClass(selected),
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 max-w-[9rem] flex-1 items-center px-2 text-left text-xs font-medium uppercase tracking-wide"
                    onClick={() => onSelectTab(id)}
                  >
                    <span className={cn("truncate", i === 0 && "normal-case")}>
                      {label}
                    </span>
                  </button>
                  {canClose ? (
                    <button
                      type="button"
                      className="flex h-8 w-7 shrink-0 items-center justify-center border-l border-border text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                      title={`Close ${label}`}
                      aria-label={`Close ${label}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onCloseTab(id)
                      }}
                    >
                      <X className="size-3.5 shrink-0 opacity-70 hover:opacity-100" />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-stretch border-l border-border bg-background">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 min-h-8 w-8 shrink-0 rounded-none"
            title="New terminal"
            aria-label="New terminal"
            onClick={onAddTab}
          >
            <Plus />
          </Button>
        </div>
      </div>

      {tabIds.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          No terminals. Use + to add one.
        </p>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
          {tabIds.map((id) => (
            <div
              key={id}
              className={cn(
                "absolute inset-0 flex min-h-0 flex-col overflow-hidden",
                activeTabId === id
                  ? "visible z-10"
                  : "invisible z-0 pointer-events-none",
              )}
              aria-hidden={activeTabId !== id}
            >
              <SidebarEmbeddedTerminal
                instanceKey={id}
                cwd={cwd}
                onSessionEnded={() => onSessionEnded(id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import { useCallback, useState } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Sidebar } from "@/components/sidebar"
import { SidebarEmbeddedTerminal } from "@/components/sidebar-embedded-terminal"

function newInstanceId(): string {
  return crypto.randomUUID()
}

export function SidebarTerminalDock({ cwd }: { cwd: string }) {
  const [instances, setInstances] = useState<string[]>(() => [newInstanceId()])

  const add = useCallback(() => {
    setInstances((s) => [...s, newInstanceId()])
  }, [])

  const remove = useCallback((id: string) => {
    setInstances((s) => s.filter((x) => x !== id))
  }, [])

  return (
    <div
      className={cn(
        "flex w-full shrink-0 flex-col border-t border-border bg-muted",
      )}
    >
      <Sidebar.SectionHeader>
        <span className="text-xs font-medium text-muted-foreground uppercase">
          Terminal
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          title="Add terminal"
          aria-label="Add terminal"
          onClick={add}
        >
          <Plus />
        </Button>
      </Sidebar.SectionHeader>

      <Sidebar.Section className="flex flex-col gap-2 py-1.5">
        {instances.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No terminals open. Use + in the header to start one.
          </p>
        ) : null}
        {instances.map((id) => (
          <div
            key={id}
            className="relative border border-border bg-background"
          >
            <div className="flex items-center justify-end border-b border-border px-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                title="Close terminal"
                aria-label="Close terminal"
                onClick={() => remove(id)}
              >
                <X className="size-3" />
              </Button>
            </div>
            <SidebarEmbeddedTerminal
              instanceKey={id}
              cwd={cwd}
              onSessionEnded={() => remove(id)}
            />
          </div>
        ))}
      </Sidebar.Section>
    </div>
  )
}

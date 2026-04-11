import { cn } from "@workspace/ui/lib/utils"

/** Full-bleed width inside `SidebarHud`’s `px-3` content. */
export const WORKSPACE_PANEL_BLEED = "-mx-3 w-[calc(100%+1.5rem)] max-w-none"

export const chromeIconTriggerClass = cn(
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none",
  "transition-colors hover:bg-muted hover:text-foreground",
  "focus-visible:ring-1 focus-visible:ring-ring",
)

import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/** Full-bleed inside sidebar content padded with `px-2` (matches `SidebarHud`). */
export const WORKSPACE_PANEL_BLEED = "-mx-2 w-[calc(100%+1rem)] max-w-none"

/** Shared ghost icon control — same as `Button variant="ghost" size="icon-sm"`. */
export const workspaceIconButtonClass = cn(
  buttonVariants({ variant: "ghost", size: "icon-sm" }),
  "text-muted-foreground",
)

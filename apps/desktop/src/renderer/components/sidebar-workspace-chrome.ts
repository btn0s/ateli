import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/** Shared ghost icon control — same as `Button variant="ghost" size="icon-sm"`. */
export const workspaceIconButtonClass = cn(
  buttonVariants({ variant: "ghost", size: "icon-sm" }),
  "text-muted-foreground",
)

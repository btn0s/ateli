import type { ComponentProps } from "react"
import { cn } from "@workspace/ui/lib/utils"

function Section({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-section"
      className={cn("px-2", className)}
      {...props}
    />
  )
}

export const Sidebar = {
  Section,
}

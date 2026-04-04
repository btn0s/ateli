import type { ReactNode } from "react"
import { SidebarShell } from "./sidebar-shell"

interface SidebarHudProps {
  left?: ReactNode
  right?: ReactNode
}

export function SidebarHud({ left, right }: SidebarHudProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[200] flex font-sans">
      <SidebarShell side="left" defaultWidth={240} minWidth={120}>
        <div className="box-border flex min-h-0 min-w-0 flex-1 flex-col px-3">
          {left}
        </div>
      </SidebarShell>

      <div className="min-w-0 flex-1" />

      <SidebarShell side="right" defaultWidth={240} minWidth={120}>
        <div className="box-border flex min-h-0 min-w-0 flex-1 flex-col px-3">
          {right}
        </div>
      </SidebarShell>
    </div>
  )
}

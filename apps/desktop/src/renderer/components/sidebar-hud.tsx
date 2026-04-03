import type { ReactNode } from "react"
import { SidebarShell } from "./sidebar-shell"

interface SidebarHudProps {
  left?: ReactNode
  right?: ReactNode
}

export function SidebarHud({ left, right }: SidebarHudProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[200] flex font-sans">
      {/* Left sidebar */}
      <SidebarShell side="left" defaultWidth={240} minWidth={120}>
        {left}
      </SidebarShell>

      {/* Canvas gap — pointer-events pass through to canvas */}
      <div className="min-w-0 flex-1" />

      {/* Right sidebar */}
      <SidebarShell side="right" defaultWidth={240} minWidth={120}>
        {right}
      </SidebarShell>
    </div>
  )
}

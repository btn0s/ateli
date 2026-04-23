import type { ReactNode } from "react"
import { SidebarShell } from "./sidebar-shell"

interface SidebarHudProps {
  left?: ReactNode
  /** Omitted or null: right sidebar is not mounted (no panel chrome or width). */
  right?: ReactNode | null
}

export function SidebarHud({ left, right }: SidebarHudProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[200] flex font-sans">
      <SidebarShell side="left">{left}</SidebarShell>

      <div className="min-w-0 flex-1" />

      {right != null ? right : null}
    </div>
  )
}

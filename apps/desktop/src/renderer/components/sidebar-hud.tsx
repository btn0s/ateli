import type { ReactNode } from "react"
import { SidebarShell } from "./sidebar-shell"

interface SidebarHudProps {
  left?: ReactNode
  center?: ReactNode | null
  /** Overlay rendered only in the center region (between sidebars). */
  centerOverlay?: ReactNode | null
  /** Omitted or null: right sidebar is not mounted (no panel chrome or width). */
  right?: ReactNode | null
}

export function SidebarHud({
  left,
  center,
  centerOverlay,
  right,
}: SidebarHudProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1000] flex font-sans">
      <SidebarShell side="left">{left}</SidebarShell>

      <div data-center-lane className="relative min-w-0 flex-1 overflow-hidden">
        {center}
        {centerOverlay ? (
          <div className="pointer-events-none absolute inset-0">
            {centerOverlay}
          </div>
        ) : null}
      </div>

      {right != null ? right : null}
    </div>
  )
}

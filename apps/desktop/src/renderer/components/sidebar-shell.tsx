import { useState, useRef, useCallback, useEffect, type ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"

const STORAGE_KEY_PREFIX = "ateli:sidebar"

interface SidebarShellProps {
  side: "left" | "right"
  defaultWidth?: number
  minWidth?: number
  /** Content for the top traffic-light strip (e.g. branch + menu). Omit for an empty inset. */
  safeArea?: ReactNode
  children: ReactNode
  className?: string
}

function getStoredWidth(side: string, fallback: number): number {
  try {
    const v = localStorage.getItem(`${STORAGE_KEY_PREFIX}:${side}:width`)
    if (v !== null) return Number(v)
  } catch {}
  return fallback
}

export function SidebarShell({
  side,
  defaultWidth = 260,
  minWidth = 180,
  safeArea,
  children,
  className,
}: SidebarShellProps) {
  const [width, setWidth] = useState(() => {
    const stored = getStoredWidth(side, defaultWidth)
    // A stored width of 0 means "collapsed" — drive that through `collapsed`,
    // not `width`, otherwise expanding has no pixels to expand into.
    return stored === 0 ? defaultWidth : stored
  })
  const [collapsed, setCollapsed] = useState(() => getStoredWidth(side, defaultWidth) === 0)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const persist = useCallback(
    (w: number) => {
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}:${side}:width`, String(w))
      } catch {}
    },
    [side],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startWidth.current = collapsed ? 0 : width
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [width, collapsed],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      const delta = side === "left"
        ? e.clientX - startX.current
        : startX.current - e.clientX
      const next = startWidth.current + delta

      if (next < minWidth * 0.5) {
        setCollapsed(true)
        setWidth(minWidth)
      } else {
        setCollapsed(false)
        setWidth(Math.max(minWidth, next))
      }
    },
    [side, minWidth],
  )

  const onPointerUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    persist(collapsed ? 0 : width)
  }, [collapsed, width, persist])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return
      const key = side === "left" ? "[" : "]"
      if (e.key !== key) return
      e.preventDefault()
      e.stopPropagation()
      setCollapsed((c) => {
        const next = !c
        persist(next ? 0 : width)
        return next
      })
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [side, width, persist])

  const displayWidth = collapsed ? 0 : width

  return (
    <div
      className={cn(
        "pointer-events-auto relative flex h-full shrink-0 overflow-hidden",
        className,
      )}
      style={{ width: displayWidth }}
    >
      {!collapsed && (
        <div
          className={cn(
            "flex h-full min-h-0 w-full flex-col overflow-hidden border-border bg-card text-card-foreground backdrop-blur-md",
            side === "left" ? "border-r" : "border-l",
          )}
        >
          {/* Safe zone height matches the Titlebar drag region (48px).
              Inside, content top-aligns with pt-5 (20px) so the branch
              text baseline sits near the vertical center of the traffic
              lights (y≈25 for trafficLightPosition.y=18 + 7 radius). */}
          {safeArea != null ? (
            <div className="h-12 min-h-12 shrink-0 px-3 pt-5 pb-1">{safeArea}</div>
          ) : (
            <div className="h-12 min-h-12 shrink-0" aria-hidden />
          )}
          {children}
        </div>
      )}

      <div
        className={cn(
          "absolute top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors duration-150 ease-out hover:bg-border/60 active:bg-border",
          side === "left" ? "right-0" : "left-0",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  )
}

import { useEffect, useState, useCallback, useRef } from "react"
import { useEditor } from "tldraw"
import { getContextMenuActions } from "@/lib/tool-registry"

export function CanvasContextMenu() {
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      // Only handle right-clicks on the canvas background, not on shapes
      const target = e.target as HTMLElement
      if (target.closest(".tl-shape") || target.closest("[data-shape-id]"))
        return

      e.preventDefault()
      setPosition({ x: e.clientX, y: e.clientY })
      setOpen(true)
    }

    function onClick() {
      setOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }

    window.addEventListener("contextmenu", onContextMenu)
    window.addEventListener("click", onClick)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("contextmenu", onContextMenu)
      window.removeEventListener("click", onClick)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  const run = useCallback((fn: () => void) => {
    fn()
    setOpen(false)
  }, [])

  if (!open) return null

  const actions = getContextMenuActions()

  return (
    <div
      ref={menuRef}
      className="pointer-events-auto fixed z-[500] min-w-[180px] border border-border bg-background p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => run(() => action.execute(editor))}
        >
          <action.icon className="size-4" />
          {action.label}
        </button>
      ))}
    </div>
  )
}

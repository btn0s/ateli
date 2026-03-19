import { useEffect, useState, useCallback } from "react"
import { useEditor } from "tldraw"
import {
  MousePointer2,
  Pencil,
  Eraser,
  MoveRight,
  Type,
  TerminalSquare,
  ZoomIn,
  ZoomOut,
  Maximize,
  SquareDashedMousePointer,
  RotateCcw,
} from "lucide-react"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@workspace/ui/components/command"

const ANIM = { animation: { duration: 200 } }

export function CommandMenu() {
  const editor = useEditor()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        setOpen((o) => !o)
      }
      if (e.key === "Escape" && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [open])

  const run = useCallback(
    (fn: () => void) => {
      fn()
      setOpen(false)
    },
    [],
  )

  if (!open) return null

  return (
    <div className="pointer-events-auto absolute inset-0 z-[400] flex items-start justify-center pt-[20vh]">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />
      <Command
        className="relative h-fit w-full max-w-md border border-border bg-background shadow-2xl"
        loop
      >
        <CommandInput autoFocus placeholder="Search tools and actions..." />
        <CommandList className="max-h-72">
          <CommandEmpty>No results found.</CommandEmpty>

          <CommandGroup heading="Tools">
            <CommandItem onSelect={() => run(() => editor.setCurrentTool("select"))}>
              <MousePointer2 className="size-4" />
              Select
              <CommandShortcut>V</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => editor.setCurrentTool("draw"))}>
              <Pencil className="size-4" />
              Draw
              <CommandShortcut>D</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => editor.setCurrentTool("eraser"))}>
              <Eraser className="size-4" />
              Eraser
              <CommandShortcut>E</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => editor.setCurrentTool("arrow"))}>
              <MoveRight className="size-4" />
              Arrow
              <CommandShortcut>A</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => editor.setCurrentTool("text"))}>
              <Type className="size-4" />
              Text
              <CommandShortcut>T</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() => {
                  const center = editor.getViewportPageBounds().center
                  editor.createShape({
                    type: "terminal",
                    x: center.x - 300,
                    y: center.y - 200,
                  })
                })
              }
            >
              <TerminalSquare className="size-4" />
              Add Terminal
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Zoom">
            <CommandItem
              onSelect={() =>
                run(() =>
                  editor.zoomIn(editor.getViewportScreenCenter(), ANIM),
                )
              }
            >
              <ZoomIn className="size-4" />
              Zoom In
              <CommandShortcut>⌘+</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() =>
                  editor.zoomOut(editor.getViewportScreenCenter(), ANIM),
                )
              }
            >
              <ZoomOut className="size-4" />
              Zoom Out
              <CommandShortcut>⌘-</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => run(() => editor.zoomToFit(ANIM))}
            >
              <Maximize className="size-4" />
              Zoom to Fit
              <CommandShortcut>⇧1</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => run(() => editor.zoomToSelection(ANIM))}
            >
              <SquareDashedMousePointer className="size-4" />
              Zoom to Selection
              <CommandShortcut>⇧2</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() =>
                  editor.resetZoom(editor.getViewportScreenCenter(), ANIM),
                )
              }
            >
              <RotateCcw className="size-4" />
              Reset Zoom (100%)
              <CommandShortcut>⇧0</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}

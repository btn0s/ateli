import { useEffect, useState, useCallback } from "react"
import { useEditor } from "tldraw"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@workspace/ui/components/command"
import { getCommandMenuActions } from "@/lib/tool-registry"

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

  const run = useCallback((fn: () => void) => {
    fn()
    setOpen(false)
  }, [])

  if (!open) return null

  const actions = getCommandMenuActions()

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
        <CommandInput autoFocus placeholder="Search actions..." />
        <CommandList className="max-h-72">
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Actions">
            {actions.map((action) => (
              <CommandItem
                key={action.id}
                onSelect={() => run(() => action.execute(editor))}
              >
                <action.icon className="size-4" />
                {action.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}

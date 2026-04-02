import { useEffect, useState, useCallback } from "react"
import { useEditor } from "tldraw"
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
import { getCommandMenuActions, groupActions } from "@/lib/tool-registry"

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
  const groups = groupActions(actions)
  const groupNames = [...groups.keys()]

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

          {groupNames.map((groupName, i) => (
            <div key={groupName}>
              {i > 0 && <CommandSeparator />}
              <CommandGroup heading={groupName}>
                {groups.get(groupName)!.map((action) => (
                  <CommandItem
                    key={action.id}
                    onSelect={() => run(() => action.execute(editor))}
                  >
                    <action.icon className="size-4" />
                    {action.label}
                    {action.shortcut && (
                      <CommandShortcut>{action.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
      </Command>
    </div>
  )
}

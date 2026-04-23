import { useCallback, useEffect, useState } from "react"
import { track, useEditor } from "tldraw"
import { Badge } from "@workspace/ui/components/badge"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@workspace/ui/components/command"
import { useWorktrees } from "@/contexts/worktree-index-context"
import { useCommandPalette } from "./use-command-palette"
import type { CommandDefinition } from "./types"

function commandRow(
  def: CommandDefinition,
  onSelect: (d: CommandDefinition) => void,
) {
  const value = `${def.id} ${def.title} ${def.subtitle ?? ""} ${def.keywords.join(" ")} ${def.contextBadge ?? ""}`.toLowerCase()
  return (
    <CommandItem
      key={def.id}
      value={value}
      onSelect={() => onSelect(def)}
    >
      <def.icon className="size-4 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block min-w-0 truncate">{def.title}</span>
        {def.subtitle ? (
          <span className="line-clamp-1 text-muted-foreground">
            {def.subtitle}
          </span>
        ) : null}
      </span>
      {def.contextBadge ? (
        <Badge
          variant="secondary"
          className="h-4 shrink-0 text-[0.5rem] font-medium uppercase"
        >
          {def.contextBadge}
        </Badge>
      ) : null}
      {def.shortcut ? <CommandShortcut>{def.shortcut}</CommandShortcut> : null}
    </CommandItem>
  )
}

function searchResultsList(
  list: CommandDefinition[],
  onSelect: (d: CommandDefinition) => void,
) {
  if (list.length === 0) return null
  return (
    <CommandGroup heading="Results">
      {list.map((def) => commandRow(def, onSelect))}
    </CommandGroup>
  )
}

function emptyQuerySections(
  sections: { section: string; items: CommandDefinition[] }[],
  onSelect: (d: CommandDefinition) => void,
) {
  if (sections.length === 0) {
    return null
  }
  return sections.map((sec, i) => (
    <div key={sec.section}>
      {i > 0 ? <CommandSeparator /> : null}
      <CommandGroup heading={sec.section}>
        {sec.items.map((def) => commandRow(def, onSelect))}
      </CommandGroup>
    </div>
  ))
}

export const CommandPalette = track(function CommandPalette() {
  const editor = useEditor()
  const worktrees = useWorktrees()
  const [open, setOpen] = useState(false)
  const { search, setSearch, setError, run, error, display } = useCommandPalette(
    editor,
    worktrees,
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        setOpen((wasOpen) => {
          if (wasOpen) return false
          setSearch("")
          setError(null)
          return true
        })
      }
      if (e.key === "Escape" && open) {
        e.preventDefault()
        setOpen(false)
        setSearch("")
        setError(null)
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [open, setError, setSearch])

  const close = useCallback(() => {
    setOpen(false)
    setSearch("")
    setError(null)
  }, [setError, setSearch])

  const selectCommand = useCallback(
    (def: CommandDefinition) => {
      void (async () => {
        setError(null)
        const ok = await run(def)
        if (ok) close()
      })()
    },
    [close, run, setError],
  )

  if (!open) return null

  const hasRows =
    display.mode === "search"
      ? display.list.length > 0
      : display.sections.some(
          (section: { items: CommandDefinition[] }) =>
            section.items.length > 0,
        )

  return (
    <div className="pointer-events-auto absolute inset-0 z-[400] flex items-start justify-center pt-[20vh]">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => close()}
        aria-hidden
      />
      <Command
        shouldFilter={false}
        className="relative h-fit w-full max-w-md border border-border bg-background shadow-2xl"
        loop
      >
        <CommandInput
          value={search}
          onValueChange={(v) => {
            setSearch(v)
            setError(null)
          }}
          autoFocus
          placeholder="Run a command, jump to a worktree, terminal, or frame…"
        />
        <CommandList className="max-h-80">
          {error ? (
            <div className="border-b px-2 py-2 text-center text-xs text-amber-600">
              {error}
            </div>
          ) : null}
          {display.mode === "search" ? (
            searchResultsList(display.list, selectCommand)
          ) : (
            emptyQuerySections(display.sections, selectCommand)
          )}
          {!error && !hasRows ? <CommandEmpty>No matches.</CommandEmpty> : null}
        </CommandList>
      </Command>
    </div>
  )
})

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
import { registerNewTerminalWorktreeOpener } from "./new-terminal-flow"
import { registerNewWorktreeSourceOpener } from "./new-worktree-flow"
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
      disabled={def.disabled}
      onSelect={() => {
        if (def.disabled) {
          return
        }
        onSelect(def)
      }}
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
          className="h-5 min-w-0 max-w-[5.5rem] shrink-0 truncate text-[0.625rem] font-medium uppercase leading-none"
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
  groupHeading: string,
) {
  if (list.length === 0) return null
  return (
    <CommandGroup heading={groupHeading}>
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
  const {
    search,
    setSearch,
    setError,
    run,
    error,
    display,
    paletteSubflow,
    setPaletteSubflow,
    clearPaletteSubflow,
  } = useCommandPalette(editor, worktrees)

  useEffect(() => {
    return registerNewTerminalWorktreeOpener(() => {
      setOpen(true)
      setPaletteSubflow("new-terminal")
      setSearch("")
      setError(null)
    })
  }, [setError, setPaletteSubflow, setSearch])

  useEffect(() => {
    return registerNewWorktreeSourceOpener(() => {
      setOpen(true)
      setPaletteSubflow("new-worktree")
      setSearch("")
      setError(null)
    })
  }, [setError, setPaletteSubflow, setSearch])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        setOpen((wasOpen) => {
          if (wasOpen) return false
          setSearch("")
          setError(null)
          clearPaletteSubflow()
          return true
        })
      }
      if (e.key === "Escape" && open) {
        e.preventDefault()
        if (paletteSubflow) {
          clearPaletteSubflow()
          setSearch("")
          return
        }
        setOpen(false)
        setSearch("")
        setError(null)
        clearPaletteSubflow()
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [open, paletteSubflow, clearPaletteSubflow, setError, setSearch])

  const close = useCallback(() => {
    setOpen(false)
    setSearch("")
    setError(null)
    clearPaletteSubflow()
  }, [clearPaletteSubflow, setError, setSearch])

  const selectCommand = useCallback(
    (def: CommandDefinition) => {
      void (async () => {
        setError(null)
        const outcome = await run(def)
        if (outcome === true) close()
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
    <div className="pointer-events-auto absolute inset-0 z-[400] flex items-start justify-center pt-[20vh] antialiased">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => close()}
        aria-hidden
      />
      <Command
        shouldFilter={false}
        className="relative z-[1] h-fit w-full max-w-md overflow-hidden rounded-lg bg-background text-popover-foreground ring-1 ring-border/50 shadow-2xl"
        loop
      >
        <CommandInput
          value={search}
          onValueChange={(v) => {
            setSearch(v)
            setError(null)
          }}
          autoFocus
          placeholder={
            paletteSubflow === "new-terminal"
              ? "Filter folders, or find “new worktree” to create one…"
              : paletteSubflow === "new-worktree"
                ? "Choose how to start the new worktree…"
                : "Run a command, jump to a worktree, terminal, or frame…"
          }
        />
        <CommandList className="max-h-80">
          {error ? (
            <div className="border-b border-border/50 px-2.5 py-2 text-center text-pretty text-xs text-amber-600">
              {error}
            </div>
          ) : null}
          {display.mode === "search" ? (
            searchResultsList(
              display.list,
              selectCommand,
              paletteSubflow === "new-terminal"
                ? "Working folder"
                : paletteSubflow === "new-worktree"
                  ? "Start from"
                  : "Results",
            )
          ) : (
            emptyQuerySections(display.sections, selectCommand)
          )}
          {!error && !hasRows ? <CommandEmpty>No matches.</CommandEmpty> : null}
        </CommandList>
      </Command>
    </div>
  )
})

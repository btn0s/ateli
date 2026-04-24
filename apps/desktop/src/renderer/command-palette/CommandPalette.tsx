import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, ChevronsRight, CornerDownLeft } from "lucide-react"
import { track, useEditor } from "tldraw"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import { useRepoPath, useWorktrees } from "@/contexts/worktree-index-context"
import { useManagementPolicy } from "@/contexts/management-policy-context"
import { useTerminalRenameDialog } from "@/components/terminal-rename-dialog"
import { useWorktreeRenameConfirmation } from "@/components/worktree-rename-dialog"
import { useWorktreeRemoveConfirmation } from "@/components/worktree-remove-dialog"
import { useTerminalKillConfirmation } from "@/components/terminal-kill-dialog"
import { usePaletteController } from "./palette-controller"
import { useCommandPalette } from "./use-command-palette"
import type { CommandDefinition } from "./types"

function commandRow(
  def: CommandDefinition,
  args: {
    onSelect: (d: CommandDefinition) => void
    onOpenActions: (d: CommandDefinition) => void
    canOpenActions: boolean
  },
) {
  return (
    <CommandItem
      key={def.id}
      value={def.id}
      data-command-id={def.id}
      disabled={def.disabled}
      onSelect={() => {
        if (def.disabled) {
          return
        }
        args.onSelect(def)
      }}
    >
      <def.icon className="size-4 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 truncate text-left">{def.title}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
        {def.shortcut ? (
          <span className="text-xs tracking-widest text-muted-foreground">
            {def.shortcut}
          </span>
        ) : null}
        {args.canOpenActions ? (
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-accent/60 hover:text-foreground active:scale-[0.96]"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              args.onOpenActions(def)
            }}
            aria-label={`Open actions for ${def.title}`}
          >
            <ChevronsRight className="size-4" />
          </button>
        ) : null}
      </div>
    </CommandItem>
  )
}

function searchResultsList(
  list: CommandDefinition[],
  args: {
    onSelect: (d: CommandDefinition) => void
    onOpenActions: (d: CommandDefinition) => void
    canOpenActions: (d: CommandDefinition) => boolean
    heading: string
  },
) {
  if (list.length === 0) return null
  return (
    <CommandGroup heading={args.heading}>
      {list.map((def) =>
        commandRow(def, {
          onSelect: args.onSelect,
          onOpenActions: args.onOpenActions,
          canOpenActions: args.canOpenActions(def),
        }),
      )}
    </CommandGroup>
  )
}

function emptyQuerySections(
  sections: { section: string; items: CommandDefinition[] }[],
  args: {
    onSelect: (d: CommandDefinition) => void
    onOpenActions: (d: CommandDefinition) => void
    canOpenActions: (d: CommandDefinition) => boolean
  },
) {
  if (sections.length === 0) {
    return null
  }
  return sections.map((sec, i) => (
    <div key={sec.section}>
      {i > 0 ? <CommandSeparator /> : null}
      <CommandGroup heading={sec.section}>
        {sec.items.map((def) =>
          commandRow(def, {
            onSelect: args.onSelect,
            onOpenActions: args.onOpenActions,
            canOpenActions: args.canOpenActions(def),
          }),
        )}
      </CommandGroup>
    </div>
  ))
}

export const CommandPalette = track(function CommandPalette() {
  const editor = useEditor()
  const repoPath = useRepoPath()
  const worktrees = useWorktrees()
  const { policy } = useManagementPolicy()
  const { requestRename: requestRenameTerminal, dialog: renameTerminalDialog } =
    useTerminalRenameDialog()
  const { requestRename: requestRenameWorktree, dialog: renameWorktreeDialog } =
    useWorktreeRenameConfirmation()
  const { requestRemove: requestRemoveWorktrees, dialog: removeWorktreeDialog } =
    useWorktreeRemoveConfirmation()
  const { requestKill: requestKillSession, dialog: killTerminalDialog } =
    useTerminalKillConfirmation()
  const controller = usePaletteController()
  const open = controller.isOpen
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(null)
  const paletteRef = useRef<HTMLDivElement | null>(null)
  const paletteEnv = useMemo(
    () => ({
      policy: policy.user,
      requestRenameTerminal,
      requestRenameWorktree,
      requestRemoveWorktrees,
      requestKillSession,
    }),
    [
      policy.user,
      requestKillSession,
      requestRemoveWorktrees,
      requestRenameTerminal,
      requestRenameWorktree,
    ],
  )
  const {
    search,
    setSearch,
    setError,
    run,
    error,
    display,
    currentRoute,
    routeMeta,
    canGoBack,
    goBack,
    resetToRoot,
    openRoute,
    openActionsFor,
    canOpenActions,
  } = useCommandPalette(editor, repoPath, worktrees, paletteEnv)

  const close = useCallback(() => {
    controller.close()
    setSelectedCommandId(null)
    resetToRoot()
  }, [controller, resetToRoot])

  useEffect(() => {
    if (!controller.isOpen) return
    setSelectedCommandId(null)
    openRoute(controller.initialRoute)
  }, [controller.initialRoute, controller.isOpen, openRoute])

  const visibleCommands = useMemo(
    () =>
      display.mode === "search"
        ? display.list
        : display.sections.flatMap((section) => section.items),
    [display],
  )

  const activeCommand =
    visibleCommands.find((def) => def.id === selectedCommandId) ??
    visibleCommands[0] ??
    null

  useEffect(() => {
    if (!visibleCommands.length) {
      setSelectedCommandId(null)
      return
    }
    const firstCommand = visibleCommands[0]
    if (
      firstCommand &&
      (!selectedCommandId || !visibleCommands.some((d) => d.id === selectedCommandId))
    ) {
      setSelectedCommandId(firstCommand.id)
    }
  }, [selectedCommandId, visibleCommands])

  useEffect(() => {
    if (!open || !paletteRef.current) {
      return
    }

    const root = paletteRef.current
    const syncSelected = () => {
      const selected = root.querySelector<HTMLElement>(
        '[data-slot="command-item"][data-selected="true"][data-command-id]',
      )
      const nextId = selected?.dataset.commandId ?? visibleCommands[0]?.id ?? null
      setSelectedCommandId((prev) => (prev === nextId ? prev : nextId))
    }

    const observer = new MutationObserver(syncSelected)
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-selected"],
    })

    syncSelected()

    return () => observer.disconnect()
  }, [open, visibleCommands])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        if (!open) {
          controller.open()
          return
        }
        if (currentRoute.kind !== "actions" && activeCommand && canOpenActions(activeCommand)) {
          openActionsFor(activeCommand)
        }
        return
      }

      if (e.key === "Escape" && open) {
        e.preventDefault()
        if (canGoBack) {
          goBack()
          return
        }
        close()
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [
    activeCommand,
    canGoBack,
    canOpenActions,
    close,
    controller,
    currentRoute.kind,
    goBack,
    open,
    openActionsFor,
  ])

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

  const openActions = useCallback(
    (def: CommandDefinition) => {
      setError(null)
      openActionsFor(def)
    },
    [openActionsFor, setError],
  )

  if (!open) {
    return (
      <>
        {renameTerminalDialog}
        {renameWorktreeDialog}
        {removeWorktreeDialog}
        {killTerminalDialog}
      </>
    )
  }

  const hasRows =
    display.mode === "search"
      ? display.list.length > 0
      : display.sections.some((section) => section.items.length > 0)

  const footerPrimaryLabel = activeCommand?.title ?? routeMeta.title ?? "Command Palette"
  const footerShowsActions =
    currentRoute.kind !== "actions" &&
    !!activeCommand &&
    canOpenActions(activeCommand)

  const layer = (
    <div
      data-ateli-command-palette-overlay
      className="pointer-events-auto fixed inset-0 z-[999999] flex items-start justify-center pt-[16vh] antialiased"
    >
      <div
        className="ateli-overlay-scrim absolute inset-0"
        onClick={() => close()}
        aria-hidden
      />
      <div
        ref={paletteRef}
        className="relative z-[1] w-full max-w-3xl px-4 sm:px-0"
      >
        <Command
          shouldFilter={false}
          role="dialog"
          aria-modal
          aria-label="Command palette"
          className="ateli-surface-luminous relative h-fit overflow-hidden rounded-[1.15rem] border border-border/35 bg-popover/95 text-popover-foreground"
          loop
        >
          <CommandInput
            value={search}
            onValueChange={(value) => {
              setSearch(value)
              setError(null)
            }}
            autoFocus
            placeholder={routeMeta.placeholder}
            leading={
              canGoBack ? (
                <button
                  type="button"
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-accent/60 hover:text-foreground active:scale-[0.96]"
                  onClick={() => goBack()}
                  aria-label="Go back"
                >
                  <ArrowLeft className="size-4" />
                </button>
              ) : null
            }
          />
          {routeMeta.title ? (
            <div className="border-b border-border/15 px-3.5 py-2.5">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                {routeMeta.title}
              </div>
              {routeMeta.subtitle ? (
                <div className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground/85">
                  {routeMeta.subtitle}
                </div>
              ) : null}
            </div>
          ) : null}
          <CommandList className="max-h-[26rem]">
            {error ? (
              <div className="ateli-skeuo-well border-b border-dashed border-amber-500/30 bg-amber-500/6 px-2.5 py-2.5 text-center text-pretty text-xs leading-relaxed text-amber-600 dark:text-amber-500/90">
                {error}
              </div>
            ) : null}
            {display.mode === "search"
              ? searchResultsList(display.list, {
                  onSelect: selectCommand,
                  onOpenActions: openActions,
                  canOpenActions,
                  heading: display.groupHeading,
                })
              : emptyQuerySections(display.sections, {
                  onSelect: selectCommand,
                  onOpenActions: openActions,
                  canOpenActions,
                })}
            {!error && !hasRows ? <CommandEmpty>No matches.</CommandEmpty> : null}
          </CommandList>
          <div className="ateli-surface-slab flex min-h-12 items-center gap-3 border-t border-border/20 px-3.5 py-2.5 text-xs">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground/95">
                {footerPrimaryLabel}
              </div>
              <div className="truncate text-muted-foreground/75">
                {currentRoute.kind === "actions"
                  ? "Choose an action for this result."
                  : activeCommand?.subtitle ?? "Enter runs the highlighted result."}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
              <span className="font-medium text-foreground/90">Run</span>
              <kbd className="rounded-md border border-border/40 bg-background/40 px-2 py-1 font-sans text-[0.7rem] text-foreground/85">
                <CornerDownLeft className="size-3.5" />
              </kbd>
              {footerShowsActions ? (
                <>
                  <div className="h-5 w-px bg-border/30" aria-hidden />
                  <span className="font-medium text-foreground/90">Actions</span>
                  <kbd className="rounded-md border border-border/40 bg-background/40 px-2 py-1 font-sans text-[0.7rem] text-foreground/85">
                    ⌘K
                  </kbd>
                </>
              ) : null}
            </div>
          </div>
        </Command>
      </div>
    </div>
  )

  return (
    <>
      {createPortal(layer, document.body)}
      {renameTerminalDialog}
      {renameWorktreeDialog}
      {removeWorktreeDialog}
      {killTerminalDialog}
    </>
  )
})

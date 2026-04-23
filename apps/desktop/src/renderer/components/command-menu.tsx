import { useCallback, useEffect, useState } from "react"
import { track, useEditor } from "tldraw"
import type { TLShapeId } from "tldraw"
import { GitBranch, PanelsTopLeft, TerminalSquare } from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import { useWorktrees } from "@/contexts/worktree-index-context"
import { addTerminalAtCenter, getRepoPath } from "@/lib/default-actions"
import { getCommandMenuActions } from "@/lib/tool-registry"
import { terminalTitleFromCwd } from "@/lib/terminal-worktree-title"
import { terminalsBelongingToWorktree } from "@/lib/worktree-terminals"

export const CommandMenu = track(function CommandMenu() {
  const editor = useEditor()
  const worktrees = useWorktrees()
  const repoPath = getRepoPath()
  const [open, setOpen] = useState(false)

  const terminalShapes = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "terminal")
  const frameShapes = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "frame")

  const mainWt = worktrees.find((w) => w.isMain)
  const wtEntries: WorktreeIndexEntry[] =
    repoPath && worktrees.length > 0
      ? [
          mainWt ?? {
            id: "",
            path: repoPath,
            branch: "main",
            head: "",
            isMain: true,
            createdAt: "",
            repoPath,
          },
          ...worktrees.filter((w) => !w.isMain),
        ]
      : []

  const focusWorktree = useCallback(
    (wt: WorktreeIndexEntry) => {
      if (!repoPath) return
      const inWt = terminalsBelongingToWorktree(
        repoPath,
        worktrees,
        wt,
        terminalShapes,
      )
      if (inWt.length > 0) {
        const validIds = inWt
          .map((s) => s.id)
          .filter((id) => !!editor.getShape(id))
        if (validIds.length === 0) {
          addTerminalAtCenter(editor, {
            cwd: wt.isMain ? repoPath : wt.path,
          })
          return
        }
        editor.setSelectedShapes(validIds)
        editor.zoomToSelection({ animation: { duration: 200 } })
        return
      }
      addTerminalAtCenter(editor, {
        cwd: wt.isMain ? repoPath : wt.path,
      })
    },
    [editor, repoPath, terminalShapes, worktrees],
  )

  const focusTerminal = useCallback(
    (id: TLShapeId) => {
      editor.select(id)
      editor.zoomToSelection({ animation: { duration: 200 } })
    },
    [editor],
  )

  const focusFrame = useCallback(
    (id: TLShapeId) => {
      editor.select(id)
      editor.zoomToSelection({ animation: { duration: 200 } })
    },
    [editor],
  )

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

  const staticActions = getCommandMenuActions()
  const hasWorktrees = wtEntries.length > 0
  const hasTerminals = terminalShapes.length > 0
  const hasFrames = frameShapes.length > 0
  const hasStatic = staticActions.length > 0

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
        <CommandInput autoFocus placeholder="Jump to worktree, terminal, frame…" />
        <CommandList className="max-h-80">
          <CommandEmpty>No matches.</CommandEmpty>

          {hasWorktrees ? (
            <CommandGroup heading="Worktrees">
              {wtEntries.map((wt) => {
                const label = wt.isMain ? "main" : wt.branch
                const inWt = repoPath
                  ? terminalsBelongingToWorktree(
                      repoPath,
                      worktrees,
                      wt,
                      terminalShapes,
                    )
                  : []
                const suffix =
                  inWt.length === 0 ? " · add terminal" : ` · ${inWt.length} terminals`
                const search = `${label} ${wt.branch} ${wt.path} worktree`
                return (
                  <CommandItem
                    key={wt.isMain ? repoPath : wt.path}
                    value={search}
                    onSelect={() => run(() => focusWorktree(wt))}
                  >
                    <GitBranch className="size-4 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">
                      {label}
                      <span className="text-muted-foreground">{suffix}</span>
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ) : null}

          {hasWorktrees && (hasTerminals || hasFrames) ? <CommandSeparator /> : null}

          {hasTerminals ? (
            <CommandGroup heading="Terminals">
              {terminalShapes.map((s) => {
                const cwd = (s.props as { cwd?: string }).cwd
                const title = terminalTitleFromCwd(
                  cwd,
                  repoPath || "",
                  worktrees,
                )
                const search = `${title} ${cwd ?? ""} terminal`
                return (
                  <CommandItem
                    key={s.id}
                    value={search}
                    onSelect={() => run(() => focusTerminal(s.id as TLShapeId))}
                  >
                    <TerminalSquare className="size-4 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ) : null}

          {hasTerminals && hasFrames ? <CommandSeparator /> : null}

          {hasFrames ? (
            <CommandGroup heading="Frames">
              {frameShapes.map((s) => {
                const name =
                  (s.props as { name?: string }).name?.trim() || "Frame"
                const search = `${name} frame`
                return (
                  <CommandItem
                    key={s.id}
                    value={search}
                    onSelect={() => run(() => focusFrame(s.id as TLShapeId))}
                  >
                    <PanelsTopLeft className="size-4 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ) : null}

          {(hasWorktrees || hasTerminals || hasFrames) && hasStatic ? (
            <CommandSeparator />
          ) : null}

          {hasStatic ? (
            <CommandGroup heading="Actions">
              {staticActions.map((action) => (
                <CommandItem
                  key={action.id}
                  value={`${action.label} action command`}
                  onSelect={() => run(() => action.execute(editor))}
                >
                  <action.icon className="size-4" />
                  {action.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </div>
  )
})

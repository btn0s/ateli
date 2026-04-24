import { useCallback, useMemo, useState } from "react"
import type { Editor } from "tldraw"
import { useValue } from "tldraw"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import { buildCommandPaletteContext } from "./context"
import { runCommand } from "./execute"
import { createNewTerminalPickCommands } from "./providers/new-terminal-pick"
import { createNewWorktreeSourceCommands } from "./providers/new-worktree-source"
import { createCanvasActionCommands } from "./providers/canvas-actions"
import { createNavigationCommands } from "./providers/navigation"
import { createStaticRegistryCommands } from "./providers/static-registry"
import { recordCommandUse, resolveRecentCommands } from "./recency"
import { bucketEmptyQuery, scoreCommands } from "./search"
import type { CommandDefinition, CommandExecutionContext } from "./types"

const UNAVAILABLE = "This command is no longer available here."

export type PaletteSubflow = "new-terminal" | "new-worktree"

function buildCommands(
  env: { onUnavailable: (m: string) => void; editor: Editor; worktrees: WorktreeIndexEntry[] },
): CommandDefinition[] {
  return [
    ...createStaticRegistryCommands(),
    ...createCanvasActionCommands(),
    ...createNavigationCommands({
      onUnavailable: env.onUnavailable,
      editor: env.editor,
      worktrees: env.worktrees,
    }),
  ]
}

function definitionsMap(defs: CommandDefinition[]) {
  return new Map(defs.map((d) => [d.id, d] as const))
}

export function useCommandPalette(
  editor: Editor,
  worktrees: WorktreeIndexEntry[],
) {
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [paletteSubflow, setPaletteSubflow] = useState<PaletteSubflow | null>(
    null,
  )

  const onUnavailable = useCallback((message: string) => {
    setError(message || UNAVAILABLE)
  }, [])

  const clearPaletteSubflow = useCallback(() => setPaletteSubflow(null), [])

  const palette = useValue(
    "command-palette-ctx",
    () => buildCommandPaletteContext(editor, worktrees),
    [editor, worktrees],
  )

  const allCommands = useValue(
    "command-palette-cmds",
    () => buildCommands({ onUnavailable, editor, worktrees }),
    [editor, worktrees, onUnavailable],
  )

  const allCommandsPatched = useMemo((): CommandDefinition[] => {
    return allCommands.map((d) => {
      if (d.id === "tool:add-terminal") {
        return {
          ...d,
          run: () => {
            setError(null)
            setPaletteSubflow("new-terminal")
            return "continue" as const
          },
        }
      }
      if (d.id === "tool:add-worktree") {
        return {
          ...d,
          run: () => {
            setError(null)
            setPaletteSubflow("new-worktree")
            return "continue" as const
          },
        }
      }
      return d
    })
  }, [allCommands, setError])

  const newTerminalPickCommands = useMemo(
    () => createNewTerminalPickCommands({ onUnavailable, worktrees }),
    [onUnavailable, palette.repoPath, worktrees],
  )

  const newWorktreeSourceCommands = useMemo(
    () => createNewWorktreeSourceCommands({ onUnavailable, worktrees }),
    [onUnavailable, palette.repoPath, worktrees],
  )

  const listForScore = useMemo((): CommandDefinition[] => {
    if (paletteSubflow === "new-terminal") {
      return newTerminalPickCommands
    }
    if (paletteSubflow === "new-worktree") {
      return newWorktreeSourceCommands
    }
    return allCommandsPatched
  }, [
    allCommandsPatched,
    newTerminalPickCommands,
    newWorktreeSourceCommands,
    paletteSubflow,
  ])

  const exec: CommandExecutionContext = useMemo(
    () => ({ editor, palette }),
    [editor, palette],
  )

  const defMap = useMemo(
    () => definitionsMap(allCommandsPatched),
    [allCommandsPatched],
  )

  const q = search.trim()
  const scored = useMemo(
    () => scoreCommands(listForScore, exec, q),
    [listForScore, exec, q],
  )

  const recent = useMemo(() => {
    if (paletteSubflow) {
      return [] as CommandDefinition[]
    }
    return resolveRecentCommands(palette.repoPath, defMap, 8).filter((d) =>
      d.when(exec)
    )
  }, [defMap, exec, palette.repoPath, paletteSubflow])

  const emptySections = useMemo(
    () =>
      paletteSubflow || q
        ? null
        : bucketEmptyQuery(scored, recent),
    [paletteSubflow, q, recent, scored],
  )

  const run = useCallback(
    async (def: CommandDefinition): Promise<boolean | "continue"> => {
      setError(null)
      const freshCtx: CommandExecutionContext = {
        editor,
        palette: buildCommandPaletteContext(editor, worktrees),
      }
      const ok = await runCommand(def, freshCtx, onUnavailable)
      if (ok === true) {
        recordCommandUse(freshCtx.palette.repoPath, def.id)
      }
      return ok
    },
    [editor, onUnavailable, worktrees],
  )

  const display = useMemo(() => {
    if (paletteSubflow) {
      return { mode: "search" as const, list: scored.map((s) => s.def) }
    }
    if (q.length > 0) {
      return { mode: "search" as const, list: scored.map((s) => s.def) }
    }
    return { mode: "empty" as const, sections: emptySections ?? [] }
  }, [emptySections, paletteSubflow, q, scored])

  return {
    search,
    setSearch,
    error,
    setError,
    run,
    paletteSubflow,
    setPaletteSubflow,
    clearPaletteSubflow,
    display,
  }
}

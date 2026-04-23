import { useCallback, useMemo, useState } from "react"
import type { Editor } from "tldraw"
import { useValue } from "tldraw"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import { buildCommandPaletteContext } from "./context"
import { runCommand } from "./execute"
import { createCanvasActionCommands } from "./providers/canvas-actions"
import { createNavigationCommands } from "./providers/navigation"
import { createStaticRegistryCommands } from "./providers/static-registry"
import { recordCommandUse, resolveRecentCommands } from "./recency"
import { bucketEmptyQuery, scoreCommands } from "./search"
import type { CommandDefinition, CommandExecutionContext } from "./types"

const UNAVAILABLE = "This command is no longer available here."

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

  const onUnavailable = useCallback((message: string) => {
    setError(message || UNAVAILABLE)
  }, [])

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

  const exec: CommandExecutionContext = useMemo(
    () => ({ editor, palette }),
    [editor, palette],
  )

  const defMap = useMemo(() => definitionsMap(allCommands), [allCommands])

  const q = search.trim()
  const scored = useMemo(
    () => scoreCommands(allCommands, exec, q),
    [allCommands, exec, q],
  )

  const recent = useMemo(
    () => resolveRecentCommands(palette.repoPath, defMap, 8),
    [palette.repoPath, defMap],
  )

  const emptySections = useMemo(
    () => (q ? null : bucketEmptyQuery(scored, recent)),
    [q, scored, recent],
  )

  const run = useCallback(
    async (def: CommandDefinition): Promise<boolean> => {
      setError(null)
      const freshCtx: CommandExecutionContext = {
        editor,
        palette: buildCommandPaletteContext(editor, worktrees),
      }
      const ok = await runCommand(def, freshCtx, onUnavailable)
      if (ok) recordCommandUse(freshCtx.palette.repoPath, def.id)
      return ok
    },
    [editor, onUnavailable, worktrees],
  )

  return {
    search,
    setSearch,
    error,
    setError,
    run,
    display:
      q.length > 0
        ? { mode: "search" as const, list: scored.map((s) => s.def) }
        : { mode: "empty" as const, sections: emptySections ?? [] },
  }
}

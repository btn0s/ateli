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
import { createSelectionActionCommands } from "./providers/selection-actions"
import { createStaticRegistryCommands } from "./providers/static-registry"
import { recordCommandUse, resolveRecentCommands } from "./recency"
import { scoreCommands } from "./search"
import type {
  CommandDefinition,
  CommandExecutionContext,
  PaletteRoute,
} from "./types"
import {
  paletteDisplayForRoute,
  paletteRouteKey,
  paletteRouteMeta,
  ROOT_ROUTE,
} from "./view-state"
import type { ManagementPolicy } from "@/contexts/management-policy-context"
import type { TerminalRenameRequest } from "@/components/terminal-rename-dialog"
import type { WorktreeRenameRequest } from "@/components/worktree-rename-dialog"
import type { WorktreeRemoveRequest } from "@/components/worktree-remove-dialog"

const UNAVAILABLE = "This command is no longer available here."

function buildCommands(
  env: {
    onUnavailable: (m: string) => void
    editor: Editor
    repoPath: string
    worktrees: WorktreeIndexEntry[]
    policy: ManagementPolicy["user"]
    requestRenameTerminal: (request: TerminalRenameRequest) => void
    requestRenameWorktree: (request: WorktreeRenameRequest) => void
    requestRemoveWorktrees: (requests: readonly WorktreeRemoveRequest[]) => void
    requestKillSession: (request: { sessionId: string }) => void
  },
): CommandDefinition[] {
  return [
    ...createStaticRegistryCommands(env.worktrees),
    ...createSelectionActionCommands({
      worktrees: env.worktrees,
      policy: env.policy,
      requestRenameTerminal: env.requestRenameTerminal,
      requestRenameWorktree: env.requestRenameWorktree,
      requestRemoveWorktrees: env.requestRemoveWorktrees,
      requestKillSession: env.requestKillSession,
    }),
    ...createCanvasActionCommands(),
    ...createNavigationCommands({
      onUnavailable: env.onUnavailable,
      editor: env.editor,
      repoPath: env.repoPath,
      worktrees: env.worktrees,
      policy: env.policy,
      requestRenameTerminal: env.requestRenameTerminal,
      requestRenameWorktree: env.requestRenameWorktree,
      requestRemoveWorktrees: env.requestRemoveWorktrees,
      requestKillSession: env.requestKillSession,
    }),
  ]
}

function definitionsMap(defs: CommandDefinition[]) {
  return new Map(defs.map((d) => [d.id, d] as const))
}

export function useCommandPalette(
  editor: Editor,
  repoPath: string,
  worktrees: WorktreeIndexEntry[],
  env: {
    policy: ManagementPolicy["user"]
    requestRenameTerminal: (request: TerminalRenameRequest) => void
    requestRenameWorktree: (request: WorktreeRenameRequest) => void
    requestRemoveWorktrees: (requests: readonly WorktreeRemoveRequest[]) => void
    requestKillSession: (request: { sessionId: string }) => void
  },
) {
  const [searchByRoute, setSearchByRoute] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [routeStack, setRouteStack] = useState<PaletteRoute[]>([ROOT_ROUTE])

  const onUnavailable = useCallback((message: string) => {
    setError(message || UNAVAILABLE)
  }, [])

  const currentRoute = routeStack[routeStack.length - 1] ?? ROOT_ROUTE
  const currentRouteKey = paletteRouteKey(currentRoute)
  const search = searchByRoute[currentRouteKey] ?? ""

  const setSearch = useCallback(
    (value: string) => {
      setSearchByRoute((prev) => ({
        ...prev,
        [currentRouteKey]: value,
      }))
    },
    [currentRouteKey],
  )

  const ensureRouteSearch = useCallback((route: PaletteRoute) => {
    const key = paletteRouteKey(route)
    setSearchByRoute((prev) =>
      key in prev
        ? prev
        : {
            ...prev,
            [key]: "",
          },
    )
  }, [])

  const pushRoute = useCallback(
    (route: PaletteRoute) => {
      setError(null)
      ensureRouteSearch(route)
      setRouteStack((prev) => [...prev, route])
    },
    [ensureRouteSearch],
  )

  const openRoute = useCallback(
    (route: PaletteRoute) => {
      setError(null)
      ensureRouteSearch(ROOT_ROUTE)
      ensureRouteSearch(route)
      setRouteStack(route.kind === "root" ? [ROOT_ROUTE] : [ROOT_ROUTE, route])
    },
    [ensureRouteSearch],
  )

  const goBack = useCallback(() => {
    setError(null)
    setRouteStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }, [])

  const resetToRoot = useCallback(() => {
    setError(null)
    setRouteStack([ROOT_ROUTE])
    setSearchByRoute({ [paletteRouteKey(ROOT_ROUTE)]: "" })
  }, [])

  const palette = useValue(
    "command-palette-ctx",
    () => buildCommandPaletteContext(editor, repoPath, worktrees),
    [editor, repoPath, worktrees],
  )

  const allCommands = useValue(
    "command-palette-cmds",
    () => buildCommands({ onUnavailable, editor, repoPath, worktrees, ...env }),
    [editor, env, repoPath, worktrees, onUnavailable],
  )

  const exec: CommandExecutionContext = useMemo(
    () => ({ editor, palette }),
    [editor, palette],
  )

  const getActionsFor = useCallback(
    (def: CommandDefinition): CommandDefinition[] => def.actions?.(exec) ?? [],
    [exec],
  )

  const newTerminalPickCommands = useMemo(
    () => createNewTerminalPickCommands({ onUnavailable, repoPath, worktrees }),
    [onUnavailable, repoPath, worktrees],
  )

  const newWorktreeSourceCommands = useMemo(
    () => createNewWorktreeSourceCommands({ onUnavailable, repoPath, worktrees }),
    [onUnavailable, repoPath, worktrees],
  )

  const routeCommands = useMemo((): CommandDefinition[] => {
    switch (currentRoute.kind) {
      case "root":
        return allCommands
      case "new-terminal":
        return newTerminalPickCommands
      case "new-worktree":
        return newWorktreeSourceCommands
      case "actions":
        return currentRoute.actions
    }
  }, [
    allCommands,
    currentRoute,
    newTerminalPickCommands,
    newWorktreeSourceCommands,
  ])

  const defMap = useMemo(() => definitionsMap(allCommands), [allCommands])

  const q = search.trim()
  const scored = useMemo(
    () => scoreCommands(routeCommands, exec, q),
    [routeCommands, exec, q],
  )

  const recent = useMemo(() => {
    if (currentRoute.kind !== "root") {
      return [] as CommandDefinition[]
    }
    return resolveRecentCommands(palette.repoPath, defMap, 8).filter((d) =>
      d.when(exec),
    )
  }, [currentRoute.kind, defMap, exec, palette.repoPath])

  const display = useMemo(
    () =>
      paletteDisplayForRoute({
        route: currentRoute,
        query: q,
        scored,
        recent,
      }),
    [currentRoute, q, recent, scored],
  )

  const run = useCallback(
    async (def: CommandDefinition): Promise<boolean | "continue"> => {
      setError(null)
      if (def.push) {
        pushRoute(def.push)
        return "continue"
      }
      const freshCtx: CommandExecutionContext = {
        editor,
        palette: buildCommandPaletteContext(editor, repoPath, worktrees),
      }
      const ok = await runCommand(def, freshCtx, onUnavailable)
      if (ok === true) {
        recordCommandUse(freshCtx.palette.repoPath, def.id)
      }
      return ok
    },
    [editor, onUnavailable, pushRoute, repoPath, worktrees],
  )

  const openActionsFor = useCallback(
    (def: CommandDefinition) => {
      const actions = getActionsFor(def)
      if (actions.length === 0) {
        return false
      }
      pushRoute({
        kind: "actions",
        sourceId: def.id,
        sourceTitle: def.title,
        sourceSubtitle: def.subtitle,
        actions,
      })
      return true
    },
    [getActionsFor, pushRoute],
  )

  return {
    search,
    setSearch,
    error,
    setError,
    run,
    display,
    currentRoute,
    routeMeta: paletteRouteMeta(currentRoute),
    canGoBack: routeStack.length > 1,
    goBack,
    resetToRoot,
    openRoute,
    openActionsFor,
    canOpenActions: (def: CommandDefinition) => getActionsFor(def).length > 0,
  }
}

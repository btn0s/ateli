import { bucketEmptyQuery } from "./search"
import type {
  CommandDefinition,
  PaletteDisplay,
  PaletteRoute,
  ScoredCommand,
} from "./types"

export const ROOT_ROUTE: PaletteRoute = { kind: "root" }

export function paletteRouteKey(route: PaletteRoute): string {
  switch (route.kind) {
    case "root":
      return "root"
    case "new-terminal":
      return "new-terminal"
    case "new-worktree":
      return "new-worktree"
    case "actions":
      return `actions:${route.sourceId}`
  }
}

export function paletteRouteMeta(route: PaletteRoute): {
  title?: string
  subtitle?: string
  placeholder: string
  groupHeading: string
} {
  switch (route.kind) {
    case "root":
      return {
        placeholder: "Run a command, jump to a worktree, terminal, or frame…",
        groupHeading: "Results",
      }
    case "new-terminal":
      return {
        title: "New Terminal",
        subtitle: "Choose a working folder for the new terminal.",
        placeholder: "Filter folders, or find “new worktree” to create one…",
        groupHeading: "Working folder",
      }
    case "new-worktree":
      return {
        title: "New Worktree",
        subtitle: "Choose how the new worktree should start.",
        placeholder: "Choose how to start the new worktree…",
        groupHeading: "Start from",
      }
    case "actions":
      return {
        title: route.sourceTitle,
        subtitle: route.sourceSubtitle,
        placeholder: `Search actions for ${route.sourceTitle}…`,
        groupHeading: "Actions",
      }
  }
}

export function paletteDisplayForRoute(args: {
  route: PaletteRoute
  query: string
  scored: ScoredCommand[]
  recent: CommandDefinition[]
}): PaletteDisplay {
  const { route, query, scored, recent } = args
  if (route.kind === "root" && query.length === 0) {
    return {
      mode: "empty",
      sections: bucketEmptyQuery(scored, recent),
    }
  }
  return {
    mode: "search",
    list: scored.map((s) => s.def),
    groupHeading: paletteRouteMeta(route).groupHeading,
  }
}

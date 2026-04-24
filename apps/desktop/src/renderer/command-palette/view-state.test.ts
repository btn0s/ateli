import { Command as CommandIcon } from "lucide-react"
import { describe, expect, it } from "vitest"
import type { CommandDefinition, ScoredCommand } from "./types"
import {
  paletteDisplayForRoute,
  paletteRouteKey,
  paletteRouteMeta,
  ROOT_ROUTE,
} from "./view-state"

function makeDef(
  id: string,
  partial?: Partial<CommandDefinition>,
): CommandDefinition {
  return {
    id,
    title: id,
    icon: CommandIcon,
    keywords: [id],
    group: "action",
    emptyQuerySection: "actions",
    when: () => true,
    run: () => {},
    ...partial,
  }
}

function makeScored(def: CommandDefinition): ScoredCommand {
  return {
    def,
    textScore: 1,
    contextScore: 0,
    recencyScore: 0,
    band: 0,
    sortKey: def.id,
  }
}

describe("paletteRouteKey", () => {
  it("uses stable keys for root and actions routes", () => {
    expect(paletteRouteKey(ROOT_ROUTE)).toBe("root")
    expect(
      paletteRouteKey({
        kind: "actions",
        sourceId: "terminal-focus:1",
        sourceTitle: "Main Terminal",
        actions: [],
      }),
    ).toBe("actions:terminal-focus:1")
  })
})

describe("paletteRouteMeta", () => {
  it("returns route-specific headings and placeholders", () => {
    expect(paletteRouteMeta(ROOT_ROUTE).groupHeading).toBe("Results")
    expect(
      paletteRouteMeta({ kind: "new-terminal" }).placeholder,
    ).toContain("Filter folders")
    expect(
      paletteRouteMeta({
        kind: "actions",
        sourceId: "x",
        sourceTitle: "Arc",
        actions: [],
      }).title,
    ).toBe("Arc")
  })
})

describe("paletteDisplayForRoute", () => {
  it("keeps the root route in empty-section mode when the query is empty", () => {
    const recent = makeDef("recent", {
      group: "action",
      emptyQuerySection: "actions",
    })
    const suggested = makeDef("suggested", {
      group: "create",
      emptyQuerySection: "suggested",
    })

    const display = paletteDisplayForRoute({
      route: ROOT_ROUTE,
      query: "",
      scored: [makeScored(suggested)],
      recent: [recent],
    })

    expect(display.mode).toBe("empty")
    if (display.mode !== "empty") {
      throw new Error("expected empty display")
    }
    expect(display.sections.map((section) => section.section)).toEqual([
      "Recent",
      "Suggested",
    ])
  })

  it("forces subviews into search mode even without a query", () => {
    const action = makeDef("action-1")
    const display = paletteDisplayForRoute({
      route: {
        kind: "actions",
        sourceId: "arc",
        sourceTitle: "Arc",
        actions: [action],
      },
      query: "",
      scored: [makeScored(action)],
      recent: [],
    })

    expect(display).toEqual({
      mode: "search",
      list: [action],
      groupHeading: "Actions",
    })
  })
})

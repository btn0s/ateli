# Command Palette Overhaul (Linear + Raycast style)

## Goal

Replace the current `CommandMenu` with a full command platform and make command definitions the canonical source for all command surfaces:

- comprehensive: all major app actions and navigation targets are available
- contextual: commands adapt to selection / panel / focus state
- searchable: high quality fuzzy ranking with recency and context boosts
- predictable: same command always behaves the same in the same context
- unified: palette, toolbar, and context menu consume the same action contract

## Current state (baseline)

- `apps/desktop/src/renderer/components/command-menu.tsx` mixes UI + command derivation.
- Sources are limited to worktrees, terminal/frame shapes, and static registry actions.
- Current action registry is shared by multiple surfaces (`tool-registry` -> toolbar, command menu, context menu), which risks divergence during migration.
- No unified command model, no provider architecture, no ranking spec, no recency spec.
- `zoomToSelection` in tldraw has dual behavior depending on zoom level (fit vs targetZoom=1), which creates non-deterministic feel.

## UX target

Single palette with:

- Search input at top, grouped results (Suggested / Navigation / Actions / Recent).
- Context badges (`Selection`, `Terminal`, `Worktree`, etc.).
- Right-side shortcut hints where available.
- Deterministic enter behavior.
- `Tab` or `→` opens command detail/sub-actions (Raycast style).
- `Cmd+Enter` runs alternate behavior when defined.

## Architecture

Create a dedicated module:

- `apps/desktop/src/renderer/command-palette/types.ts`
- `apps/desktop/src/renderer/command-palette/context.ts`
- `apps/desktop/src/renderer/command-palette/providers/*`
- `apps/desktop/src/renderer/command-palette/search.ts`
- `apps/desktop/src/renderer/command-palette/use-command-palette.ts`
- `apps/desktop/src/renderer/command-palette/CommandPalette.tsx`

Also add a shared action bridge so non-palette surfaces can consume the same canonical command/action definitions:

- `apps/desktop/src/renderer/command-palette/surfaces/*`

## Command model

Use a typed command definition:

- `id`
- `title`
- `subtitle?`
- `icon?`
- `keywords[]` (aliases/synonyms)
- `group` (`navigation`, `create`, `terminal`, `worktree`, `canvas`, etc.)
- `when(ctx) => boolean` (availability)
- `score?(ctx) => number` (contextual boost)
- `run(ctx) => void | Promise<void>`
- `children?(ctx)` for sub-actions
- `shortcut?`
- `mutatesState?: boolean`
- `confirm?: { title: string; body?: string }`
- `alternateRun?(ctx) => void | Promise<void>`

## Context model

Build one snapshot per render/open for filtering, grouping, and ranking:

- canvas selection: none / single / multi, selected shape types, selected ids
- camera + viewport
- worktrees and main worktree
- terminal sessions + active terminal relationships
- diff tab state (`canvasSelected`, active tab, tabs)
- focus state (canvas vs center panel intent)
- capability state (api availability, loading/error/degraded flags)

Execution rule:

- use snapshot for display and ranking
- re-resolve targets and revalidate availability at execute time
- if invalid at execute time, show deterministic “command no longer available” feedback

## Providers (v1)

1. `navigation-provider`
- focus terminal/frame/worktree
- jump to active diff tab/canvas

2. `canvas-actions-provider`
- add terminal, add worktree, zoom controls (fit/selection/reset/in/out)
- selection-sensitive actions (delete, duplicate, frame selection, etc. as they become available)

3. `terminal-provider`
- v1 read-only/navigation commands only
- mutating commands (`kill`, `rename`, etc.) after execution lifecycle and confirmation support are in place

4. `worktree-provider`
- v1 read-only/navigation commands only
- mutating commands (`create`, `rename`, `remove`) in later phase with safeguards

5. `static-registry-provider`
- adapter for existing `tool-registry` actions (migration bridge)

## Search and ranking

Ranking contract (deterministic):

- text score: prefix > word-boundary > fuzzy > substring
- context boost: selected-shape-compatible commands rank higher
- recency boost: recently executed commands rank higher
- group bias: `Suggested` commands first for empty query
- dedupe key: `id`
- tie-breakers: text score desc, context score desc, recency desc, stable lexical `id`
- fixed score bands per source/provider to avoid accidental reorder drift

Behavior:

- Empty query: show `Recent` + strong contextual suggestions.
- Query entered: global ranked list grouped by category.

Recency store spec:

- versioned schema
- scoped by repo/workspace
- capped history with eviction
- resilient to command rename/delete

## Determinism rules

- Commands must not branch on implicit zoom modes (avoid raw `zoomToSelection` for primary action).
- For selection-centric zoom, use explicit bounded camera math with controlled target zoom.
- Command visibility/ranking uses snapshot `ctx`; command execution revalidates live state.

## Rollout phases

### Phase 1: Contract + Safety Baseline

- Define canonical command schema for palette + toolbar + context menu.
- Define execution lifecycle: availability recheck, confirmation, pending/error handling.
- Define ranking spec: score bands, tie-breakers, dedupe, grouping.
- Build parity inventory matrix for existing commands, shortcuts, labels, behavior.
- Add telemetry/perf metrics and acceptance thresholds up front.

### Phase 2: Engine in Shadow Mode

- Implement provider composition, ranking engine, recency store, registry adapter.
- Dual-run old and new command derivation in debug/shadow mode.
- Add parity comparison checks and ranking golden tests.

### Phase 3: Flagged UI Rollout (Read-only First)

- Ship new palette UI behind flag.
- Start with navigation/read-only/contextual commands.
- Enforce phase gate: telemetry healthy, perf budget met, parity inventory pass.

### Phase 4: Mutating Commands + Raycast-style Expansion

- Add mutating terminal/worktree/canvas commands with confirm/error/undo where applicable.
- Add command detail/sub-actions panel.
- Add better metadata (subtitle, source, badges, shortcut chips).
- Add keyboard affordances (`Tab`, `Cmd+Enter`, back navigation).

### Phase 5: Surface Unification + Cleanup

- Migrate toolbar/context menu to canonical command/action definitions.
- Remove legacy duplicate action logic.
- Keep telemetry, perf, and regression suites as release blockers.

## Testing strategy

1. Unit tests
- provider output for key contexts
- `when` + ranking determinism (including tie-break rules)
- recency persistence and boost
- execution revalidation behavior

2. Integration tests
- keyboard open/close
- search result ordering
- run command and close palette behavior
- stale-context execution fallback (`command no longer available`)

3. Regression tests
- command parity with legacy menu items
- parity with toolbar/context menu behavior for shared actions
- selection-context command visibility

## Acceptance criteria

- All current command menu items exist in new palette.
- Shared actions resolve from one canonical command/action definition.
- New palette exposes additional contextual actions beyond parity.
- Search relevance is stable and deterministic.
- Zoom-related commands behave consistently (no dual-mode surprises).
- Telemetry and perf gates are met before broad rollout.
- Legacy command system can be removed after parity + telemetry confidence across all command surfaces.

## Suggested first tickets

1. Define canonical command schema and execution lifecycle contract.
2. Produce parity matrix for existing palette/toolbar/context-menu actions.
3. Implement context snapshot builder + live execution revalidation utility.
4. Implement provider composer + registry adapter in shadow mode.
5. Implement deterministic ranking engine (tie-breakers, dedupe, score bands).
6. Implement scoped/versioned recency store.
7. Ship flagged read-only palette UI with telemetry + perf gates.
8. Add mutating commands with confirm/error/undo semantics.
9. Migrate toolbar/context menu to canonical command definitions and remove legacy duplicates.

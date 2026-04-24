# Layout Engine for Terminal Creation — Design

**Date:** 2026-04-24
**Branch:** btn0s/layout-engine
**Status:** Spec — awaiting user review

## Problem

`addTerminalAtCenter()` (`apps/desktop/src/renderer/lib/default-actions.ts`) drops every new terminal at viewport-center minus an offset. That means:

- New terminals overlap existing ones.
- Terminals for the same worktree scatter randomly instead of staying near their siblings.
- Users have no one-click way to tidy a messy area.

## Goals

1. New terminals never overlap an existing shape.
2. New terminals prefer to appear near existing terminals for the same worktree, weighted by spatial cluster composition and recency.
3. If no similar neighborhood exists, new terminals land in open space between existing clusters.
4. An **Organize** action, reachable from the command palette and right-click menu, repacks a selection (or the cluster around a single selected terminal) into a neat grid.

## Non-goals

- No auto-reflow on delete or move — clusters stay where the user leaves them.
- No cluster chrome on canvas (borders, labels, group shapes). Clusters are derived, not persisted.
- No cross-page awareness.
- No snapping or grid affordance during manual drag. Only `create` and `organize` touch the engine.
- No animated travel into position.
- No extension to non-terminal shapes in this pass. The API is shaped generically so files / notes can opt in later.

## Architecture

One new, pure-functional module scoped to the renderer:

```
apps/desktop/src/renderer/lib/layout/
  index.ts          // public API: placeTerminal(), organizeShapes()
  clusters.ts       // detectClusters(shapes) → Cluster[]
  placement.ts      // pickAnchor(), spiralSearch()
  geometry.ts       // Rect helpers: overlap, inflate, snap
  weight.ts         // scoreCluster(cluster, worktreePath, now)
  constants.ts      // GUTTER, CLUSTER_GAP, SPIRAL_STEP, RECENCY_*
```

Internals are pure functions over snapshots. All `editor.*` side effects (createShape, updateShapes) live in the thin call sites that invoke the module.

### Constants

```ts
GUTTER            = 24    // min empty px between any two shapes
CLUSTER_GAP       = 120   // proximity threshold for single-link clustering
SPIRAL_STEP       = 40    // search step size; also the placement snap
RECENCY_HALF_LIFE = 1000 * 60 * 60 * 4   // 4 hours
RECENCY_LAMBDA    = 0.5   // recency multiplier cap → weight *= 1..1.5
MAX_SPIRAL_ITERS  = 400
```

All tunable in one file.

## Data model

No terminal-shape schema changes. Clustering is derived at call time from `editor.getCurrentPageShapes()` filtered to `type === "terminal"`.

One additive field: `meta.lastUsedAt: number` on each terminal shape. Tldraw `meta` is first-class, no migration needed. Updated on focus or input in the xterm pane. Absence is treated as `0`. Consumed only by `weight.ts`.

## Types

```ts
type Rect = { x: number; y: number; w: number; h: number };

type Cluster = {
  shapes: TerminalShape[];
  bounds: Rect;               // tight bbox of members
  centroid: { x: number; y: number };
  composition: Map<string, number>;   // worktreePath → count
  lastUsedAt: number;         // max meta.lastUsedAt across members
};
```

`worktreePath` is resolved from a terminal's `cwd` by the existing `findWorktreeForCwd()` helper in `apps/desktop/src/renderer/lib/terminal-worktree-title.ts`. Terminals whose `cwd` matches no known worktree contribute to cluster membership but not to any worktree's composition.

## Algorithm

### 1. detectClusters(shapes) → Cluster[]

Single-link agglomerative clustering:

1. Inflate each shape's page bounds by `CLUSTER_GAP / 2` on all sides.
2. For every pair of shapes whose inflated bounds intersect, union-find merge.
3. Each connected component becomes a `Cluster` with its bbox, centroid, composition map, and `lastUsedAt`.

Cost is O(n²) over terminals on the page. Acceptable at the scale we care about (tens of terminals, not thousands).

### 2. scoreCluster(cluster, worktreePath, now) → number

```
countX       = cluster.composition.get(worktreePath) ?? 0
if countX === 0 → return 0          // cluster is irrelevant for this worktree
purity       = countX / cluster.shapes.length
decay        = exp(-ln2 * (now - cluster.lastUsedAt) / RECENCY_HALF_LIFE)
recencyBoost = 1 + RECENCY_LAMBDA * decay
score        = countX * purity * recencyBoost
```

Worked example: a 3-terminal pure-X cluster scores 3.0; a 5-terminal cluster that is 40% X scores 2.0. Recency can lift a score by up to 50%, never enough to flip a clear purity win.

### 3. pickAnchor(clusters, worktreePath, viewport, now) → { x: number, y: number }

1. Score all clusters; keep those with `countX > 0`.
2. If any, take the **max-score** cluster. Anchor = centroid of that cluster's X-members only — for a mixed cluster we hug the familiar members rather than the cluster's geometric center.
3. Else, find the largest empty rectangle inside the viewport that sits at least `GUTTER` px from every cluster's bbox. Anchor = its center.
4. Else, fall back to `viewport.center - (size.w / 2, size.h / 2)` (today's behavior).

"Largest empty rectangle" uses a simple sweep over axis-aligned gaps between cluster bboxes and viewport edges — good enough without pulling in a real MER algorithm.

### 4. spiralSearch(anchor, size, obstacles) → { x: number, y: number }

Archimedean spiral, sampled at `SPIRAL_STEP` increments. For each candidate `(x, y)`:

1. Build the new rect and inflate by `GUTTER`.
2. Check AABB overlap against every obstacle rect.
3. First miss wins; snap to the `SPIRAL_STEP` grid.

Capped at `MAX_SPIRAL_ITERS`. If the cap is hit, fall through to a linear sweep along `+x` from the anchor until a free slot is found (theoretical guarantee; infinite canvas).

## Public API

```ts
// lib/layout/index.ts

export function placeTerminal(
  editor: Editor,
  opts: { worktreePath: string; size: { w: number; h: number } }
): { x: number; y: number };

export function organizeShapes(
  editor: Editor,
  shapeIds: TLShapeId[]
): void; // applies editor.updateShapes in a single transaction
```

Both are side-effect-free over pure inputs internally; `placeTerminal` reads from `editor` but does not mutate. `organizeShapes` is the one mutating helper.

## Call sites

Three, all thin:

### addTerminalAtCenter → addTerminalForWorktree

`apps/desktop/src/renderer/lib/default-actions.ts`. Replace the hard-coded center math with:

```ts
const worktreePath = findWorktreeForCwd(cwd, worktreeIndex)?.path ?? cwd;
const { x, y } = placeTerminal(editor, { worktreePath, size: { w: 600, h: 400 } });
editor.createShape({ id, type: "terminal", x, y, props: { w: 600, h: 400, cwd } });
```

`findWorktreeForCwd` already exists at `apps/desktop/src/renderer/lib/terminal-worktree-title.ts`.

### RPC canvas.createTerminal

`apps/desktop/src/main/rpc.ts:241`. When the caller passes explicit `x, y`, honor them (scripts and automation own placement). When only `cwd` is given, the main-side RPC forwards an `{ action: "create-terminal", cwd }` message to the renderer over the existing IPC channel; the renderer runs `placeTerminal()` and `editor.createShape()`, then returns the new shape id back through the RPC reply. No algorithm logic lives in the main process — keeps the layout engine renderer-only and consistent with today's shape-creation flow.

### Command palette "new terminal"

`apps/desktop/src/renderer/command-palette/providers/new-terminal-pick.ts` already funnels through `addTerminalAtCenter`. It picks up the new placement automatically.

## Organize action

Register one new `ToolAction` in `apps/desktop/src/renderer/lib/default-actions.ts`:

```ts
{
  id: "organize-selection",
  label: "Organize",
  showInCommandMenu: true,
  showInContextMenu: true,
  when: (ctx) => hasOrganizableSelection(ctx),
  execute: (ctx) => organizeShapes(ctx.editor, resolveTargets(ctx)),
}
```

`resolveTargets`:
- If ≥ 2 terminal shapes are selected, target = selection.
- If exactly 1 terminal is selected, target = that terminal's detected cluster (auto-expand). This is the "select group → organize" affordance without needing a dedicated cluster-select UI.
- Else, action is disabled (`when` returns false).

`organizeShapes` behavior:

1. Compute tight bbox of targets.
2. `cols = round(sqrt(n))`, biased up by 1 when viewport aspect > 1.3 so wide screens prefer wider grids.
3. Cell size = `max(w) + GUTTER` × `max(h) + GUTTER` across the targets.
4. Preserve bbox top-left; lay out in row-major order sorted by existing `(y, x)` to keep rough original ordering.
5. One `editor.updateShapes()` call → single undo step.

Reachability:
- Command palette: type "organize", appears when `when` is true.
- Right-click menu: "Organize" item in the existing `getContextMenuActions()` path.

## Error handling

- Empty page / no obstacles: `pickAnchor` falls through to viewport center; `spiralSearch` returns the anchor itself after one iteration.
- Degenerate clusters (single shape): still a valid cluster with composition count 1; scored normally.
- Zero-sized shapes or NaN coordinates: guarded at module entry by a `sanitizeShape` step; dropped from obstacle list with a `console.warn`. Unlikely in practice — tldraw validates on insert — but cheap insurance.
- Spiral cap hit: fall through to linear `+x` sweep. Always terminates.

## Testing

All layout internals are pure functions over JSON-shaped inputs. Targets:

- `clusters.test.ts` — fixture shapes in, expected cluster composition out. Cover: disjoint singletons, chain-merge via single-link, inflated-gap edge cases, mixed worktrees.
- `weight.test.ts` — purity wins over raw count; recency boost capped; zero-count returns 0.
- `placement.test.ts` — pickAnchor picks X-centroid over cluster centroid for mixed clusters; falls back to free space; falls back to viewport center.
- `spiral.test.ts` — finds free slot near occupied anchor; honors gutter; terminates at cap.
- `organize.test.ts` — grid layout preserves ordering and top-left; respects viewport-aspect bias.

No E2E added — call sites are thin and would only re-test the algorithm. Existing manual smoke (create a few terminals from the palette) covers integration.

## Rollout

Single branch, single PR. No feature flag — behavior change is contained to terminal creation and a new menu item. Old placement continues to work if the module is bypassed (RPC callers passing explicit `x, y`).

## Open questions

- Should new terminal size inherit from the nearest cluster member (`w`/`h`) instead of a constant `600×400`? Leaning yes — low cost, matches user intent. Flagged for the plan phase.
- Should `meta.lastUsedAt` also bump on RPC-driven writes (agent output)? Default yes — any activity counts as "used".

# Terminal Layout Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place new terminals with cluster awareness — never overlap, hug same-worktree siblings weighted by cluster composition and recency, and add an Organize action that repacks a selection into a tidy grid.

**Architecture:** A new pure-functional module at `apps/desktop/src/renderer/lib/layout/` takes shape snapshots + a target group key and returns coordinates. Tldraw-aware facades (`placeTerminal`, `organizeShapes`) live in one entry file. All existing terminal-creation call sites (`addTerminalAtCenter`, `RpcBridge`, palette) route through the facade. An `organize-selection` action is registered in the existing `tool-registry` so it appears in command palette and context menu.

**Tech Stack:** TypeScript, tldraw 4.5, vitest. No new deps.

**Reference spec:** `docs/superpowers/specs/2026-04-24-layout-engine-design.md`

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/lib/layout/constants.ts` — tunables
- `apps/desktop/src/renderer/lib/layout/types.ts` — `Rect`, `ShapeRect`, `Cluster`, `PlanInput`
- `apps/desktop/src/renderer/lib/layout/geometry.ts` — `rectsOverlap`, `inflate`, `boundsOf`, `snap`
- `apps/desktop/src/renderer/lib/layout/geometry.test.ts`
- `apps/desktop/src/renderer/lib/layout/clusters.ts` — `detectClusters`
- `apps/desktop/src/renderer/lib/layout/clusters.test.ts`
- `apps/desktop/src/renderer/lib/layout/weight.ts` — `scoreCluster`
- `apps/desktop/src/renderer/lib/layout/weight.test.ts`
- `apps/desktop/src/renderer/lib/layout/placement.ts` — `pickAnchor`, `spiralSearch`
- `apps/desktop/src/renderer/lib/layout/placement.test.ts`
- `apps/desktop/src/renderer/lib/layout/plan.ts` — `planPlacement` orchestrator
- `apps/desktop/src/renderer/lib/layout/plan.test.ts`
- `apps/desktop/src/renderer/lib/layout/organize.ts` — `planOrganizeGrid`
- `apps/desktop/src/renderer/lib/layout/organize.test.ts`
- `apps/desktop/src/renderer/lib/layout/index.ts` — `placeTerminal`, `organizeShapes` (tldraw facades)

**Modify:**
- `apps/desktop/src/renderer/lib/default-actions.ts` — rewrite `addTerminalAtCenter`, register `organize-selection` action
- `apps/desktop/src/renderer/components/canvas.tsx:444-500` — route RPC + notification terminal creation through new facade
- `apps/desktop/src/renderer/shapes/terminal-shape.tsx` — bump `meta.lastUsedAt` on focus / data input

---

## Task 1: Scaffold constants and types

**Files:**
- Create: `apps/desktop/src/renderer/lib/layout/constants.ts`
- Create: `apps/desktop/src/renderer/lib/layout/types.ts`

- [ ] **Step 1: Create constants file**

Write `apps/desktop/src/renderer/lib/layout/constants.ts`:

```ts
export const GUTTER = 24
export const CLUSTER_GAP = 120
export const SPIRAL_STEP = 40
export const RECENCY_HALF_LIFE_MS = 1000 * 60 * 60 * 4
export const RECENCY_LAMBDA = 0.5
export const MAX_SPIRAL_ITERS = 400
```

- [ ] **Step 2: Create types file**

Write `apps/desktop/src/renderer/lib/layout/types.ts`:

```ts
export type Rect = { x: number; y: number; w: number; h: number }

export type ShapeRect = {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** Grouping key for composition (worktree path, or cwd when no worktree match). */
  groupKey: string
  /** Epoch ms; 0 when unknown. */
  lastUsedAt: number
}

export type Cluster = {
  shapes: ShapeRect[]
  bounds: Rect
  centroid: { x: number; y: number }
  composition: Map<string, number>
  lastUsedAt: number
}

export type PlanInput = {
  shapes: ShapeRect[]
  targetGroupKey: string
  size: { w: number; h: number }
  viewport: Rect
  now: number
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/lib/layout/constants.ts apps/desktop/src/renderer/lib/layout/types.ts
git commit -m "feat(layout): scaffold constants and types"
```

---

## Task 2: Geometry helpers

**Files:**
- Create: `apps/desktop/src/renderer/lib/layout/geometry.ts`
- Test: `apps/desktop/src/renderer/lib/layout/geometry.test.ts`

- [ ] **Step 1: Write failing tests**

Write `apps/desktop/src/renderer/lib/layout/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { rectsOverlap, inflate, boundsOf, snap, centroidOf } from "./geometry"

describe("rectsOverlap", () => {
  it("returns true when rects share any area", () => {
    expect(
      rectsOverlap(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 5, y: 5, w: 10, h: 10 }
      )
    ).toBe(true)
  })
  it("returns false when rects only touch edges", () => {
    expect(
      rectsOverlap(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 10, y: 0, w: 10, h: 10 }
      )
    ).toBe(false)
  })
  it("returns false when rects are far apart", () => {
    expect(
      rectsOverlap(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 100, y: 100, w: 10, h: 10 }
      )
    ).toBe(false)
  })
})

describe("inflate", () => {
  it("expands by pad on each side", () => {
    expect(inflate({ x: 10, y: 20, w: 30, h: 40 }, 5)).toEqual({
      x: 5,
      y: 15,
      w: 40,
      h: 50,
    })
  })
})

describe("boundsOf", () => {
  it("returns tight bbox of shapes", () => {
    const bounds = boundsOf([
      { id: "a", x: 0, y: 0, w: 10, h: 10, groupKey: "g", lastUsedAt: 0 },
      { id: "b", x: 20, y: 30, w: 10, h: 10, groupKey: "g", lastUsedAt: 0 },
    ])
    expect(bounds).toEqual({ x: 0, y: 0, w: 30, h: 40 })
  })
})

describe("snap", () => {
  it("rounds to nearest step", () => {
    expect(snap(43, 40)).toBe(40)
    expect(snap(61, 40)).toBe(80)
  })
})

describe("centroidOf", () => {
  it("averages shape centers", () => {
    expect(
      centroidOf([
        { id: "a", x: 0, y: 0, w: 10, h: 10, groupKey: "g", lastUsedAt: 0 },
        { id: "b", x: 20, y: 20, w: 10, h: 10, groupKey: "g", lastUsedAt: 0 },
      ])
    ).toEqual({ x: 15, y: 15 })
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/geometry.test.ts`
Expected: FAIL — "Cannot find module './geometry'"

- [ ] **Step 3: Implement geometry**

Write `apps/desktop/src/renderer/lib/layout/geometry.ts`:

```ts
import type { Rect, ShapeRect } from "./types"

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  )
}

export function inflate(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
}

export function boundsOf(shapes: ShapeRect[]): Rect {
  if (shapes.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of shapes) {
    if (s.x < minX) minX = s.x
    if (s.y < minY) minY = s.y
    if (s.x + s.w > maxX) maxX = s.x + s.w
    if (s.y + s.h > maxY) maxY = s.y + s.h
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function centroidOf(shapes: ShapeRect[]): { x: number; y: number } {
  if (shapes.length === 0) return { x: 0, y: 0 }
  let sx = 0
  let sy = 0
  for (const s of shapes) {
    sx += s.x + s.w / 2
    sy += s.y + s.h / 2
  }
  return { x: sx / shapes.length, y: sy / shapes.length }
}

export function snap(v: number, step: number): number {
  return Math.round(v / step) * step
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/geometry.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/lib/layout/geometry.ts apps/desktop/src/renderer/lib/layout/geometry.test.ts
git commit -m "feat(layout): geometry helpers"
```

---

## Task 3: Cluster detection

**Files:**
- Create: `apps/desktop/src/renderer/lib/layout/clusters.ts`
- Test: `apps/desktop/src/renderer/lib/layout/clusters.test.ts`

- [ ] **Step 1: Write failing tests**

Write `apps/desktop/src/renderer/lib/layout/clusters.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { detectClusters } from "./clusters"
import type { ShapeRect } from "./types"

function shape(
  id: string,
  x: number,
  y: number,
  groupKey = "wt",
  lastUsedAt = 0
): ShapeRect {
  return { id, x, y, w: 100, h: 80, groupKey, lastUsedAt }
}

describe("detectClusters", () => {
  it("returns empty for no shapes", () => {
    expect(detectClusters([])).toEqual([])
  })

  it("puts distant shapes in separate clusters", () => {
    const clusters = detectClusters([shape("a", 0, 0), shape("b", 1000, 1000)])
    expect(clusters).toHaveLength(2)
  })

  it("merges shapes within CLUSTER_GAP", () => {
    // 100 + 100 + 20 = 220 apart horizontally — within 2x CLUSTER_GAP/2 = 120 inflate
    const clusters = detectClusters([shape("a", 0, 0), shape("b", 150, 0)])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].shapes).toHaveLength(2)
  })

  it("chain-merges via single-link", () => {
    // a-b close, b-c close, a-c far → all one cluster
    const clusters = detectClusters([
      shape("a", 0, 0),
      shape("b", 150, 0),
      shape("c", 300, 0),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].shapes).toHaveLength(3)
  })

  it("computes composition by groupKey", () => {
    const clusters = detectClusters([
      shape("a", 0, 0, "wt1"),
      shape("b", 150, 0, "wt2"),
      shape("c", 300, 0, "wt1"),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].composition.get("wt1")).toBe(2)
    expect(clusters[0].composition.get("wt2")).toBe(1)
  })

  it("records max lastUsedAt across members", () => {
    const clusters = detectClusters([
      shape("a", 0, 0, "wt", 100),
      shape("b", 150, 0, "wt", 500),
    ])
    expect(clusters[0].lastUsedAt).toBe(500)
  })

  it("computes tight bounds and centroid", () => {
    const clusters = detectClusters([shape("a", 0, 0), shape("b", 150, 0)])
    expect(clusters[0].bounds).toEqual({ x: 0, y: 0, w: 250, h: 80 })
    expect(clusters[0].centroid).toEqual({ x: 125, y: 40 })
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/clusters.test.ts`
Expected: FAIL — "Cannot find module './clusters'"

- [ ] **Step 3: Implement clusters**

Write `apps/desktop/src/renderer/lib/layout/clusters.ts`:

```ts
import { CLUSTER_GAP } from "./constants"
import { boundsOf, centroidOf, inflate, rectsOverlap } from "./geometry"
import type { Cluster, ShapeRect } from "./types"

/** Single-link agglomerative clustering by proximity (CLUSTER_GAP). */
export function detectClusters(shapes: ShapeRect[]): Cluster[] {
  const n = shapes.length
  if (n === 0) return []

  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const pad = CLUSTER_GAP / 2
  const inflated = shapes.map((s) => inflate(s, pad))

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rectsOverlap(inflated[i], inflated[j])) union(i, j)
    }
  }

  const groups = new Map<number, ShapeRect[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(shapes[i])
    groups.set(root, list)
  }

  const clusters: Cluster[] = []
  for (const list of groups.values()) {
    const composition = new Map<string, number>()
    let lastUsedAt = 0
    for (const s of list) {
      composition.set(s.groupKey, (composition.get(s.groupKey) ?? 0) + 1)
      if (s.lastUsedAt > lastUsedAt) lastUsedAt = s.lastUsedAt
    }
    clusters.push({
      shapes: list,
      bounds: boundsOf(list),
      centroid: centroidOf(list),
      composition,
      lastUsedAt,
    })
  }

  return clusters
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/clusters.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/lib/layout/clusters.ts apps/desktop/src/renderer/lib/layout/clusters.test.ts
git commit -m "feat(layout): single-link cluster detection"
```

---

## Task 4: Cluster scoring

**Files:**
- Create: `apps/desktop/src/renderer/lib/layout/weight.ts`
- Test: `apps/desktop/src/renderer/lib/layout/weight.test.ts`

- [ ] **Step 1: Write failing tests**

Write `apps/desktop/src/renderer/lib/layout/weight.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { scoreCluster } from "./weight"
import { RECENCY_HALF_LIFE_MS, RECENCY_LAMBDA } from "./constants"
import type { Cluster, ShapeRect } from "./types"

function shape(groupKey: string): ShapeRect {
  return { id: `s-${Math.random()}`, x: 0, y: 0, w: 10, h: 10, groupKey, lastUsedAt: 0 }
}

function cluster(groupKeys: string[], lastUsedAt = 0): Cluster {
  const shapes = groupKeys.map(shape)
  const composition = new Map<string, number>()
  for (const k of groupKeys) composition.set(k, (composition.get(k) ?? 0) + 1)
  return {
    shapes,
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    centroid: { x: 0, y: 0 },
    composition,
    lastUsedAt,
  }
}

describe("scoreCluster", () => {
  it("returns 0 when group is absent", () => {
    expect(scoreCluster(cluster(["a", "b"]), "c", 0)).toBe(0)
  })

  it("favors pure over larger mixed", () => {
    // 3-terminal pure-X: 3 * 1.0 = 3.0
    // 5-terminal 40% X:  2 * 0.4 = 0.8
    const pureX = scoreCluster(cluster(["x", "x", "x"]), "x", 0)
    const mixed = scoreCluster(cluster(["x", "x", "y", "y", "y"]), "x", 0)
    expect(pureX).toBeGreaterThan(mixed)
  })

  it("applies recency boost within cap", () => {
    const stale = scoreCluster(cluster(["x"], 0), "x", 10 * RECENCY_HALF_LIFE_MS)
    const fresh = scoreCluster(cluster(["x"], 10 * RECENCY_HALF_LIFE_MS), "x", 10 * RECENCY_HALF_LIFE_MS)
    // Stale: decay→0, boost→1, score = 1
    // Fresh: decay→1, boost→1 + LAMBDA, score = 1 + LAMBDA
    expect(stale).toBeCloseTo(1, 4)
    expect(fresh).toBeCloseTo(1 + RECENCY_LAMBDA, 4)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/weight.test.ts`
Expected: FAIL — "Cannot find module './weight'"

- [ ] **Step 3: Implement weight**

Write `apps/desktop/src/renderer/lib/layout/weight.ts`:

```ts
import { RECENCY_HALF_LIFE_MS, RECENCY_LAMBDA } from "./constants"
import type { Cluster } from "./types"

export function scoreCluster(c: Cluster, targetGroupKey: string, now: number): number {
  const count = c.composition.get(targetGroupKey) ?? 0
  if (count === 0) return 0
  const purity = count / c.shapes.length
  const age = Math.max(0, now - c.lastUsedAt)
  const decay = Math.exp((-Math.LN2 * age) / RECENCY_HALF_LIFE_MS)
  const recencyBoost = 1 + RECENCY_LAMBDA * decay
  return count * purity * recencyBoost
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/weight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/lib/layout/weight.ts apps/desktop/src/renderer/lib/layout/weight.test.ts
git commit -m "feat(layout): cluster scoring with purity and recency"
```

---

## Task 5: Anchor picking and spiral search

**Files:**
- Create: `apps/desktop/src/renderer/lib/layout/placement.ts`
- Test: `apps/desktop/src/renderer/lib/layout/placement.test.ts`

- [ ] **Step 1: Write failing tests**

Write `apps/desktop/src/renderer/lib/layout/placement.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { pickAnchor, spiralSearch } from "./placement"
import { GUTTER } from "./constants"
import type { Cluster, Rect, ShapeRect } from "./types"

function shape(id: string, x: number, y: number, groupKey = "wt"): ShapeRect {
  return { id, x, y, w: 100, h: 80, groupKey, lastUsedAt: 0 }
}

function clusterOf(shapes: ShapeRect[]): Cluster {
  const composition = new Map<string, number>()
  for (const s of shapes) composition.set(s.groupKey, (composition.get(s.groupKey) ?? 0) + 1)
  const minX = Math.min(...shapes.map((s) => s.x))
  const minY = Math.min(...shapes.map((s) => s.y))
  const maxX = Math.max(...shapes.map((s) => s.x + s.w))
  const maxY = Math.max(...shapes.map((s) => s.y + s.h))
  const cx = shapes.reduce((a, s) => a + s.x + s.w / 2, 0) / shapes.length
  const cy = shapes.reduce((a, s) => a + s.y + s.h / 2, 0) / shapes.length
  return {
    shapes,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    centroid: { x: cx, y: cy },
    composition,
    lastUsedAt: 0,
  }
}

const VIEWPORT: Rect = { x: 0, y: 0, w: 2000, h: 1500 }

describe("pickAnchor", () => {
  it("falls back to viewport center when no clusters", () => {
    const a = pickAnchor([], "x", VIEWPORT, 0, { w: 600, h: 400 })
    expect(a).toEqual({ x: 1000 - 300, y: 750 - 200 })
  })

  it("hugs X-members inside a mixed cluster", () => {
    // X at (0,0), Y at (200,0). Cluster centroid ≈ 150,40; X-centroid = 50,40
    const c = clusterOf([shape("a", 0, 0, "x"), shape("b", 200, 0, "y")])
    const a = pickAnchor([c], "x", VIEWPORT, 0, { w: 100, h: 80 })
    expect(a.x).toBeCloseTo(50 - 50, 4)  // centroid.x - size.w/2
    expect(a.y).toBeCloseTo(40 - 40, 4)
  })

  it("picks the heaviest X cluster", () => {
    // pure-X 3-shape vs. mixed 40% X 5-shape — pure wins
    const pureX = clusterOf([
      shape("a", 0, 0, "x"),
      shape("b", 150, 0, "x"),
      shape("c", 300, 0, "x"),
    ])
    const mixed = clusterOf([
      shape("d", 2000, 1000, "x"),
      shape("e", 2150, 1000, "x"),
      shape("f", 2300, 1000, "y"),
      shape("g", 2000, 1080, "y"),
      shape("h", 2150, 1080, "y"),
    ])
    const a = pickAnchor([pureX, mixed], "x", VIEWPORT, 0, { w: 100, h: 80 })
    expect(a.x).toBeLessThan(1000)
  })
})

describe("spiralSearch", () => {
  it("returns anchor when no obstacles", () => {
    const a = { x: 100, y: 100 }
    const result = spiralSearch(a, { w: 100, h: 80 }, [])
    expect(result).toEqual(a)
  })

  it("finds free slot near occupied anchor", () => {
    const obstacles: Rect[] = [{ x: 100, y: 100, w: 100, h: 80 }]
    const a = { x: 100, y: 100 }
    const result = spiralSearch(a, { w: 100, h: 80 }, obstacles)
    // Result must not overlap obstacle inflated by GUTTER
    const gutterInflated: Rect = {
      x: obstacles[0].x - GUTTER,
      y: obstacles[0].y - GUTTER,
      w: obstacles[0].w + GUTTER * 2,
      h: obstacles[0].h + GUTTER * 2,
    }
    const resultRect: Rect = { x: result.x, y: result.y, w: 100, h: 80 }
    const overlaps =
      resultRect.x < gutterInflated.x + gutterInflated.w &&
      resultRect.x + resultRect.w > gutterInflated.x &&
      resultRect.y < gutterInflated.y + gutterInflated.h &&
      resultRect.y + resultRect.h > gutterInflated.y
    expect(overlaps).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/placement.test.ts`
Expected: FAIL — "Cannot find module './placement'"

- [ ] **Step 3: Implement placement**

Write `apps/desktop/src/renderer/lib/layout/placement.ts`:

```ts
import { GUTTER, MAX_SPIRAL_ITERS, SPIRAL_STEP } from "./constants"
import { centroidOf, inflate, rectsOverlap, snap } from "./geometry"
import { scoreCluster } from "./weight"
import type { Cluster, Rect, ShapeRect } from "./types"

export function pickAnchor(
  clusters: Cluster[],
  targetGroupKey: string,
  viewport: Rect,
  now: number,
  size: { w: number; h: number }
): { x: number; y: number } {
  let best: Cluster | null = null
  let bestScore = 0
  for (const c of clusters) {
    const s = scoreCluster(c, targetGroupKey, now)
    if (s > bestScore) {
      best = c
      bestScore = s
    }
  }

  if (best) {
    const members = best.shapes.filter((s) => s.groupKey === targetGroupKey)
    const centroid = centroidOf(members)
    return { x: centroid.x - size.w / 2, y: centroid.y - size.h / 2 }
  }

  const free = largestFreeRect(viewport, clusters, size)
  if (free) {
    return {
      x: free.x + free.w / 2 - size.w / 2,
      y: free.y + free.h / 2 - size.h / 2,
    }
  }

  return {
    x: viewport.x + viewport.w / 2 - size.w / 2,
    y: viewport.y + viewport.h / 2 - size.h / 2,
  }
}

/**
 * Coarse free-rect finder: scans axis-aligned horizontal bands between cluster bboxes
 * and picks the widest band tall enough to fit `size` with GUTTER. Not a true MER —
 * good enough to bias placement toward visibly-empty space.
 */
function largestFreeRect(
  viewport: Rect,
  clusters: Cluster[],
  size: { w: number; h: number }
): Rect | null {
  if (clusters.length === 0) return viewport
  const ys: number[] = [viewport.y, viewport.y + viewport.h]
  for (const c of clusters) {
    ys.push(c.bounds.y - GUTTER, c.bounds.y + c.bounds.h + GUTTER)
  }
  ys.sort((a, b) => a - b)
  let best: Rect | null = null
  for (let i = 0; i < ys.length - 1; i++) {
    const top = ys[i]
    const bot = ys[i + 1]
    const height = bot - top
    if (height < size.h + GUTTER * 2) continue
    const bandRect: Rect = {
      x: viewport.x,
      y: top,
      w: viewport.w,
      h: height,
    }
    let blocked = false
    for (const c of clusters) {
      if (rectsOverlap(inflate(c.bounds, GUTTER), bandRect)) {
        blocked = true
        break
      }
    }
    if (!blocked && (!best || bandRect.w * bandRect.h > best.w * best.h)) {
      best = bandRect
    }
  }
  return best
}

export function spiralSearch(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  obstacles: Rect[]
): { x: number; y: number } {
  const candidate = (x: number, y: number): Rect => ({ x, y, w: size.w, h: size.h })

  const fits = (c: Rect): boolean => {
    const padded = inflate(c, GUTTER)
    for (const o of obstacles) {
      if (rectsOverlap(padded, o)) return false
    }
    return true
  }

  const first = candidate(anchor.x, anchor.y)
  if (fits(first)) return { x: anchor.x, y: anchor.y }

  // Archimedean spiral sampled at SPIRAL_STEP.
  for (let i = 1; i < MAX_SPIRAL_ITERS; i++) {
    const t = i * 0.5
    const r = SPIRAL_STEP * Math.sqrt(t)
    const theta = t * 2.3998
    const x = snap(anchor.x + r * Math.cos(theta), SPIRAL_STEP)
    const y = snap(anchor.y + r * Math.sin(theta), SPIRAL_STEP)
    if (fits(candidate(x, y))) return { x, y }
  }

  // Last-resort linear sweep along +x.
  let x = snap(anchor.x, SPIRAL_STEP)
  while (true) {
    x += SPIRAL_STEP
    if (fits(candidate(x, anchor.y))) return { x, y: anchor.y }
    if (x - anchor.x > 1_000_000) return { x: anchor.x, y: anchor.y }
  }
}

export function obstaclesFromShapes(shapes: ShapeRect[]): Rect[] {
  return shapes.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }))
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/placement.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/lib/layout/placement.ts apps/desktop/src/renderer/lib/layout/placement.test.ts
git commit -m "feat(layout): anchor picker and spiral placement search"
```

---

## Task 6: Plan orchestrator

**Files:**
- Create: `apps/desktop/src/renderer/lib/layout/plan.ts`
- Test: `apps/desktop/src/renderer/lib/layout/plan.test.ts`

- [ ] **Step 1: Write failing tests**

Write `apps/desktop/src/renderer/lib/layout/plan.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { planPlacement } from "./plan"
import type { PlanInput, ShapeRect } from "./types"

function shape(id: string, x: number, y: number, groupKey = "wt"): ShapeRect {
  return { id, x, y, w: 100, h: 80, groupKey, lastUsedAt: 0 }
}

const BASE: Omit<PlanInput, "shapes" | "targetGroupKey"> = {
  size: { w: 100, h: 80 },
  viewport: { x: 0, y: 0, w: 2000, h: 1500 },
  now: 0,
}

describe("planPlacement", () => {
  it("returns viewport-centered point on empty canvas", () => {
    const p = planPlacement({ ...BASE, shapes: [], targetGroupKey: "x" })
    expect(p).toEqual({ x: 950, y: 710 })
  })

  it("never overlaps existing shapes", () => {
    const shapes = [shape("a", 900, 700, "x")]
    const p = planPlacement({ ...BASE, shapes, targetGroupKey: "x" })
    // result rect inflated by GUTTER must not overlap existing shape
    const overlaps =
      p.x < 900 + 100 && p.x + 100 > 900 && p.y < 700 + 80 && p.y + 80 > 700
    expect(overlaps).toBe(false)
  })

  it("lands near same-group neighbors", () => {
    const shapes = [
      shape("a", 0, 0, "x"),
      shape("b", 150, 0, "x"),
      shape("far", 1800, 1300, "y"),
    ]
    const p = planPlacement({ ...BASE, shapes, targetGroupKey: "x" })
    expect(p.x).toBeLessThan(500)
    expect(p.y).toBeLessThan(500)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/plan.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement plan**

Write `apps/desktop/src/renderer/lib/layout/plan.ts`:

```ts
import { detectClusters } from "./clusters"
import { obstaclesFromShapes, pickAnchor, spiralSearch } from "./placement"
import type { PlanInput } from "./types"

export function planPlacement(input: PlanInput): { x: number; y: number } {
  const clusters = detectClusters(input.shapes)
  const anchor = pickAnchor(
    clusters,
    input.targetGroupKey,
    input.viewport,
    input.now,
    input.size
  )
  return spiralSearch(anchor, input.size, obstaclesFromShapes(input.shapes))
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/lib/layout/plan.ts apps/desktop/src/renderer/lib/layout/plan.test.ts
git commit -m "feat(layout): planPlacement orchestrator"
```

---

## Task 7: Organize grid planner

**Files:**
- Create: `apps/desktop/src/renderer/lib/layout/organize.ts`
- Test: `apps/desktop/src/renderer/lib/layout/organize.test.ts`

- [ ] **Step 1: Write failing tests**

Write `apps/desktop/src/renderer/lib/layout/organize.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { planOrganizeGrid } from "./organize"
import { GUTTER } from "./constants"
import type { ShapeRect } from "./types"

function shape(id: string, x: number, y: number, w = 100, h = 80): ShapeRect {
  return { id, x, y, w, h, groupKey: "wt", lastUsedAt: 0 }
}

describe("planOrganizeGrid", () => {
  it("returns empty plan for empty input", () => {
    expect(planOrganizeGrid([], { aspect: 1 })).toEqual([])
  })

  it("preserves top-left of bounding box", () => {
    const shapes = [shape("a", 10, 20), shape("b", 200, 300)]
    const plan = planOrganizeGrid(shapes, { aspect: 1 })
    const minX = Math.min(...plan.map((p) => p.x))
    const minY = Math.min(...plan.map((p) => p.y))
    expect(minX).toBe(10)
    expect(minY).toBe(20)
  })

  it("uses max cell size + gutter", () => {
    const shapes = [shape("a", 0, 0, 100, 80), shape("b", 1000, 1000, 200, 150)]
    const plan = planOrganizeGrid(shapes, { aspect: 1 })
    // 2 shapes → 2x1 grid (cols = round(sqrt(2)) = 1, but aspect=1 → 1 col, so 2 rows)
    // Either way, one axis has step = max cell size + GUTTER
    const xs = plan.map((p) => p.x).sort((a, b) => a - b)
    const ys = plan.map((p) => p.y).sort((a, b) => a - b)
    const stepX = xs[1] - xs[0]
    const stepY = ys[1] - ys[0]
    const expected = 200 + GUTTER // max(w)
    const expectedY = 150 + GUTTER
    expect(stepX === 0 || stepX === expected).toBe(true)
    expect(stepY === 0 || stepY === expectedY).toBe(true)
  })

  it("produces a plan entry per shape, keyed by id", () => {
    const shapes = [shape("a", 0, 0), shape("b", 1000, 0), shape("c", 0, 1000)]
    const plan = planOrganizeGrid(shapes, { aspect: 1 })
    expect(new Set(plan.map((p) => p.id))).toEqual(new Set(["a", "b", "c"]))
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/organize.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement organize**

Write `apps/desktop/src/renderer/lib/layout/organize.ts`:

```ts
import { GUTTER } from "./constants"
import { boundsOf } from "./geometry"
import type { ShapeRect } from "./types"

export type OrganizePlanEntry = { id: string; x: number; y: number }

/**
 * Pack shapes into a grid keyed to the bounding-box top-left.
 * cols = round(sqrt(n)), biased +1 when viewport aspect > 1.3 (wider screens).
 * Cell = max(w) + GUTTER × max(h) + GUTTER across inputs.
 * Row-major, sorted by existing (y, x) to preserve rough ordering.
 */
export function planOrganizeGrid(
  shapes: ShapeRect[],
  opts: { aspect: number }
): OrganizePlanEntry[] {
  if (shapes.length === 0) return []

  const bbox = boundsOf(shapes)
  const maxW = Math.max(...shapes.map((s) => s.w))
  const maxH = Math.max(...shapes.map((s) => s.h))
  const cellW = maxW + GUTTER
  const cellH = maxH + GUTTER

  const baseCols = Math.max(1, Math.round(Math.sqrt(shapes.length)))
  const cols = opts.aspect > 1.3 ? baseCols + 1 : baseCols

  const sorted = [...shapes].sort((a, b) => a.y - b.y || a.x - b.x)

  return sorted.map((s, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    return { id: s.id, x: bbox.x + col * cellW, y: bbox.y + row * cellH }
  })
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/desktop && pnpm test:unit src/renderer/lib/layout/organize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/lib/layout/organize.ts apps/desktop/src/renderer/lib/layout/organize.test.ts
git commit -m "feat(layout): grid-pack organize planner"
```

---

## Task 8: Tldraw facade

**Files:**
- Create: `apps/desktop/src/renderer/lib/layout/index.ts`

- [ ] **Step 1: Implement facade**

Write `apps/desktop/src/renderer/lib/layout/index.ts`:

```ts
import type { Editor, TLShape, TLShapeId } from "tldraw"
import { findWorktreeForCwd } from "@/lib/terminal-worktree-title"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"
import { planPlacement } from "./plan"
import { planOrganizeGrid } from "./organize"
import type { Rect, ShapeRect } from "./types"

function rectFromShape(editor: Editor, shape: TLShape): ShapeRect | null {
  const bounds = editor.getShapePageBounds(shape.id)
  if (!bounds) return null
  const props = shape.props as { cwd?: string; w?: number; h?: number }
  const meta = shape.meta as { lastUsedAt?: number } | undefined
  return {
    id: shape.id,
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    groupKey: props.cwd ?? "",
    lastUsedAt: meta?.lastUsedAt ?? 0,
  }
}

function resolveGroupKey(cwd: string, worktrees: WorktreeIndexEntry[]): string {
  if (!cwd) return ""
  return findWorktreeForCwd(cwd, worktrees)?.path ?? cwd
}

function viewportRect(editor: Editor): Rect {
  const b = editor.getViewportPageBounds()
  return { x: b.x, y: b.y, w: b.w, h: b.h }
}

export function placeTerminal(
  editor: Editor,
  opts: {
    cwd: string
    worktrees: WorktreeIndexEntry[]
    size: { w: number; h: number }
  }
): { x: number; y: number } {
  const target = resolveGroupKey(opts.cwd, opts.worktrees)

  const shapes: ShapeRect[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (s.type !== "terminal") continue
    const r = rectFromShape(editor, s)
    if (!r) continue
    const props = s.props as { cwd?: string }
    shapes.push({ ...r, groupKey: resolveGroupKey(props.cwd ?? "", opts.worktrees) })
  }

  return planPlacement({
    shapes,
    targetGroupKey: target,
    size: opts.size,
    viewport: viewportRect(editor),
    now: Date.now(),
  })
}

export function organizeShapes(editor: Editor, shapeIds: TLShapeId[]): void {
  if (shapeIds.length === 0) return
  const shapes: ShapeRect[] = []
  for (const id of shapeIds) {
    const s = editor.getShape(id)
    if (!s) continue
    const bounds = editor.getShapePageBounds(id)
    if (!bounds) continue
    shapes.push({
      id,
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      groupKey: "",
      lastUsedAt: 0,
    })
  }
  if (shapes.length === 0) return

  const viewport = viewportRect(editor)
  const aspect = viewport.w / Math.max(1, viewport.h)
  const plan = planOrganizeGrid(shapes, { aspect })

  editor.updateShapes(
    plan.map((p) => {
      const shape = editor.getShape(p.id as TLShapeId)!
      return { id: p.id as TLShapeId, type: shape.type, x: p.x, y: p.y }
    })
  )
}

/** Expand a single selected terminal to its detected cluster. */
export function clusterShapeIdsFor(
  editor: Editor,
  shapeId: TLShapeId,
  worktrees: WorktreeIndexEntry[]
): TLShapeId[] {
  const shapes: ShapeRect[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (s.type !== "terminal") continue
    const r = rectFromShape(editor, s)
    if (!r) continue
    const props = s.props as { cwd?: string }
    shapes.push({ ...r, groupKey: resolveGroupKey(props.cwd ?? "", worktrees) })
  }
  const { detectClusters } = require("./clusters") as typeof import("./clusters")
  const clusters = detectClusters(shapes)
  const hit = clusters.find((c) => c.shapes.some((s) => s.id === shapeId))
  return hit ? (hit.shapes.map((s) => s.id) as TLShapeId[]) : [shapeId]
}
```

- [ ] **Step 2: Replace dynamic require with static import**

The `require("./clusters")` above works at runtime but fails ESM typecheck. Replace it:

At the top of the file, add:
```ts
import { detectClusters } from "./clusters"
```

And remove the `require` line inside `clusterShapeIdsFor`, using `detectClusters` directly.

- [ ] **Step 3: Typecheck**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS — no errors in `lib/layout/`.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/lib/layout/index.ts
git commit -m "feat(layout): tldraw facade for placement and organize"
```

---

## Task 9: Wire addTerminalAtCenter through the layout engine

**Files:**
- Modify: `apps/desktop/src/renderer/lib/default-actions.ts`

- [ ] **Step 1: Rewrite addTerminalAtCenter**

Replace the current body of `addTerminalAtCenter` in `apps/desktop/src/renderer/lib/default-actions.ts`:

```ts
import { createShapeId, type Editor, type TLShapeId } from "tldraw"
import { TerminalSquare, GitBranch, LayoutGrid } from "lucide-react"
import { registerAction } from "./tool-registry"
import { placeTerminal } from "./layout"
import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"

const DEFAULT_TERMINAL_W = 600
const DEFAULT_TERMINAL_H = 400

export function addTerminalAtCenter(
  editor: Editor,
  props: Record<string, unknown> = {},
  worktrees: WorktreeIndexEntry[] = [],
): TLShapeId {
  const id = createShapeId()
  const cwd = typeof props.cwd === "string" ? props.cwd : ""
  const { x, y } = placeTerminal(editor, {
    cwd,
    worktrees,
    size: { w: DEFAULT_TERMINAL_W, h: DEFAULT_TERMINAL_H },
  })
  editor.createShape({
    id,
    type: "terminal",
    x,
    y,
    props: { w: DEFAULT_TERMINAL_W, h: DEFAULT_TERMINAL_H, ...props },
  })
  return id
}
```

Keep `randomAteliWorktreeBranchName`, `add-terminal`, `add-worktree` registrations as-is.

- [ ] **Step 2: Update one caller signature (new-terminal-pick)**

Modify `apps/desktop/src/renderer/command-palette/providers/new-terminal-pick.ts`:

- Change `run: (ctx) => { ... addTerminalAtCenter(ctx.editor, { cwd }) }` to pass worktrees:
  `addTerminalAtCenter(ctx.editor, { cwd }, env.worktrees)`
- Change the `createNew` run to `addTerminalAtCenter(ctx.editor, { cwd: path }, env.worktrees)`.

- [ ] **Step 3: Typecheck**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS, except for remaining callers in `canvas.tsx` (fixed in Task 10).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/lib/default-actions.ts apps/desktop/src/renderer/command-palette/providers/new-terminal-pick.ts
git commit -m "feat(layout): route palette terminal creation through placeTerminal"
```

---

## Task 10: Wire RpcBridge and notification handlers

**Files:**
- Modify: `apps/desktop/src/renderer/components/canvas.tsx`

- [ ] **Step 1: Update the RpcBridge component**

In `apps/desktop/src/renderer/components/canvas.tsx` around line 444, thread `worktrees` into every `addTerminalAtCenter` call and the `rpc:create-terminal` handler.

At the top of `RpcBridge`:
```ts
const worktrees = useWorktrees()
```
(Import `useWorktrees` from `@/contexts/worktree-index-context` if not already imported.)

Replace the `onCreateTerminal` handler body so that when the main process passes only placeholder `x=0, y=0`, the renderer computes a real position:

```ts
const removeCreateTerminal = window.electron.rpc.onCreateTerminal(
  ({ shapeId, x, y, w, h }) => {
    const callerSuppliedPosition = x !== 0 || y !== 0
    const pos = callerSuppliedPosition
      ? { x, y }
      : placeTerminal(editor, {
          cwd: "",
          worktrees,
          size: { w, h },
        })
    editor.createShape({
      id: shapeId as TLShapeId,
      type: "terminal",
      x: pos.x,
      y: pos.y,
      props: { w, h },
    })
  }
)
```

Add the import at the top of the file:
```ts
import { placeTerminal } from "@/lib/layout"
```

- [ ] **Step 2: Pass worktrees to notification-driven calls**

Same file, within the `onNotification` handler: replace both `addTerminalAtCenter(editor, ...)` calls with the 3-arg form that includes `worktrees`.

Before:
```ts
if (method === "terminal.created") {
  addTerminalAtCenter(editor, { sessionId: params.sessionKey as string })
} else if (method === "worktree.created") {
  addTerminalAtCenter(editor, { cwd: params.path as string })
}
```

After:
```ts
if (method === "terminal.created") {
  addTerminalAtCenter(
    editor,
    { sessionId: params.sessionKey as string },
    worktrees,
  )
} else if (method === "worktree.created") {
  addTerminalAtCenter(
    editor,
    { cwd: params.path as string },
    worktrees,
  )
}
```

- [ ] **Step 3: Add worktrees to the effect dependency array**

The `useEffect` that registers these handlers currently depends on `[editor]` (or similar). Add `worktrees` to the deps so the closure picks up updates. If the existing deps don't exist, ensure the effect re-runs when `worktrees` changes.

- [ ] **Step 4: Typecheck and run existing tests**

Run: `cd apps/desktop && pnpm typecheck && pnpm test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/canvas.tsx
git commit -m "feat(layout): route RPC and notification terminal creation through placeTerminal"
```

---

## Task 11: lastUsedAt tracking on terminal shape

**Files:**
- Modify: `apps/desktop/src/renderer/shapes/terminal-shape.tsx`

- [ ] **Step 1: Add a throttled meta-update helper**

Inside `TerminalComponent` (before the first `useEffect`), add:

```ts
const lastTouchRef = useRef(0)
const touchLastUsed = () => {
  const now = Date.now()
  if (now - lastTouchRef.current < 5000) return  // throttle: at most every 5s
  lastTouchRef.current = now
  editor.updateShape<TerminalShape>({
    id: shape.id,
    type: TERMINAL_SHAPE_TYPE,
    meta: { ...(shape.meta ?? {}), lastUsedAt: now },
  })
}
```

- [ ] **Step 2: Call it on data and focus**

In the `attachSession` function, inside `term.onData((data) => { ... })` handler, add a call to `touchLastUsed()` after the `if (!state.disposed && state.sessionId)` branch:

```ts
const onDataDisposable = term.onData((data) => {
  if (!state.disposed && state.sessionId) {
    sessions.write(state.sessionId, data)
    touchLastUsed()
  }
})
```

In the `useEffect` that handles `isInteractive`, call `touchLastUsed` when becoming interactive:

```ts
useEffect(() => {
  if (isInteractive) {
    termRef.current?.focus()
    touchLastUsed()
  } else {
    termRef.current?.blur()
  }
}, [isInteractive, shape.id])
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/shapes/terminal-shape.tsx
git commit -m "feat(layout): track terminal lastUsedAt in shape meta"
```

---

## Task 12: Register the Organize action

**Files:**
- Modify: `apps/desktop/src/renderer/lib/tool-registry.ts`
- Modify: `apps/desktop/src/renderer/lib/default-actions.ts`

- [ ] **Step 1: Extend ToolAction with an optional visibility predicate**

The existing `ToolAction` shape only supports static flags. Organize should hide when nothing useful is selected. Add a `when?` predicate.

Edit `apps/desktop/src/renderer/lib/tool-registry.ts`:

```ts
export interface ToolAction {
  id: string
  label: string
  icon: LucideIcon
  tldrawIcon?: string
  shortcut?: string
  showInToolbar?: boolean
  showInCommandMenu?: boolean
  showInContextMenu?: boolean
  openPaletteRoute?: PaletteRoute
  execute?: (editor: Editor) => void | Promise<void>
  /** Gate visibility in toolbar / menus (default: always visible). */
  when?: (editor: Editor) => boolean
}
```

Update the three getters to honor it:

```ts
export function getToolbarActions(editor?: Editor): ToolAction[] {
  return registry.filter(
    (a) => a.showInToolbar && (!a.when || !editor || a.when(editor))
  )
}

export function getCommandMenuActions(editor?: Editor): ToolAction[] {
  return registry.filter(
    (a) => a.showInCommandMenu && (!a.when || !editor || a.when(editor))
  )
}

export function getContextMenuActions(editor?: Editor): ToolAction[] {
  return registry.filter(
    (a) => a.showInContextMenu && (!a.when || !editor || a.when(editor))
  )
}
```

(The `!editor` branch preserves callers that don't pass an editor — they get the old unfiltered behavior.)

- [ ] **Step 2: Register the organize action**

In `apps/desktop/src/renderer/lib/default-actions.ts`, add:

```ts
import { organizeShapes, clusterShapeIdsFor } from "./layout"
```

And at the bottom of the file:

```ts
registerAction({
  id: "organize-selection",
  label: "Organize",
  icon: LayoutGrid,
  tldrawIcon: "grid",
  showInCommandMenu: true,
  showInContextMenu: true,
  when: (editor) => {
    const ids = editor.getSelectedShapeIds()
    if (ids.length === 0) return false
    const shapes = ids
      .map((id) => editor.getShape(id))
      .filter((s): s is NonNullable<typeof s> => s != null)
    const terminals = shapes.filter((s) => s.type === "terminal")
    if (terminals.length >= 2) return true
    // Single terminal selected → offer cluster-expand organize
    return terminals.length === 1
  },
  execute: (editor) => {
    const ids = editor.getSelectedShapeIds()
    if (ids.length === 0) return
    // Cluster-expand when exactly one terminal is selected.
    const worktrees: WorktreeIndexEntry[] = []
    const targets =
      ids.length === 1 && editor.getShape(ids[0])?.type === "terminal"
        ? clusterShapeIdsFor(editor, ids[0], worktrees)
        : ids
    organizeShapes(editor, targets)
  },
})
```

**Note:** `ToolAction.execute` currently receives only `editor`, so it has no access to the worktrees React context. For now, cluster-expand uses an empty worktree list, which means it falls back to cwd-equality grouping (adequate: terminals with the same cwd still cluster correctly). If you want a true worktree-aware cluster-expand, see Task 13.

- [ ] **Step 3: Typecheck**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/lib/tool-registry.ts apps/desktop/src/renderer/lib/default-actions.ts
git commit -m "feat(layout): register organize-selection action"
```

---

## Task 13: Wire worktree context into the Organize execute path

**Files:**
- Modify: `apps/desktop/src/renderer/lib/tool-registry.ts`
- Modify: call sites that invoke `execute`

Goal: give `execute` access to the current worktree list so cluster-expand groups by worktree (not just cwd).

- [ ] **Step 1: Extend execute signature**

Edit `apps/desktop/src/renderer/lib/tool-registry.ts`:

```ts
export interface ActionContext {
  editor: Editor
  worktrees: WorktreeIndexEntry[]
}
// Imports needed:
// import type { WorktreeIndexEntry } from "@/contexts/worktree-index-context"

export interface ToolAction {
  // ...existing fields...
  execute?: (ctx: ActionContext) => void | Promise<void>
  when?: (ctx: ActionContext) => boolean
}
```

Update the filter getters to accept `ActionContext | undefined` and forward it to `when`.

- [ ] **Step 2: Update organize registration**

In `default-actions.ts`, change the registered action to use the new signature:

```ts
when: (ctx) => {
  const ids = ctx.editor.getSelectedShapeIds()
  // ...same logic...
},
execute: (ctx) => {
  const { editor, worktrees } = ctx
  const ids = editor.getSelectedShapeIds()
  if (ids.length === 0) return
  const targets =
    ids.length === 1 && editor.getShape(ids[0])?.type === "terminal"
      ? clusterShapeIdsFor(editor, ids[0], worktrees)
      : ids
  organizeShapes(editor, targets)
},
```

- [ ] **Step 3: Update existing call sites**

Find every caller of `getToolbarActions` / `getCommandMenuActions` / `getContextMenuActions` and every direct `execute(editor)` call. Each one currently passes `editor`; update them to construct an `ActionContext { editor, worktrees }`. Use `grep` to find them:

Run: `cd apps/desktop/src/renderer && grep -rn "getToolbarActions\|getCommandMenuActions\|getContextMenuActions\|\.execute(" --include="*.ts" --include="*.tsx"`

For each hit, either:
- Add `useWorktrees()` in the component and pass it, or
- If in a non-React file, forward the worktrees already in scope.

- [ ] **Step 4: Typecheck and run existing tests**

Run: `cd apps/desktop && pnpm typecheck && pnpm test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src/renderer
git commit -m "feat(layout): thread worktrees into ToolAction context"
```

---

## Task 14: Smoke test the full flow manually

**This task is manual verification — no code changes.**

- [ ] **Step 1: Ask the user to start the dev server**

Per AGENTS.md, never run dev servers yourself. Ask the user:

> "Start the desktop app (`pnpm -C apps/desktop dev`) and verify:
> 1. Create one terminal via the command palette → "New terminal" → main. It lands at viewport center (no siblings).
> 2. Create a second terminal for main. It lands adjacent, not overlapping.
> 3. Create a third in a new worktree. It lands in an open area, visibly separated from the main cluster.
> 4. Create a fourth for main. It snaps back near the main cluster.
> 5. Select any two terminals → right-click → "Organize". They snap to a tidy 2×1 grid preserving the top-left.
> 6. Select one terminal → command palette → "Organize". Its whole cluster repacks."

- [ ] **Step 2: If any scenario fails, open an issue or iterate**

Capture the scenario name, observed coordinates, and expected coordinates. Add a unit fixture to the corresponding test file and fix the implementation.

- [ ] **Step 3: Commit any follow-ups with descriptive messages**

No batch commit for this task.

---

## Task 15: Final verification

- [ ] **Step 1: Run the full unit test suite**

Run: `cd apps/desktop && pnpm test:unit`
Expected: PASS, all layout tests included.

- [ ] **Step 2: Typecheck**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `cd apps/desktop && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Squash-review the commit log**

Run: `git log --oneline main..HEAD`
Expected: ~13 commits, each small and self-describing.

---

## Self-review notes

- **Spec coverage:** All seven design sections have tasks — module layout (1–8), entry-point wiring (9–10), lastUsedAt (11), organize action (12–13), testing (embedded in 2–7), rollout (no feature flag, single PR).
- **Open questions from spec:**
  - *Size inheritance from nearest cluster member.* Not in this plan. Keep default `600×400`; revisit if manual QA finds it awkward.
  - *RPC lastUsedAt bump on agent writes.* Task 11 bumps on every `term.onData`, which covers user-typed input. Agent-written data arrives via `sessions.onData` and writes to the xterm display; that path does not bump. Acceptable — layout should prefer "human recently used" over "agent spat output".
- **Risk surfaces:**
  - Task 13 touches every ToolAction caller. If the codebase has many, consider doing the minimum: leave the unit tests green, hit only the organize path, and defer broader signature migration.
  - `clusterShapeIdsFor` relies on `detectClusters` which is O(n²). Fine at expected scale (tens of terminals).

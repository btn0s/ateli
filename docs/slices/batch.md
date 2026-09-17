# Slice: batch inputs and implicit for-each

Implements [ADR 0005](../adr/0005-lists-are-the-loop.md) on top of [atlas-nodes.md](./atlas-nodes.md). Three agents build this in parallel; this file is the shared contract. Repo: `/Users/btnorris/dev/ateli`.

## Types

`ValueType` gains list forms: `'mesh[]' | 'image[]' | 'text[]' | 'number[]' | 'boolean[]'`. A port declared `mesh` is *single*; a port declared `mesh[]` is *list*. An edge is valid when base types match; a list output may feed a single input (fan-out) and a single output may feed a list input (list of one).

## Fan-out semantics (bridge)

- **Cardinality** of a node = max over its inputs of (list length if the connected upstream result is a list and the input is single). Unconnected scalars contribute 1.
- If two fanned inputs have different lengths, the node fails: `fan-out lengths differ: mesh=15, image=3`.
- The node runs `cardinality` times (index `i`), each as a normal per-node subprocess with the `i`-th item of each fanned input and the same scalars. Each iteration caches independently (same key scheme, item hash in place of the list).
- Outputs of a fanned node are lists of `cardinality` (each port). A node with cardinality 1 whose upstream is single behaves exactly as today.
- Runs process iterations sequentially (one subprocess at a time, as now). `POST /ateli/runs/:id/cancel` still kills the current subprocess and skips the rest.
- Node status: `{ status, error?, outputs, items?: { total, done, failed } }`. A failed iteration fails the node after the remaining iterations are skipped; `outputs` still lists results for the iterations that succeeded (as a list result with holes → `null`).
- Cache: unchanged key per iteration; a node reports `cached` only if every iteration hit.

## Results

A list result is one result record: `{ resultId, kind: 'mesh[]' (etc.), items: [{ resultId, name, previewUrl, downloadUrl, value? } | null] }`. `GET /ateli/results/:id` returns it; each item's own `resultId` is a normal single result (preview/download routes work per item). `GET /ateli/results/:id/preview` of a list returns the first non-null item's preview.

## New tools (server/tools.mjs; all `runtime: 'none'` except noted)

| id | title | category | inputs | outputs |
|---|---|---|---|---|
| `input.meshes` | Input Meshes | Input | `files: mesh[]` (control = multi-file picker; value = `sourceId[]`) | `meshes: mesh[]` |
| `input.images` | Input Images | Input | `files: image[]` | `images: image[]` |
| `list.collect` | Collect | Utility | `item: mesh` **or** `image` (single-typed generic: declare one node per base type: `list.collectMeshes`, `list.collectImages`) | `list: mesh[]` — consumes the fan-out: cardinality 1, gathers upstream list into a list result |
| `list.pick` | Pick Item | Utility | `list: mesh[]` (and `image[]` variant), `index: number default 0` | `item: mesh` |
| `list.count` | Count | Utility | `list: mesh[]` / `image[]` | `count: number` |

`Collect` exists so a downstream single-valued node (e.g. an Export that should name by index) can see the whole list; with implicit map most graphs never need it.

`output.export` gains `name` templating: `{name}` → source file stem of the item, `{index}` → zero-based index, `{n}` → 1-based. A fanned Export writes one file per item.

Category `Utility` is new (`AteliCategory`).

## UI (mod/graph)

- `ateli-tools.ts`: list types in `AteliValueType`; port colour for a list = same hue with a double-ring dot.
- Edge validity: base types must match; fan-out allowed.
- `input.meshes` / `input.images`: the file control accepts `multiple`; shows `N files` and a small × to clear. Values are `sourceId[]`.
- A fanned-out node shows a badge `×15` next to the title; while running, `7/15` with the progress bar; on failure, `12/15 · 3 failed` in the error line.
- Preview of a list result: a filmstrip (horizontal scroll) of item thumbnails, each opening the lightbox; the hover trio acts on the item under the pointer.
- `runAteliGraph` reads `items` from status and stores list results as `{ resultId, kind, items:[…] }` in `results`.
- Command bar: "Add Input Meshes", "Add Input Images", "Add Collect Meshes/Images", "Add Pick Item", "Add Count" in their categories.

## Tests

- Router: fan-out over a 3-item `input.meshes` through the fake blender `mesh.optimize` (3 subprocesses, list result with 3 items, per-item cache hits on rerun, mismatched lengths error, cancel mid-batch skips remaining, export templating writes 3 files).
- Worker tests: unchanged (workers are per-item).
- UI: build + install + an `/exec` check that a node fed by a 3-item list renders the `×3` badge and a 3-thumbnail filmstrip after a run.

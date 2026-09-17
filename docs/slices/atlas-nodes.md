# Slice: Atlas Input, Image, Mesh, and Output nodes in tldraw Offline

Implement four complete node categories from Atlas AI Studio as native tldraw shapes backed by the local bridge, with draggable/reconnectable edges and per-node run.
Reference: https://docs.atlas.design/atlas-ai-studio-overview/node-index.md (append `.md` to any page; `?ask=` answers questions).

"Complete" means every Atlas node in the category that can run locally. Nodes that require a hosted AI model with no local equivalent are **excluded** and listed at the end. Do not add them.

Decisions this contract implements: [ADR 0001](../adr/0001-tldraw-offline-headless-first.md) native tldraw shapes, [ADR 0003](../adr/0003-per-node-execution.md) one node per subprocess, [ADR 0004](../adr/0004-textures-are-channel-images.md) every row is a typed parameter and textures are channel images.

Amendment: `input.mesh` is resolved in-process but the bridge renders its preview by invoking the Blender worker with a synthetic `mesh.render` request (512², yaw 35, pitch 15) into `nodes/<id>/preview/`. Uploaded meshes therefore have a `previewUrl` like any other mesh result. `backend.mjs` allows `DELETE` in the Ateli preflight.

## Repos and hosts

- Mod, bridge, and executors: `/Users/btnorris/dev/ateli` — `mod/{skin,canvas,graph}/`, `mod/config.tsx`, `server/`, `executor/`, `build/`, `test/`, `bin/`
- The bridge is `/Users/btnorris/dev/ateli/server/backend.mjs` at `http://127.0.0.1:7237/ateli/*`
- Installed proof document: `/Users/btnorris/dev/tldraw-offline/Ateli POC.tldraw`
- Blender 5.1.2: `/opt/homebrew/bin/blender`. Python: `/opt/homebrew/bin/python3` with Pillow 12 + numpy 2.
- Image generation/editing: `imgen` CLI on PATH (`imgen generate --help`, `imgen edit --help`). It returns a job; use `--timeout` and parse its JSON output for the output file path.
- Canonical mesh: `/Users/btnorris/dev/games/last-light/client/public/character-experiments/drifters-light-default/meshy-7-master-raw.glb`
- Staging root: `/Users/btnorris/dev/games/last-light/.scratch/ateli/`

## Value types and port colors

```ts
type ValueType = 'mesh' | 'image' | 'text' | 'number' | 'boolean' | 'enum'
```
mesh `#a78bfa` · image `#facc15` · text `#60a5fa` · number `#fb923c` · boolean `#f87171` · enum `#fb923c`

`enum` and `number`/`boolean`/`text` inputs are **parameters with a port**: editable inline when unconnected, driven by the edge when connected. `mesh` and `image` inputs are port-only. Outputs are typed rows after inputs.

## Node schema

```ts
type Param = {
  id: string; label: string; type: ValueType
  required?: boolean          // default: true for mesh/image/text, true for scalars
  default?: unknown           // scalars only
  options?: string[]          // enum only
  min?: number; max?: number; step?: number   // number only
  multiline?: boolean         // text only
  advanced?: boolean          // collapsed under "Advanced N ›"
}
type Tool = {
  id: string; version: 1; title: string
  category: 'Input' | 'Image' | 'Mesh' | 'Output'
  runtime: 'none' | 'image' | 'imgen' | 'blender' | 'meshy'
  inputs: Param[]; outputs: Param[]
}
```

## Node catalog (fixed — every agent implements exactly this)

### Input (`runtime: 'none'` — resolved by the bridge, no subprocess)

| id | title | inputs | outputs |
|---|---|---|---|
| `input.text` | Input Text | `value: text multiline` | `text: text` |
| `input.number` | Input Number | `value: number default 0` | `number: number` |
| `input.boolean` | Input Boolean | `value: boolean default false` | `boolean: boolean` |
| `input.image` | Input Image | `file: image` (control = file picker; value is a `sourceId`) | `image: image` |
| `input.mesh` | Input Mesh | `file: mesh` (control = file picker; value is a `sourceId`) | `mesh: mesh` |

### Image

Generation (`runtime: 'imgen'`):

| id | title | inputs | outputs |
|---|---|---|---|
| `image.generate.fast` | Text → Image (Fast) | `prompt: text`, `aspectRatio: enum ['1:1','16:9','9:16','4:3','3:4'] default '1:1'`, `seed: number advanced` | `image: image` |
| `image.generate` | Text → Image (High Quality) | `prompt: text`, `model: enum ['gpt-image-2.5-sunburst','gpt-image-2.5-flare','gemini-3.1-flash-image']`, `aspectRatio: enum (same)`, `quality: enum ['medium','high','max'] default 'high'`, `seed: number advanced` | `image: image` |
| `image.edit` | Edit Image with Text | `image: image`, `prompt: text`, `model: enum (same) advanced`, `seed: number advanced` | `image: image` |
| `image.extend` | Extend Image | `image: image`, `prompt: text`, `left/top/right/bottom: number 0..2048 default 0` (four params) | `image: image` |
| `image.removeBackground` | Remove Image Background | `image: image` | `cutout: image`, `mask: image` |

Procedural + post-processing (`runtime: 'image'`, deterministic, Pillow/numpy):

| id | title | inputs | outputs |
|---|---|---|---|
| `image.procedural` | Procedural Image Builder | `pattern: enum ['checkerboard','grid','perlin','voronoi','gradient']`, `width: number default 1024`, `height: number default 1024`, `scale: number default 8`, `seed: number default 0`, `tileable: boolean default true`, `colorA: text default '#ffffff'`, `colorB: text default '#000000'` | `image: image` |
| `image.resize` | Simple Image Resize | `image`, `width: number`, `height: number`, `keepAspect: boolean default true` | `image` |
| `image.upscale` | Upscale Image | `image`, `factor: enum ['2','4'] default '2'`, `engine: enum ['lanczos'] advanced` | `image` |
| `image.cropManual` | Crop Image Manual | `image`, `left/top/right/bottom: number` | `image` |
| `image.cropAuto` | Crop Image Auto | `image`, `mask: image?`, `padding: number default 0` | `image`, `region: image` (white rect on black, source size) |
| `image.pasteCrop` | Paste Crop Into Image | `image`, `crop: image`, `region: image` | `image` |
| `image.splitAlpha` | Split Alpha | `image` | `color: image`, `alpha: image` |
| `image.combineAlpha` | Combine Alpha | `color: image`, `alpha: image` | `image` |
| `image.splitChannels` | Split Image Channels | `image` | `r`, `g`, `b`, `a` (image) |
| `image.combineChannels` | Combine Image Channels | `r: image`, `g: image?`, `b: image?`, `a: image?` | `image` |
| `image.threshold` | Threshold Binary Mask | `image`, `threshold: number 0..255 default 128`, `invert: boolean default false` | `mask: image` |
| `image.rectMask` | Rect Mask | `image`, `left/top/right/bottom: number` | `mask: image` |
| `image.ellipseMask` | Ellipse Mask | `image`, `centerX/centerY/width/height: number` | `mask: image` |
| `image.filter` | Image Filters | `image`, `filter: enum ['blur','sharpen','grayscale','invert','brightness','contrast','saturation','posterize','edge']`, `amount: number 0..100 default 50` | `image` |
| `image.normalFromDepth` | Fast Normal from Depth | `depth: image`, `strength: number 0.1..10 default 2` | `normal: image` |
| `image.normalConvention` | Normal Map Convention Convert | `normal: image`, `to: enum ['opengl','directx']` | `normal: image` |

### Mesh

Generation (`runtime: 'meshy'`):

| id | title | inputs | outputs |
|---|---|---|---|
| `mesh.fromImage` | Image → 3D | `image: image`, `prompt: text?`, `model: enum ['meshy-7','meshy-6'] default 'meshy-7'`, `pose: enum ['a-pose','t-pose','none'] default 'a-pose'`, `texture: boolean default true`, `textureResolution: enum ['1k','2k','4k'] default '2k'`, `pbr: boolean default false advanced`, `remesh: boolean default false advanced` | `mesh: mesh` |

Processing (`runtime: 'blender'`):
| id | title | inputs | outputs |
|---|---|---|---|
| `mesh.optimize` | Optimize Mesh | `mesh`, `engine: enum ['quadriflow','voxel','decimate'] default 'quadriflow'`, `targetFaces: number 4..10000000 default 80000`, `topology: enum ['triangle','quad'] default 'triangle' advanced`, `voxelSize: number 0.001..1 default 0.01 advanced`, `preserveUVs: boolean default false advanced` | `mesh` |
| `mesh.autoTransform` | Auto Transform Mesh | `mesh`, `targetHeight: number default 1.8` (metres), `origin: enum ['bottom-center','center'] default 'bottom-center'`, `faceAxis: enum ['-Y','+Y','-X','+X','-Z','+Z'] default '-Y'` | `mesh` |
| `mesh.bboxFit` | Mesh BBox Fit | `mesh`, `width/height/depth: number` | `mesh` |
| `mesh.setOrigin` | Set Mesh Origin | `mesh`, `origin: enum ['bottom-center','center','top-center','min-corner']` | `mesh` |
| `mesh.rotateToAxis` | Rotate Mesh Towards Axis | `mesh`, `face: enum ['-Y','+Y','-X','+X','-Z','+Z']` | `mesh` |
| `mesh.render` | Mesh Multi-View Render | `mesh`, `yaw: number -180..180 default 35`, `pitch: number -89..89 default 15`, `size: number default 1024` | `image` |
| `mesh.extractTextures` | Extract Texture Maps | `mesh` | `baseColor`, `roughness`, `metallic`, `normal` (image) |
| `mesh.applyTextures` | Apply Textures to Mesh | `mesh`, `baseColor: image?`, `roughness: image?`, `metallic: image?`, `normal: image?`, `normalConvention: enum ['opengl','directx'] advanced` | `mesh` |
| `mesh.bake` | Bake High-Poly to Low-Poly | `high: mesh`, `low: mesh`, `resolution: number 256..4096 default 2048`, `bakeBaseColor/bakeRoughness/bakeMetallic/bakeNormal/bakeAO: boolean default true`, `aoSamples: number default 32 advanced`, `margin: number default 16 advanced` | `mesh` (low with baked textures applied), `baseColor`, `roughness`, `metallic`, `normal`, `ao` (image) |

`mesh.optimize`'s QuadriFlow and voxel remesh engines reconstruct topology and discard UVs. Pair remeshed output with `mesh.bake` to transfer textures from the source mesh. Quad output is available only with QuadriFlow; voxel and decimate output is triangulated. `preserveUVs` applies only to decimate.

### Output (`runtime: 'none'` — resolved by the bridge, no subprocess)

| id | title | inputs | outputs |
|---|---|---|---|
| `output.export` | Export to Folder | `mesh: mesh?`, `image: image?`, `folder: enum` (configured export-root labels), `name: text` | `path: text` (absolute exported path) |

Exactly one of `mesh` or `image` must be connected. The bridge rejects names containing path separators or `..`, copies the input to `<root>/<name>.<ext>`, and refuses a differing existing file. It writes `<root>/<name>.provenance.json` with the artifact hash and size, export/run/node identity, the complete ordered ancestor chain (`nodeId`, `toolId`, normalized `parameters`, and `inputHashes`), and available result metadata.

Excluded (no local model): Input Images/PDF(s)/Video/Audio/EXR/USDZ/Mixamo, Describe Image(s), Camera Control, Depth Estimation, Smart Resize, Find Images by Description, Image→SVG, Text→SVG, Split Image into Layers, Material Generation, Multi-View→3D, Retexture Mesh, Occlusion Mask, Project Multi-View, Text to Origin, Compose 3D Scene, Mask to Spline, Separate Object Parts, Rig/Animate, Omnipart, USDZ round-trip.

## Execution model (per node, not per graph)

The bridge executes nodes **one at a time in topological order**, each in its own subprocess. This is what makes per-node run, cancel, and caching simple.

Per-node request written to `<runDir>/nodes/<nodeId>/request.json`:
```json
{ "runId": "…", "nodeId": "shape:…", "toolId": "mesh.optimize",
  "inputs": { "mesh": { "path": "/abs/upstream/mesh.glb" }, "engine": "quadriflow", "targetFaces": 80000, "topology": "triangle" },
  "outputDir": "/abs/<runDir>/nodes/<nodeId>" }
```
File-typed inputs are `{ path }`; scalars are bare values. Worker writes every output to `outputDir` and then `outputDir/outputs.json`:
```json
{ "mesh": "mesh.glb", "preview": { "mesh": "mesh.preview.png" },
  "meta": { "mesh": "meshy.json" }, "log": "worker.log" }
```
Output keys are the tool's output port ids; values are filenames relative to `outputDir`. Optional `meta` keys are output port ids whose values name JSON sidecars; the bridge parses that JSON and attaches it to the corresponding result. `preview` is required for every `mesh` output (512×512 PNG, EEVEE, front 3/4 framed to bounds, neutral 3-point light, `#1a1a1a` background). Image outputs are their own preview. Non-zero exit or missing `outputs.json` = node failed; stderr tail becomes the error.

Worker CLIs:
- `python3 executor/image-worker.py <request.json>` — `runtime: 'image'` and `'imgen'` tools (imgen tools shell out to `imgen`).
- `/opt/homebrew/bin/blender --background --factory-startup --python executor/mesh-worker.py -- <request.json>` — `runtime: 'blender'` tools.
- `node executor/meshy-worker.mjs <request.json>` — `runtime: 'meshy'` tools. The backend loads repository-root `.env` without overriding existing environment variables; the worker requires `MESHY_API_KEY`.

Caching: the bridge keys each reusable node result by `sha256(toolId + version + canonical(inputs with file inputs replaced by their sha256))`. A cache hit skips the subprocess and reuses the outputs. `output.export` is intentionally not cached because it writes a run-specific provenance receipt. `POST /ateli/runs` accepts `"cache": false` to bypass; `DELETE /ateli/cache/:nodeId` clears one node's entries.

## HTTP API

Router configuration supplies export destinations as `createAteliRouter({ exportRoots: { label: '/absolute/path' } })`. `GET /ateli/tools` derives `output.export.folder.options` from those labels for that router instance.

- `GET /ateli/tools` → `Tool[]`; configured export-root labels appear as the `output.export.folder` enum options.
- `POST /ateli/sources` (multipart or `{ path }` JSON) → `{ sourceId, sha256, size, name, kind: 'image'|'mesh' }`. Path form must be inside an allowlisted root; multipart stores under `<staging>/sources/<sha256>.<ext>`.
- `POST /ateli/runs` `{ graph, scope, cache?: boolean }` → `202 { runId, status: 'queued' }`
  - `graph.nodes[]`: `{ id, toolId, toolVersion, parameters }` — `parameters` holds values for **unconnected** scalar/text inputs and `sourceId` for input file nodes.
  - `graph.edges[]`: `{ id, source: { nodeId, portId }, target: { nodeId, portId } }`
  - `scope`: `{ kind: 'graph' }` | `{ kind: 'node', nodeId }` (that node + its ancestors) | `{ kind: 'downstream', nodeId }` (node, ancestors, and descendants)
  - 400 on: unknown tool/version, missing required input, type mismatch, duplicate target port, cycle, unknown parameter key, scalar out of range, invalid export name, or an export with neither/both file inputs connected.
- `GET /ateli/runs/:runId` →
  ```json
  { "runId", "status": "queued|running|completed|failed|cancelled", "progress": 0.0,
    "nodes": { "<nodeId>": { "status": "queued|running|succeeded|failed|skipped|cached", "error"?: "…",
                             "outputs": { "<portId>": "<resultId>" } } } }
  ```
- `POST /ateli/runs/:runId/cancel` → kills the current subprocess group; remaining nodes `skipped`.
- `GET /ateli/results/:id` → `{ resultId, kind: 'mesh'|'image'|'text'|'number'|'boolean', name, size, sha256, value?, meta?, downloadUrl, previewUrl }` (`value` for scalar results; `meta` is parsed from an output's optional JSON sidecar).
- `GET /ateli/results/:id?download=1` streams the file. `GET /ateli/results/:id/preview` streams the preview PNG (mesh) or the image itself.
- Retained runs are rehydrated from `<runDir>/run.json` on startup.

## tldraw UI

Shapes (both already exist in `src/ateli-node-shape.tsx`; keep the port-anchor math and the `ateli-edge` path computation):
- `ateli-node` props `{ w, h, toolId, values: json, results: json, collapsed: boolean }`
  - `values`: `{ [paramId]: scalar | sourceId }`
  - `results`: `{ [outputPortId]: { resultId, previewUrl, kind, value? } }`, plus `error?: string`, `status?: 'running'|'failed'`
- `ateli-edge` props `{ from, fromPort, to, toPort, valueType }`

Interaction (Atlas parity):
- **Drag from an output dot** draws a live edge following the pointer (render as an overlay in the edge color); drop on a compatible input dot creates the edge; drop elsewhere cancels. Compatible inputs highlight while dragging; incompatible ones dim.
- **Drag an existing edge's end** off its input dot to detach and re-drop on another input (or empty canvas to delete).
- Dropping on an occupied input replaces the previous edge. Type mismatch, self-connection, and cycles are refused.
- Header: title · `⋯` menu (Clear results, Clear cache, Collapse) · `▶` run this node (`scope: node`) · `▶▶` run downstream.
- Rows: inputs then outputs. Scalar/text/enum inputs show an inline control (`ui-well`), disabled and showing the upstream value when connected. `Advanced N ›` collapses `advanced` params.
- Preview under rows: `mesh` → `<img previewUrl>`; `image` → thumbnail; multiple image outputs → thumbnail row; text/number/boolean → the value. Empty placeholder frame otherwise.
- Node error shows inline under the rows in `#f87171`. Running state shows a thin progress bar under the header.
- Command bar entries: one "Add <title>" per tool, grouped by category, plus "Create sample graph" (Input Mesh → Optimize → Extract Textures → Apply Textures, with an Input Image → Image Filters → Apply Textures.baseColor branch).
- Styling: `ui-panel`, `ui-rule-bottom`, `ui-key`, `ui-well`, `ui-label` from `src/ui.ts`. No status footers, no tool-id text, no category eyebrow.
- Client `src/ateli-client.ts`: `tools()`, `uploadSource(file)`, `run(graph, scope)`, `status(runId)`, `result(id)`. Graph serialization from the page's shapes; poll 750 ms; write `results`/`error`/`status` back into node props; stop polling on terminal status.

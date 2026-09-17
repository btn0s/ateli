# Atlas AI Studio node-workflow patterns for Ateli

**Evidence date:** 2026-09-16  
**Version context:** Atlas documentation lists **0.33.0 (September 2026)** as the latest release at the time of review. The topic pages do not expose individual publication or last-updated dates in their Markdown output, so claims without an explicit release number should be read as current documentation claims on the evidence date. [Release index](https://docs.atlas.design/atlas-ai-studio-overview/release-notes.md) · [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md)  
**Scope:** Atlas's documented visual editor, workflow execution, outputs, reproducibility, 3D processing, and Blender/API integration, considered as design input for Ateli: a fully local tldraw canvas → local bridge → headless Blender system.  
**Evidence policy:** **Observed fact** means an Atlas first-party page states or visibly demonstrates it. **Applicability inference** means a design lesson for Last Light, not a claim about Atlas internals. **Unknown** means the reviewed first-party material does not establish it. Marketing statements are identified as such and are not treated as implementation specifications.

## Executive summary

### Observed facts

- Atlas presents a node-based visual editor in which each node is a discrete generation, transformation, utility, input, or API capability; connected nodes form reusable workflows. Atlas describes those workflows as reproducible, versioned, shareable, and exportable. [Atlas overview](https://docs.atlas.design/atlas-ai-studio-overview.md) · [Node Index](https://docs.atlas.design/atlas-ai-studio-overview/node-index.md) · [Getting Started](https://docs.atlas.design/atlas-ai-studio-overview/getting-started.md)
- The documented canvas is not only a graph diagram. It provides select, pan, section, comment, note, zoom, alignment, distribution, node-creation, assistant, and output-inspection interactions. Atlas 0.33 also added an asset browser whose items can be dragged onto the canvas to create an appropriate input node. [0.31.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.31.0.md) · [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md)
- Atlas distinguishes interactive graph construction from deployed execution. A workflow can be exported as a versioned REST API by marking external inputs and outputs with API nodes. API execution is async-only: submission returns an `execution_id`, the client polls status, then downloads results. [API Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/api-nodes.md)
- Atlas treats outputs as inspectable assets. Current release material documents previews, downloads, provenance and file details, cross-project reuse by file ID, filters for uploaded versus generated origin, and workspace publication rules. [0.31.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.31.0.md) · [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md)
- Atlas documents substantial 3D operations: importing existing GLB meshes, image- or multiview-to-3D, retexturing, texture-map extraction/application, scale/pivot/orientation correction, retopology, polycount reduction, UV work, baking, part separation, rigging, animation, and scene composition. [Input Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/input-nodes.md) · [Mesh Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mesh-nodes.md) · [3D & Gaming Focus](https://docs.atlas.design/atlas-ai-studio-overview/3d-and-gaming-focus.md)
- Atlas says workflows can run from Blender and that it integrates through a Blender add-on or ordinary API calls from Blender scripts/headless environments. The reviewed public API page provides official plugin links only for Unity and Unreal, not a Blender add-on repository or installation guide. [Getting Started](https://docs.atlas.design/atlas-ai-studio-overview/getting-started.md) · [API Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/api-nodes.md)

### Applicability inference for Last Light

The useful pattern is **a visual, inspectable control plane over typed asset transformations**, not Atlas's cloud model catalog or multi-agent system. Ateli should describe a small local graph in tldraw; the existing bridge should own scheduling, process isolation, receipts, and filesystem writes; headless Blender should perform deterministic processing of already-generated meshes; and only validated derived results should become runtime-consumable assets.

The strongest output-lineage lesson is to preserve sources rather than rely on regeneration. Atlas's latest release exposes a pre-remeshed GLB on supported Meshy generation paths and separately records provenance and file metadata, but Atlas does **not** publicly state that originals are immutable. [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md) For Last Light, immutable raw Meshy outputs are therefore a project rule, not an Atlas behavior: every Blender operation must write a new derived result linked to the raw source by identity and content hash.

### Boundary

Atlas itself is not evidence that the proposed system can be fully local. Atlas says it runs on GCP-native infrastructure and is exclusively available through Google Cloud Marketplace. [Atlas x GCP](https://docs.atlas.design/atlas-ai-studio-overview/atlas-x-gcp.md) Ateli should borrow interaction and provenance patterns while deliberately replacing Atlas's hosted execution plane with the existing local bridge and headless Blender.

### Current integration boundary

For the POC, Ateli is a tool and graph system inside tldraw Offline. The mod presents nodes and results; the existing local bridge validates and coordinates runs; headless tools perform declared operations. The canvas never invokes Blender or arbitrary commands directly.

## 1. Documented workflow and editor model

### 1.1 Nodes are capabilities; edges compose a pipeline

**Observed facts.** Atlas defines a node as a discrete capability: a model that generates content, a transform that processes it, a utility that routes data, or an API surface that exposes the workflow. Its documented categories are input, image, mesh, video, audio, API, and utility nodes. [Node Index](https://docs.atlas.design/atlas-ai-studio-overview/node-index.md)

The input layer makes workflow boundaries visible. Inputs include text, numbers, booleans, images, image arrays, meshes, documents, video, audio, EXR, and USDZ. Atlas specifically documents using an Input Mesh to bring an existing GLB into a workflow for retopology, retexturing, or rigging without regenerating its geometry. [Input Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/input-nodes.md)

Utility nodes provide explicit glue rather than hiding all orchestration in prompts. Document extraction, text composition, ordered lists, array splitting/merging, structured JSON output, and PNG metadata extraction are visible graph operations. Atlas warns against inserting an LLM where deterministic string concatenation is sufficient because doing so adds unnecessary variability. [Utility Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/utility-nodes.md)

**Applicability inference.** A Last Light node should expose one meaningful asset operation with a narrow input/output contract. Edges should carry references to typed values or files, not embed mutable binary assets in tldraw shapes. Deterministic local transforms—path resolution, manifest creation, validation, naming, and promotion—should remain ordinary code, not agent or LLM calls.

### 1.2 The canvas combines graph authoring, organization, and inspection

**Observed facts.** Atlas 0.31 documents a floating toolbar with select, pan, section, comment, and note tools; zoom controls; node alignment/distribution shortcuts; and a categorized node-creation menu. The same release documents a resizable assistant panel with visible tool progress, a Run nodes control, and Send/Stop behavior. [0.31.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.31.0.md)

Atlas 0.32 adds a first-canvas tour covering the toolbar, nodes, runs/results, Atlas AI, and exports. Assistant responses can contain interactive node references that highlight and center a node on the canvas. [0.32.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.32.0.md)

Atlas 0.33 adds inline renaming for sections and groups and a workspace asset browser. An image, 3D model, video, audio file, PDF, SVG, or EXR can be previewed and dragged onto the canvas to create the corresponding input node. [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md)

The product page visually presents node-local parameters—for example model, seed, aspect ratio, 3D backend, and geometry mode—inside a connected text → image → 3D graph. This is a product demonstration, not a public schema specification. [Atlas product page](https://atlas.design/#try)

**Applicability inference.** The tldraw POC needs only the interactions that shorten the local asset loop:

1. create and connect a small set of known node kinds;
2. select one node or a downstream branch to run;
3. show parameters on the node or in one inspector;
4. display queued/running/succeeded/failed/stale state in place;
5. open the produced GLB, preview, log, and validation report from the result; and
6. group/comment the graph only enough to explain why a processing choice exists.

Atlas's broad editing surface is evidence that organization and inspection matter, but it is not a reason to reproduce every shortcut, annotation type, assistant feature, or media category in the first POC.

### 1.3 The assistant builds workflows; exported workflows run without it

**Observed facts.** Atlas describes its AI Agent as a multi-agent workflow-construction layer that proposes graphs, chooses hyperparameters, diagnoses output, and helps discover nodes. Atlas explicitly says that an exported API runs the workflow itself, not the agent. [Atlas AI Agent](https://docs.atlas.design/atlas-ai-studio-overview/atlas-ai-studio-overview.md)

**Applicability inference.** No agent is required for the Last Light POC. The graph should remain directly readable and executable without conversational state. If natural-language assistance is explored later, it should produce ordinary graph edits and never become a hidden runtime dependency.

## 2. Execution, state, artifacts, and reproducibility

### 2.1 Execution model that is publicly documented

**Observed facts.** For an interactive image-to-3D node, Atlas documents the user connecting an image, selecting a backend, clicking **Run**, and receiving a 3D preview, wireframe preview, and downloadable GLB that can feed later mesh nodes. [3D Generation Best Practices](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mesh-nodes/3d-generation-best-practices.md)

For external execution, Atlas requires explicit API input and output nodes. Export captures the graph state at export time and assigns an API ID. Later editor changes do not alter the deployed API; re-exporting creates the rollout boundary, and different versions can coexist. Execution is asynchronous and uses submit → `execution_id` → status polling → result download. [API Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/api-nodes.md)

Atlas 0.33 documents a visible waiting state while its browser assistant waits for a subscribed node: the UI explains the wait, retains a Stop action, and locks model/run settings until completion or cancellation. It also documents per-node estimated cost, last-run cost, and cached status in the run area. [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md)

**Applicability inference.** The local bridge should expose the same useful separation without copying Atlas's API:

```text
tldraw graph snapshot
    → bridge accepts run and returns run ID
    → bridge resolves upstream artifact references
    → bridge invokes headless Blender with pinned operation parameters
    → Blender writes a new derived artifact in a staging location
    → validator checks the candidate
    → bridge atomically records success or failure plus manifest
    → canvas displays result; runtime catalogue sees only promoted outputs
```

A run ID and explicit state are more important than sophisticated scheduling. The POC can use a single local worker and a small state set; concurrency, retries, and distributed queues are not prerequisites.

### 2.2 Artifact model and provenance

**Observed facts.** Atlas 0.31's viewer reports file properties and, for 3D files, topology, vertex/triangle counts, physical dimensions, and texture resolutions; it also offers material/debug views such as normals, roughness, metallic, part colors, and wireframe. [0.31.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.31.0.md)

Atlas 0.33 documents a workspace asset browser with filters for source project, creator, uploaded/generated origin, browser/API upload source, and media subtype. The asset viewer exposes provenance and file details including source, creation date, size, dimensions, and mesh statistics. Workspace-authorized files can be reused by file ID in API workflows and downloaded through an authenticated result endpoint. [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md)

Atlas 0.33 also documents publication semantics: enabling Team access publishes current and subsequently added project files; published files remain available to workspace members even if the source project later becomes private or is deleted. This is a sharing/retention rule, not proof of content-addressed or immutable storage. [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md)

**Applicability inference.** Store graph state and artifacts separately. A node result should reference a manifest containing at least:

- run ID and node ID;
- source artifact ID/path and SHA-256;
- graph revision or snapshot hash;
- operation name and normalized parameters;
- Blender version and bridge version;
- command outcome, timestamps, and diagnostic log path;
- derived artifact path and SHA-256;
- compact validation facts such as format, scene/object count, triangles, materials/textures, dimensions, and animation clips; and
- promotion status.

The raw Meshy file must remain read-only. A Blender node may consume it but must write beside it or into a derived/staging tree. Re-running creates another candidate or resolves to an already-recorded identical derivation; it never overwrites the raw source.

### 2.3 Reproducibility: what Atlas says and what it does not prove

**Observed facts.** Atlas describes connected nodes as reproducible and versioned, and says full versioning provides deterministic, reproducible results and quality control. [Atlas overview](https://docs.atlas.design/atlas-ai-studio-overview.md) · [Getting Started](https://docs.atlas.design/atlas-ai-studio-overview/getting-started.md) Its API documentation gives the more concrete guarantee that an API ID executes the exact exported graph/version rather than silently adopting later editor edits. [API Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/api-nodes.md)

Atlas also documents extracting prompt, seed, model identifier, and generation parameters from compatible PNG metadata for reuse and audit trails. [Utility Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/utility-nodes.md) The product page depicts prompt, model, locked seed, approval, credit use, and “Re-run exact” as an asset history, but it does not define the technical equality promised by “exact.” [Atlas product page](https://atlas.design/#governance)

**Unknown.** The public sources reviewed do not establish byte-for-byte determinism across generative backends, the cache-key algorithm, whether remote model revisions are permanently pinned, or whether every output format carries a portable provenance record.

**Applicability inference.** For Last Light, reproducibility should mean **the accepted artifact and its complete local recipe are retained**, not that a third-party generator can recreate identical bytes later. Blender processing is more controllable, but pinning the Blender version, script/bridge version, source hash, and parameters is still required.

## 3. Documented 3D capabilities relevant to the POC

| Atlas capability (observed fact) | Direct evidence | POC-relevant lesson (inference) |
| --- | --- | --- |
| Existing GLB meshes can enter through Input Mesh and be refined without regenerating geometry. | [Input Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/input-nodes.md) | Make externally generated raw meshes explicit source nodes; generation stays outside this runtime. |
| Auto Transform Mesh corrects semantic scale/dimensions and origin; separate nodes fit a world-space bounding box, set origin, and rotate toward an axis. | [Mesh Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mesh-nodes.md) | Keep scale, orientation, and pivot normalization visible and parameterized rather than burying them in an import script. |
| Optimize Mesh supports target polygon counts and triangle/quad topology; Atlas also documents reduction, UV, baking, and engine-specific checks. | [Mesh Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mesh-nodes.md) · [3D & Gaming Focus](https://docs.atlas.design/atlas-ai-studio-overview/3d-and-gaming-focus.md) | Treat optimization as a derived branch with measurable acceptance limits, never as an in-place rewrite of the source. |
| Texture maps can be extracted from a GLB, edited separately, and reapplied selectively; normal-map convention can be converted to glTF/OpenGL. | [Mesh Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mesh-nodes.md) | Texture processing needs explicit artifact inputs/outputs and format conventions in the manifest. |
| Mesh Multi-View Render outputs images and camera matrices; occlusion masks and projection nodes support controlled reprojection. | [Mesh Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mesh-nodes.md) | A preview is an output artifact with camera/config metadata, not just transient canvas decoration. |
| The viewer exposes wireframe, normals, material channels, mesh statistics, dimensions, and animation-clip selection. | [0.31.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.31.0.md) · [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md) | Put validation evidence next to the node result so users do not need to open Blender for every pass/fail decision. |
| Supported Meshy v6/v7 paths can expose the pre-remeshed GLB in addition to later output. | [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md) | Preserve the upstream mesh and create a lineage of derived assets. Atlas does not document immutability, so Last Light must enforce it itself. |

Atlas's broader 3D catalog also includes image/multiview generation, PBR texturing, part splitting, rigging, animation, and scene composition. [Mesh Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mesh-nodes.md) These show that a graph can span an asset lifecycle, but they are not all required for the local Blender proof of concept.

## 4. Blender and integration boundary

### Observed facts

- Atlas says workflows can be run from inside Blender and describes direct integration through a Blender add-on. [Atlas overview](https://docs.atlas.design/atlas-ai-studio-overview.md) · [Getting Started](https://docs.atlas.design/atlas-ai-studio-overview/getting-started.md)
- Atlas's API documentation explicitly lists Blender scripts, command-line tools, and server-side/headless production environments as callers of exported workflows. [API Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/api-nodes.md)
- Exported workflows use explicit external input/output nodes. Mesh API inputs accept GLB or OBJ, while mesh API outputs return mesh files. Calls are async-only and file upload is a separate step that returns a `file_id`. [API Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/api-nodes.md)
- Atlas links official Unity and Unreal plugins from the API documentation. The reviewed pages mention a Blender add-on but provide no equivalent public add-on link, installation instructions, supported Blender versions, or behavior contract. [API Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/api-nodes.md) · [Getting Started](https://docs.atlas.design/atlas-ai-studio-overview/getting-started.md)
- Atlas is a hosted GCP-native product, not a documented offline engine. [Atlas x GCP](https://docs.atlas.design/atlas-ai-studio-overview/atlas-x-gcp.md)

### Applicability inference

Do not model the local bridge as a Blender UI add-on. For the POC, the cleaner seam is a local process boundary:

- tldraw edits graph state and submits runs;
- the bridge validates the graph snapshot and resolves local files;
- the bridge starts Blender headlessly with a pinned script/operation contract;
- Blender reads source assets and writes only staged derived outputs;
- the bridge validates and records results; and
- the game/runtime sees only explicitly promoted, validated assets.

This preserves offline operation and makes Blender replaceable at the execution seam without introducing a generalized plugin framework.

## 5. Explicit unknowns and documentation limits

The following are **not established** by the reviewed official material:

1. **Graph serialization and schema:** node/edge IDs, typed-port encoding, migration format, cycle prevention, and how project versions are stored.
2. **Dependency invalidation:** the exact rule for marking downstream outputs stale after a parameter, node, or source asset changes.
3. **Scheduler semantics:** topological scheduling, partial-branch execution, concurrency limits, retry policy, crash recovery, cancellation guarantees, and transactional behavior.
4. **Cache semantics:** cache-key inputs, whether cache entries are content-addressed, eviction/retention, and whether cached generative results remain valid after provider-model updates.
5. **Artifact immutability:** Atlas documents provenance, reuse, publication, and pre-remeshed outputs, but does not say raw or generated files are immutable or append-only.
6. **Deterministic equality:** Atlas markets deterministic/reproducible workflows but does not define whether reruns are byte-identical, visually equivalent, or merely based on the same recorded graph and parameters.
7. **Portable run manifests:** no reviewed page specifies a downloadable, tool-neutral manifest containing every node input, model revision, output hash, and environment version.
8. **Blender add-on contract:** public location, supported versions, whether it embeds graph editing or only calls exported APIs, update policy, and headless behavior.
9. **Offline/self-hosted execution:** the reviewed deployment page instead describes Atlas as GCP-native and exclusively available through Google Cloud Marketplace. [Atlas x GCP](https://docs.atlas.design/atlas-ai-studio-overview/atlas-x-gcp.md)
10. **MCP's exact current capability:** the standalone MCP page still describes the alpha agent as stateless and unable to run nodes, while the newer 0.33 release says `prompt_project_agent` can build, run or schedule nodes, wait, and inspect results. The release note is the later dated source, but the public documentation is internally inconsistent. [MCP page](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mcp.md) · [0.33.0 release notes](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md)

These gaps are reasons to keep the local contract explicit, not invitations to infer Atlas's internals.

## 6. Concise implications for Ateli

1. **Use Atlas as an interaction reference, not a dependency.** Ateli remains fully local and does not call Atlas, Meshy, or another generator at runtime.
2. **Build one system with four responsibilities:** source references, processing, validation, and promotion/export. Mesh optimization is Ateli's first node set, not a separate “mesh workflows” subsystem.
3. **Keep raw Meshy outputs immutable.** A source node records path/ID and hash. Every processing run writes a new derived candidate and receipt; no node has permission to replace its input.
4. **Make execution observable.** Return a run ID immediately, show queued/running/succeeded/failed/stale state on the canvas, retain Stop where safe, and link the Blender log and validation report from the result.
5. **Separate graph snapshots from files.** tldraw stores layout and declarative node configuration; the bridge owns filesystem access, process execution, receipts, and result IDs.
6. **Validate before the runtime boundary.** A successful Blender exit is not publication. The bridge must validate the output contract, then promote the accepted GLB atomically. The game consumes only that validated catalogue/path.
7. **Define reproducibility as provenance plus retained results.** Hash sources and outputs; pin Blender and bridge/script versions; normalize parameters; retain the exact accepted output. Do not promise that cloud generation can be replayed identically.
8. **Avoid premature breadth.** Do not add Atlas-like agents, team permissions, cloud APIs, model catalogs, generalized media nodes, distributed execution, or a Blender GUI add-on to prove Ateli's local canvas/bridge/Blender seam.
9. **Make the canvas the product surface.** Tool discovery, typed connections, parameters, run scope, progress, stale state, previews, errors, logs, and receipts should be inspectable in tldraw rather than hidden behind the bridge.

A successful Ateli POC demonstrates one short loop end to end: select an immutable raw mesh, run visible local Blender transformations from the canvas, inspect the new candidate and its validation facts, promote it without overwriting the source, and load the promoted output through Last Light's existing runtime asset path.

## Primary sources reviewed

- [Atlas AI Studio Overview](https://docs.atlas.design/atlas-ai-studio-overview.md)
- [Getting Started](https://docs.atlas.design/atlas-ai-studio-overview/getting-started.md)
- [Atlas AI Agent](https://docs.atlas.design/atlas-ai-studio-overview/atlas-ai-studio-overview.md)
- [3D & Gaming Focus](https://docs.atlas.design/atlas-ai-studio-overview/3d-and-gaming-focus.md)
- [Atlas x GCP](https://docs.atlas.design/atlas-ai-studio-overview/atlas-x-gcp.md)
- [Node Index](https://docs.atlas.design/atlas-ai-studio-overview/node-index.md)
- [Input Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/input-nodes.md)
- [Mesh Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mesh-nodes.md)
- [3D Generation Best Practices](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mesh-nodes/3d-generation-best-practices.md)
- [Utility Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/utility-nodes.md)
- [API Nodes](https://docs.atlas.design/atlas-ai-studio-overview/node-index/api-nodes.md)
- [MCP](https://docs.atlas.design/atlas-ai-studio-overview/node-index/mcp.md)
- [Release 0.31.0 (July 2026)](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.31.0.md)
- [Release 0.32.0 (August 2026)](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.32.0.md)
- [Release 0.33.0 (September 2026)](https://docs.atlas.design/atlas-ai-studio-overview/release-notes/release-0.33.0.md)
- [Atlas product page](https://atlas.design/)

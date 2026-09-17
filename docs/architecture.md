# Architecture

Ateli is a visual node graph built from native tldraw Offline custom shapes: `ateli-node` cards and `ateli-edge` connections. tldraw owns node placement, selection, graph persistence, panning, and zooming. The existing loopback bridge coordinates headless execution.

## System

```text
tldraw Offline
  ├─ Ateli node tool and registry commands
  ├─ ateli-node custom shapes
  ├─ typed input and output ports (material slots are individual ports)
  ├─ ateli-edge custom shapes anchored to ports
  ├─ type, single-input, and cycle validation
  └─ persisted native graph
       │
       ▼
existing loopback bridge on 127.0.0.1:7237
  ├─ tool registry
  ├─ graph validation
  ├─ run queue and cancellation
  ├─ retained-run rehydration
  ├─ source/result storage
  └─ headless executors
       └─ Blender for the first POC
```

Repository ownership follows the runtime seams:

- `mod/config.tsx` composes the document script from `mod/skin/`, `mod/canvas/`, and `mod/graph/`;
- `server/backend.mjs` owns the loopback service and mounts `server/router.mjs`;
- `executor/` contains the fixed image and Blender workers;
- `build/` contains the esbuild, installer, and Tailwind tooling;
- `bin/ateli` exposes install, serve, and smoke commands; and
- `test/` covers the router and workers.

Ateli owns one coherent model:

- tools declare typed capabilities;
- nodes are configured visual instances of tools;
- edges move typed values between ports;
- a graph describes a computation;
- a run executes a frozen graph snapshot;
- results and receipts make execution inspectable;
- promotion explicitly hands an accepted candidate to a consuming project.

Mesh processing is the first tool family. The same graph and run model must support image generation and editing, maps, structured data, materials, animation, file conversion, local automation, and remote services without creating a new subsystem for each domain.

## Tool definitions

A tool definition is declarative and versioned:

```ts
interface AteliToolDefinition {
  id: string
  version: number
  title: string
  category: string
  description: string
  inputs: AteliPortDefinition[]
  outputs: AteliPortDefinition[]
  parameters: AteliParameterDefinition[]
  presentation?: AteliToolPresentation
}
```

Tool IDs describe capability rather than executor:

```text
input.file
input.mesh
image.generate
image.resize
map.import
map.validate
mesh.inspect
mesh.decimate
mesh.transfer-normals
mesh.bake-detail
output.promote
```

`mesh.decimate` must not become `blender.decimate`; Blender performs the tool today but does not define its meaning.

A node stores its tool ID and version, normalized parameters, dimensions, and viewport position. It never stores an executable command. The bridge maps supported tool IDs to allowlisted handlers.

## Graph model

A saved graph contains:

- schema version;
- stable node IDs;
- tool IDs and versions;
- normalized parameter values;
- typed port connections;
- viewport layout;
- optional references to retained results.

It does not contain:

- GLB, image, video, or other large result bytes;
- arbitrary commands or source code;
- executable paths;
- bridge process state;
- transient progress events.

Before starting a run, the bridge validates:

- every tool and version is available;
- required inputs are connected;
- source references resolve;
- connected port types are compatible;
- parameters satisfy the tool schema;
- the graph has no execution cycle; and
- requested tools and paths are allowed.

The validated graph is frozen and hashed for that run. Canvas edits made afterward create stale state but do not mutate the active run.

## Node-graph UX

### Tool discovery

The palette is searchable and grouped by stable categories such as Inputs, Images, Maps, Meshes, Materials, Data, Validation, and Outputs. A palette item shows the tool name, short purpose, input/output shape, and availability. Dragging or selecting it creates a node with valid defaults.

The palette is driven by the Ateli tool registry rather than a hand-written menu per tool. Saved nodes remain visible when a tool is temporarily unavailable and clearly show that unavailable state.

### Node shell

Every node uses one shared shell containing:

- tool title and category;
- typed input ports on the left and output ports on the right;
- essential parameters;
- current run state;
- last successful result summary;
- warning or error count;
- Run and overflow actions.

Specialized tools may provide a focused parameter editor or result view inside that shell. They do not reimplement selection, connection, status, resizing, or run controls.

### Connections

A connection may be created only when its source and target port types are compatible. While dragging:

- compatible targets are emphasized;
- incompatible targets explain the mismatch;
- occupied single-input ports show replacement behavior;
- dropping on empty canvas may offer compatible downstream tools.

Deleting a node deletes its edges. Connecting an occupied input replaces the existing edge.

### Run scope

Ateli exposes four scopes:

- **Run node**: execute the selected node using retained upstream results when valid;
- **Run to here**: execute stale or missing ancestors and then the selected node;
- **Run downstream**: execute the selected node and reachable descendants;
- **Run graph**: execute every required stale or missing node in the graph.

The chosen scope is highlighted before submission. Ateli never silently runs unrelated branches.

### State

Node presentation distinguishes:

```text
idle
stale
queued
running
succeeded
failed
cancelled
unavailable
```

Transient run progress remains in React state. Graph configuration and final node summaries persist in local storage, while the bridge rehydrates retained runs and result IDs from disk after restart.

Editing a parameter, changing a source, or reconnecting an input marks that node and all descendants stale. The last successful result remains inspectable until a replacement succeeds.

### Results and inspection

A successful node exposes result cards appropriate to its output types:

- images and texture channels as visual previews;
- meshes as thumbnails, wireframes, normal/material views, and geometry facts;
- maps through a spatial preview and layer metadata;
- structured data through tables or formatted JSON;
- files through identity, size, hash, and reveal/download actions;
- validation through pass/fail checks and evidence;
- receipts through sources, parameters, versions, timing, and result hashes.

Errors attach to the responsible node, parameter, or port. A global run panel may summarize execution, but it must not be the only place where failures can be understood.

### Canvas organization

tldraw owns panning, zooming, selection, node geometry, and persistence. Edges are `ateli-edge` shapes that compute their path from the referenced nodes' port anchors, so they follow node moves without bindings. Execution order comes from edge metadata, never visual position. Large results remain in the bridge-managed result store and are re-indexed from run receipts at startup.

## Bridge API

The Ateli browser client is the only graph module aware of HTTP. Initial routes are:

```text
GET  /ateli/tools
POST /ateli/sources/resolve
POST /ateli/runs
GET  /ateli/runs/:runId
POST /ateli/runs/:runId/cancel
GET  /ateli/results/:resultId
POST /ateli/candidates/:candidateId/promote
```

`POST /ateli/runs` accepts a frozen graph request and returns a run ID immediately. The client polls status for the POC. WebSockets, distributed queues, automatic retries, and concurrent worker pools are unnecessary until measured use requires them.

## Headless execution

The bridge owns executor process lifecycle. For Blender tools it invokes a fixed worker:

```text
/opt/homebrew/bin/blender
  --background
  --factory-startup
  --python <fixed-ateli-worker.py>
  --
  <validated-run-request.json>
```

The graph never supplies the executable or Python path. `--factory-startup` keeps user preferences and add-ons out of the run.

Each run receives an immutable working directory containing:

```text
request.json
progress.ndjson
executor.log
results/
validation.json
receipt.json
```

A cancelled, failed, or incomplete run cannot produce a promotable candidate. The bridge terminates the process tree it started and retains enough failure evidence for the canvas to explain what happened.

## Results and receipts

Sources and results are referenced by opaque IDs. The bridge resolves local paths and records them in the receipt; node records do not pass arbitrary paths into executors.

A receipt records:

- graph snapshot and hash;
- source identities and content hashes;
- tool definitions and versions;
- normalized parameters;
- executor and environment versions;
- node status and timing;
- result identities, media types, and hashes;
- validation findings;
- logs and failure details;
- promotion outcome when applicable.

Producing a result is not promotion. Promotion requires a passing candidate, a declared destination, and an explicit canvas action.

## Adding tools

Adding a capability requires only the pieces it uses:

1. a versioned tool definition;
2. an allowlisted headless handler;
3. parameter validation;
4. an optional specialized parameter editor;
5. an optional result inspector; and
6. result-specific validation where appropriate.

A checked-in registry is sufficient for the POC. Ateli does not need arbitrary runtime plugins or a marketplace to prove that images, maps, meshes, and other tools can share the same graph.

## Security

- Tools invoke registered handlers; graphs never name executables.
- Source access is mediated by the bridge.
- Inputs and parameters are validated before process creation.
- The bridge continues to bind only to loopback and enforce allowed origins.
- Result serving uses known IDs rather than arbitrary path reads.
- Partial, failed, stale, or cancelled results cannot be promoted.
- Remote-service tools must explicitly declare network and credential requirements when introduced.

## First proof

The Last Light high-to-low mesh graph exercises the system's difficult parts: branching, typed ports, multiple result types, long-running headless work, validation, provenance, cancellation, and promotion.
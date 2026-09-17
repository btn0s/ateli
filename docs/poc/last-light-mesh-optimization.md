# Last Light mesh-optimization POC

## Purpose

Prove Ateli end to end using the high-to-low character mesh pipeline currently being developed in the sibling Last Light project. The proof must exercise a real native tldraw graph, the existing local bridge, headless Blender, retained results, validation, and explicit promotion.

This is Ateli's first integration, not its product boundary. Meshes, Blender, and Last Light remain tool-, executor-, and consumer-specific concepts outside Ateli's core graph model.

## Existing environment

- Last Light checkout: `../games/last-light`
- Graph surface: native `ateli-node` and `ateli-edge` shapes in `../tldraw-offline/Ateli POC.tldraw`
- Loopback bridge checkout: `../tldraw-offline`
- Current local bridge: `127.0.0.1:7237`
- Headless executor: Blender 5.1.2 at `/opt/homebrew/bin/blender`
- Canonical input: `../games/last-light/client/public/character-experiments/drifters-light-default/meshy-7-master-raw.glb`

The raw input is immutable. POC staging belongs under `../games/last-light/.scratch/ateli/<run-id>/`; promotion into a Last Light catalogue is a separate explicit action.

## Observed baseline

Headless Blender inspection of the canonical input reported:

- 426,002 vertices;
- 788,558 triangular polygons;
- 2,365,674 loops;
- one UV layer;
- a `custom_normal` mesh attribute.

A geometry-only decimation smoke run targeted 50,000 polygons and produced:

- 43,208 vertices;
- 49,999 polygons;
- 149,997 loops;
- one retained UV layer;
- a retained `custom_normal` attribute;
- 15.25 seconds spent applying the modifier;
- 93.66% polygon reduction.

This proves local processing feasibility, not visual quality. Retaining an attribute does not prove that its values remain appropriate after topology changes.

## Normal-data decision

The graph must distinguish:

1. custom split normals attached to mesh corners; and
2. tangent-space normal maps sampled through UVs.

Topology changes invalidate index-based assumptions about custom normals. The POC therefore keeps the high mesh as an immutable projection source, establishes final shading normals on the low mesh, then bakes high-frequency detail onto the low mesh's final tangent basis. It must not pretend that normals can be detached and reattached blindly.

## Graph

```text
Mesh Source
 ├─ Inspect Mesh
 ├─ Extract Material Channels ──────────────────────────┐
 └─ Decimate Mesh                                       │
      └─ Transfer Shading Normals ◀── original high     │
           └─ Bake High to Low ◀────── original high    │
                └─ Assemble GLB ◀───────────────────────┘
                     └─ Validate and Compare ◀── source
                          └─ Promote Candidate
```

Initial tool definitions:

| Tool ID | Inputs | Results | Responsibility |
| --- | --- | --- | --- |
| `input.mesh` | host-selected source | mesh source reference | Resolve and hash the immutable GLB. |
| `mesh.inspect` | mesh | mesh report | Record geometry, transforms, UVs, materials, normals, rigging, and animation facts. |
| `material.extract` | mesh | material channels | Separate available texture channels and their color-space/convention metadata. |
| `mesh.decimate` | mesh, target count | low mesh | Apply controlled collapse decimation while preserving required boundaries. |
| `mesh.transfer-normals` | high mesh, low mesh | shaded low mesh | Spatially transfer custom normals without index copying. |
| `mesh.bake-detail` | high mesh, low mesh | normal map and optional maps | Bake selected-to-active detail onto the final low tangent basis. |
| `mesh.assemble` | low mesh, materials, baked maps | candidate GLB | Construct and export the derived candidate. |
| `mesh.validate` | source mesh, candidate mesh | validation report and previews | Compare structure, dimensions, materials, topology, and fixed-view renders. |
| `output.promote` | passing candidate | promotion receipt | Atomically adopt an approved candidate into Last Light. |

## Current deployment

```text
tldraw Offline native Ateli graph
  → typed nodes, per-slot material ports, and custom edges
  → one queued local run
  → Blender --background --factory-startup
  → fixed Ateli Blender worker
  → staged results and receipt
  → retained result inspection and explicit promotion
```

`--factory-startup` prevents user add-ons from entering deterministic headless runs and avoids the installed Blender MCP add-on's current port collision on `8765`.

## Implemented proof

The canonical graph completed through the loopback bridge with all nine nodes successful. The run produced a 49,999-triangle, 5,918,480-byte GLB, a 1024×1024 tangent-space normal map marked `Non-Color` with the glTF/OpenGL `+Y` convention, fixed-camera shaded/wireframe/normal evidence, validation, logs, and a provenance receipt.

Explicit promotion installed:

- `/character-experiments/drifters-light-default/meshy-7-ateli.glb`
- `/character-experiments/drifters-light-default/meshy-7-ateli.receipt.json`

The source SHA-256 remains `019db6d2cd85c5d07f3cc4d55dbe1613db42894acdb08c521f8d73ad90003bb8`. The promoted candidate SHA-256 is `5d46395037c578ac03dca367ac0733ee0d48890b77e45d84c727c6e7c05c55a7`. Last Light's character viewer loads this URL through its existing React Three Fiber path and displays the approved model.

The canvas must never submit arbitrary Python, shell commands, executables, or unrestricted filesystem paths. It submits a frozen graph containing known tool IDs and validated parameters.

## Node-graph UX

The POC must prove the graph loop, not merely expose a backend button:

- a searchable tool palette grouped by input, mesh, material, validation, and output;
- compact node cards with title, typed ports, last result summary, and status;
- a dedicated inspector for parameters, run scope, previews, reports, logs, and receipts;
- connection previews that reject incompatible port types and cycles before creating an edge;
- explicit idle, stale, queued, running, succeeded, failed, and cancelled presentation;
- Run node, Run to here, Run downstream, Run graph, and Cancel actions with an unambiguous execution scope;
- downstream stale propagation after a parameter, source, or connection changes;
- retained successful results while a node is stale or a later run fails;
- errors attached to the responsible node and visible in a global banner;
- local persistence of graph configuration and layout without embedding large binaries; and
- bridge startup rehydration of retained run and result metadata from disk.

The node UI is driven by Ateli tool definitions. Individual tools may add a focused parameter editor or result inspector, but they reuse the same node shell, connection behavior, status model, and run controls.

## POC gates

### Gate 1: executor

Run the complete high-to-low transformation from a validated JSON request without the visual editor. Produce the candidate GLB, baked maps, fixed-camera previews, log, validation report, and receipt. Confirm the source hash is unchanged.

### Gate 2: bridge

Add the `/ateli` routes to the existing bridge. Submission returns a run ID immediately; status is pollable; cancellation terminates the owned process; invalid graphs start no process; failed runs cannot promote.

### Gate 3: visual graph

Provide the graph through native tldraw node shapes with typed ports, bound edges, graph validation, and persisted tool parameters. Saving the tldraw document preserves the graph without embedding GLB or image bytes.

### Gate 4: Last Light integration

Promote one approved candidate and load it through Last Light's actual Three.js/React Three Fiber path. Validate scale, axes, pivot, materials, normal convention, silhouette, gameplay-distance appearance, load time, triangle count, texture memory, and file size.

## Acceptance

- The raw source hash is unchanged.
- Invalid, failed, stale, or cancelled results cannot be promoted.
- The candidate reaches its requested triangle target within documented tolerance.
- Bounds, orientation, pivot, and material assignments remain valid.
- Low-mesh UVs pass the chosen bake requirements.
- The normal map is exported as non-color data using the glTF/OpenGL convention.
- Fixed-camera source/candidate renders expose silhouette, wireframe, normals, material channels, and final shading.
- Human review occurs before promotion.
- The promoted GLB loads and renders through Last Light's real runtime asset path.
- The receipt records graph hash, source and result hashes, normalized parameters, tool versions, Blender version, timing, validation, and promotion state.

## Non-goals

The first proof does not include arbitrary scripting, a generalized plugin marketplace, batch scheduling, automatic retopology, rigged-mesh mutation, an Ateli cloud service, or an AI graph-building agent.

## Native tldraw graph proof

The custom node and edge system never invokes Blender, constructs shell commands, or manages process state. It focuses on graph authoring while the loopback bridge owns headless execution and retained artifacts.

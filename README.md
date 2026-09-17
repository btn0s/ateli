# Ateli

Ateli is a local-first visual system for composing typed tools into inspectable, repeatable graphs. It is intended to become an open-source alternative in the space occupied by n8n, Flora, and Atlas Studio without being limited to automation, image generation, maps, 3D, or any single media type.

Ateli uses native tldraw Offline custom shapes: `ateli-node` for tool nodes and `ateli-edge` for typed port-to-port connections. Tools may process text, structured data, images, maps, meshes, materials, animation, files, or other value types.

## Current status

The Last Light mesh-optimization proof of concept is implemented end to end:

- three complete local node categories — Input (5), Image (21), Mesh (9) — as native tldraw shapes with typed draggable edges, inline parameter controls, per-node run, and inline 3D/2D previews (see `docs/slices/atlas-nodes.md`);
- the loopback bridge validates graph snapshots, runs scoped jobs, reports results, cancels Blender process groups, rehydrates retained runs, and guards promotion;
- Blender derives a 49,999-triangle candidate, transfers shading normals, bakes a 1024px tangent-space normal map, exports evidence renders, and validates the result without changing the source; and
- the promoted GLB and receipt are consumed by Last Light's React Three Fiber character viewer.

This pipeline proves Ateli's graph, tool, run, result, and headless execution boundaries. It does not define Ateli as a 3D application.

## Current shape

Ateli is a tldraw Offline extension. Each tool instance is an `ateli-node` custom shape with typed input and output ports; material slots are individual ports. Connections are `ateli-edge` custom shapes that reference a source node/port and target node/port and draw a typed curve between the live port anchors. The bridge owns run coordination and retained artifacts; allowlisted headless tools perform the work.

Ateli is one system:

```text
Ateli
├── visual graph
├── typed tool catalog
├── run coordination
├── retained results and receipts
└── headless tool executors
```

Mesh processing is the first POC tool family. Ateli's catalog is designed for image generation and editing, map processing, material construction, animation, data transformation, local automation, remote service calls, and other typed tools.

## Principles

- **General tools, concrete contracts.** Tools declare typed inputs, outputs, and parameters; nodes do not hide work in prompts.
- **Graph-first UX.** Graph construction, parameter editing, run state, previews, and result inspection belong in a dedicated node editor.
- **Local first.** Local files and executors work without a hosted Ateli service.
- **Inspectable execution.** Runs expose state, logs, outputs, validation, and cancellation.
- **Retained provenance.** Sources and accepted results are hashed and linked through receipts.
- **Explicit promotion.** Producing a result is not the same as adopting it into a consuming project.
- **No arbitrary execution by default.** A tool invokes an allowlisted capability, not user-supplied shell or Python.
- **Breadth through added tools, not added systems.** New domains extend the catalog and result renderers while reusing the graph and run model.

## Documentation

- [Domain language](./CONTEXT.md)
- [Architecture](./docs/architecture.md)
- [Original UI and headless-tools decision](./docs/adr/0001-tldraw-offline-headless-first.md)
- [Last Light mesh-optimization POC](./docs/poc/last-light-mesh-optimization.md)
- [Research](./docs/research/README.md)

## Open-source status

Ateli is intended to be open source. A license has not yet been selected; the repository should not be represented as licensed for redistribution until a license is added.

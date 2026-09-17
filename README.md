# Ateli

Ateli is my personal software, built on top of [tldraw Offline](https://github.com/tldraw/tldraw-offline). It is one installable mod set — a skin, a set of canvas tools, a node graph, and the local services behind them — that turns a `.tldraw` document into a workspace I actually use. It is not a product yet.

## What is in it

| Layer | What it gives a document |
|---|---|
| **Skin** (`mod/skin`) | One design system for tldraw's chrome and every custom shape: tokens, surfaces, the command bar, tool chrome. |
| **Canvas tools** (`mod/canvas`) | Shapes that live on the canvas: an embedded browser, a terminal, landmarks for organizing large boards, image generation, and a feedback capture tool. |
| **Node graph** (`mod/graph`) | A typed tool graph — Input, Image, and Mesh nodes with draggable typed edges, inline controls, per-node run, and previews — modelled on Atlas AI Studio. See `docs/slices/atlas-nodes.md`. |
| **Server** (`server/`) | The loopback backend the shapes talk to: terminal sessions, image generation proxy, feedback capture, and the node-graph bridge (validation, per-node execution, caching, results). |
| **Executors** (`executor/`) | Headless workers the bridge spawns per node: Blender for meshes, Pillow/`imgen` for images. |

The node graph is one module among several. The browser, terminal, and landmarks have nothing to do with it; they are just other things I wanted on the same canvas.

## Using it

```sh
npm install
node bin/ateli serve                      # backend on 127.0.0.1:7237
node bin/ateli install "My Board.tldraw"  # build the mod and install it into an open document
node bin/ateli smoke                      # end-to-end mesh pipeline against real Blender
npm test                                  # typecheck + mod build + router/worker tests
```

`install` targets a document that is open in tldraw Offline; it writes the built document script through the app's local agent API.

## Layout

```text
mod/
├── skin/       design system, command bar, tool chrome
├── canvas/     browser, terminal, landmark, image-gen, feedback shapes
├── graph/      node + edge shapes, bridge client, catalog
└── config.tsx  the composed document-script entry
server/         backend, node-graph router and tool catalog, terminal + feedback services
executor/       mesh-worker.py (Blender), image-worker.py (Pillow, imgen)
build/          esbuild + Tailwind build, installer
bin/ateli       install | serve | smoke
docs/           architecture, ADRs, contracts, research, ideas
```

## Documentation

- [Ideas backlog](./docs/ideas.md)
- [Node graph: domain language](./CONTEXT.md) · [architecture](./docs/architecture.md) · [node contract](./docs/slices/atlas-nodes.md)
- ADRs: [native tldraw shapes](./docs/adr/0001-tldraw-offline-headless-first.md) · [per-node execution](./docs/adr/0003-per-node-execution.md) · [parameters are ports](./docs/adr/0004-textures-are-channel-images.md)
- [Last Light mesh-optimization POC](./docs/poc/last-light-mesh-optimization.md)
- [Research](./docs/research/README.md)

## Status

Personal, unlicensed, changing under me. `examples/atlas-nodes.tldraw` is a sample board with the node graph installed, refreshed by hand now and then; my working boards live outside the repo.

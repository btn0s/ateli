# Decision: every row is a typed parameter; textures travel as channel images

**Status:** Accepted. Supersedes 0002.

## Problem

Nodes had two unrelated concepts: ports (typed, connectable) and parameters (inline controls in the header). Users could not drive a parameter from another node, and material data moved as an opaque `material` value nobody could inspect or edit.

## Decision

1. A node row is a **parameter** with a value type (`mesh`, `image`, `text`, `number`, `boolean`, `enum`). Every parameter is a port. Scalar/text/enum parameters also render an inline control that is disabled while an edge drives them. This is the Atlas node model.
2. Textures move between nodes as **channel images** — `baseColor`, `roughness`, `metallic`, `normal` (and `ao` for bakes) — each its own `image` port. `Extract Texture Maps` and `Apply Textures to Mesh` are the seam; `Apply` replaces only the channels connected.

## Consequences

- Any `number`/`text`/`boolean` can be supplied by an Input node or computed upstream; there is no separate "parameter" API.
- Image nodes and mesh nodes compose without adapters: a 2D filter output plugs straight into a mesh texture input.
- Multi-material meshes are flattened to the first textured material per channel for now. Per-slot addressing is a later, additive decision.

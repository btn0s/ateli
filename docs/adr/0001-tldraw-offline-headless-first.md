# Decision: use native tldraw graph shapes

**Status:** Accepted.

Ateli runs inside tldraw Offline as native `ateli-node` custom shapes connected by native `ateli-edge` custom shapes. Each node persists its tool identity, resolved material slots, and parameters; ports are derived from those.

Each edge stores source node, source port, target node, target port, and value type. Its path is computed from the referenced nodes' port anchors, so it follows node moves without arrow bindings. Connection creation rejects mismatched types, self-connections, and cycles; connecting an occupied input replaces the prior edge.

The bridge validates frozen graph snapshots, coordinates allowlisted headless executors, retains results, and guards promotion. Mesh processing through Blender remains the first proof rather than Ateli's product boundary.

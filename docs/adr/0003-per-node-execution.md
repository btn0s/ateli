# Decision: execute one node per subprocess

**Status:** Accepted.

## Problem

The first executor ran a whole graph inside one Blender process. That made "run this node", cancel, caching, and mixing runtimes (Blender, Pillow, `imgen`) awkward: every tool had to live in the same interpreter, and partial progress was invisible until the process exited.

## Decision

The bridge walks the graph in topological order and runs **each node in its own subprocess**, chosen by the tool's `runtime` (`blender`, `image`, `imgen`; `none` is resolved in-process). Every node reads `request.json` and writes `outputs.json` in its own directory. The bridge caches node results by a hash of tool id, version, scalar inputs, and the SHA-256 of file inputs.

## Consequences

- Per-node run, run-downstream, cancel, and cache invalidation are bridge concerns, not worker concerns.
- Workers are small and single-purpose; a new runtime is a new CLI, not a change to existing ones.
- Blender startup cost (~1–2 s) is paid per mesh node. Acceptable for interactive graphs; batch throughput was not the goal.
- Outputs cross process boundaries as files, so every value type must have a file representation (scalars are written as JSON).

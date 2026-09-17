# Decision: multi-values with implicit map, not loop nodes

**Status:** Accepted.

## Problem

Running a pipeline over fifteen source meshes meant fifteen graphs or fifteen edits. Something has to express "for each".

## Options

1. **Explicit control flow** (Unreal Blueprints): `For Each`, exec pins, loop bodies. Turns the graph into a program with an instruction pointer; needs exec wires, scoping, a different executor, and users can write broken loops.
2. **Multi-values with implicit map** (Atlas, Houdini, Blender geometry nodes): a port may carry a list; a node declared for one value runs once per item and emits a list.

## Decision

Option 2. Every value type has a list form (`mesh[]`, `image[]`, `text[]`, …). A single-valued input receiving a list makes the node run once per item; all list inputs on one node are zipped by index (shorter lists end the run with an error, not silent truncation). List-valued inputs (`Collect`, `Pick`) consume the whole list.

The bridge performs the fan-out: one subprocess per item, cached per item, node status reports `7/15`. Executors are unchanged. The graph remains a DAG of values.

## Consequences

- No exec wires; branching arrives later as single nodes (`Switch`, `If`) that emit one of their inputs.
- Wire format gains `parameters` and results that may be arrays; results carry `items[]`.
- The UI shows a count badge and a filmstrip of previews on fanned-out nodes; `Export` names items from a template.
- Reversal cost is high: list types touch validation, execution, caching, results, and every node card.

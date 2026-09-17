# ATELI

Language for Ateli, a personal mod set for tldraw Offline. Most entries below belong to its node-graph module; canvas tools (browser, terminal, landmark) use plain tldraw vocabulary.

## Language

**Ateli**:
The mod set as a whole: skin, canvas tools, node graph, and the local services behind them.
_Avoid_: using it to mean only the node graph

**Node graph**:
The Ateli module that presents, connects, runs, and inspects typed tools.

**Tool**:
A declared capability with typed inputs, outputs, and parameters.
_Avoid_: Command, script, plugin

**Node**:
A configured instance of a tool placed in a graph.
_Avoid_: Tool when referring to one placed instance

**Port**:
A typed connection point through which a node receives or exposes a value.

**Graph**:
A connected set of configured nodes that defines how values move through tools.
_Avoid_: Workflow when the persisted graph itself is meant

**Run**:
One execution of a frozen graph snapshot against resolved sources.

**Source**:
An externally supplied value that is not produced by the current run.
_Avoid_: Result, candidate

**Result**:
An immutable value produced by a node during a run.
_Avoid_: Artifact

**Candidate**:
A validated result offered to a consuming project for acceptance.

**Receipt**:
The retained account of a run's graph, sources, tool versions, parameters, results, validation, and outcome.
_Avoid_: Log when provenance is meant

**Promotion**:
The explicit acceptance of a candidate into a consuming project's owned inputs.
_Avoid_: Export when acceptance is meant


**Executor**:
A headless capability that performs one or more tools without becoming part of the graph's meaning.

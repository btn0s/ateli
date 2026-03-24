# PRD: Ateli Agent Harness

## Status

Archived exploration

## Summary

Ateli should evolve from "canvas app with agent-adjacent terminals" into a
spatial agent harness.

The canvas remains the primary UI. Terminal shapes remain the primary live
surface. But the terminal shape should no longer be the integration boundary
for context. Instead, Ateli should own agent identity, context assembly, tool
injection, and session lifecycle, then render that agent through the terminal
shape.

Working product definition:

Ateli is a spatial agent harness and agent OS for running teams of specialist
agents, where identity, memory, tools, and working context are managed in a
shared visual workspace for humans and agents.

## Problem

Today, the app can compute spatial context correctly, but the agent inside a
terminal does not reliably receive that context.

Observed failure mode:

- Ateli RPC can resolve `workspace.context(sessionKey)` and return the frame
  plus sibling docs/cards.
- The visible agent terminal can still fail to access that context because its
  MCP/tooling path is not reliably connected to the running app.
- This makes the core product promise brittle: the UI shows context, but the
  agent may not actually get it.

This is an architectural problem, not just a missing feature.

## Goals

- Preserve the canvas as the primary UX.
- Preserve terminal shapes as the primary live interaction surface.
- Make agent context deterministic rather than opportunistic.
- Make agent identity and capabilities visible on the canvas.
- Support both always-included context and on-demand capability loading.
- Allow multiple agents with distinct identities, tools, and attached context.

## Non-Goals

- Replacing the canvas with a chat UI.
- Removing terminal shapes.
- Solving full multi-user collaboration in this phase.
- Building a complete marketplace for skills in v1.

## Product Direction

### Core Shift

Keep the visual primitives, but change the semantics:

- **Canvas** = spatial orchestration surface
- **Agent shape** = first-class runtime entity
- **Terminal shape** = live viewport/controller for an agent session
- **Attachments/connectors** = explicit agent context and capability graph

This is different from the current model where a terminal is implicitly treated
as the agent itself.

## Proposed Model

### 1. Agent Shape

A first-class shape representing an active or paused agent.

Potential visible fields:

- name
- role
- model/runtime
- status
- current task
- attached context count
- attached skills count

Potential hidden/runtime fields:

- `agentId`
- `sessionId`
- `identityRef`
- `toolPolicyRef`
- `skillRefs`
- `attachmentRefs`

### 2. Terminal Shape

A live view into an agent session, bound to an `agentId`.

The terminal shape remains visible and interactive, but it is no longer the
source of truth for context. It is a presentation and control surface.

Possible relationships:

- embedded inside the agent shape
- docked to the agent shape
- detachable but still bound to the same `agentId`

### 3. Attachments

Visual objects attached to an agent shape, such as:

- `SOUL.md`
- `AGENTS.md`
- docs cards
- issue cards
- screenshots
- repos/worktrees
- skill bundles

These should be visible as stacked or peeking artifacts on the shape, not just
abstract state.

### 4. Connectors

Explicit edges between the agent and its inputs/outputs.

Examples:

- identity attachment
- required context attachment
- optional resource attachment
- handoff edge to another agent
- output artifact edge

## Context Model

Ateli should support three context layers.

### Always Included

Stable identity and operating rules.

Examples:

- system prompt baseline
- `SOUL.md`
- agent-specific `AGENTS.md`
- workspace-level `AGENTS.md`
- default tool policy

### Spatial / Attached Context

Current task context associated with where or how the agent is placed.

Examples:

- directly attached docs/cards
- attached screenshots
- parent workspace/frame context
- current task/frame label

### On-Demand Context

Capabilities and references the agent can fetch when needed.

Examples:

- skills
- large docs
- codebase slices
- historical artifacts

The key rule: do not inject all available material into every turn. Always
include a compact manifest; fetch full content on demand.

## Identity Model

Identity should be a first-class concept, not an incidental prompt blob.

### Working Assumption

- `SOUL.md` is the agent's persistent identity.
- `AGENTS.md` is operational behavior and local rules.

However, there is ambiguity here.

## Open Research Questions

### Identity Semantics

1. Is `SOUL.md` purely individual identity, or can it encode team/social role
   as well?
2. Is `AGENTS.md` primarily local execution policy, or is it also part of the
   agent's effective identity?
3. Should an agent have both:
   - a persistent personal `SOUL.md`
   - a workspace/frame/task-local `AGENTS.md`
4. If both exist, what is the precedence order when they conflict?
5. Should identity be entirely file-backed, or partly structured in Ateli state?

### Visual Model

6. Is the frame the main context primitive, or should the agent shape own most
   context through attachments?
7. Should frames remain loose ambient context while direct attachments become
   the strong include signal?
8. Should terminal shapes be embedded inside agent shapes by default, or remain
   standalone and linkable?
9. How much skeuomorphism is useful before the shape becomes noisy?

### Prompt / Context Injection

10. What is always included on every turn?
11. What is summarized vs included raw?
12. When frame contents change, should the harness automatically refresh the
    agent's working context, or only on the next turn?
13. Should attached docs become prompt text, tool resources, or both?

### Skills

14. Is a skill a prompt snippet, a tool bundle, a retrieval pack, or a mix?
15. Should skills be attached visually as cards, badges, or connectors?
16. Can skills be granted transitively via frame/workspace membership, or only
    by direct attachment?
17. How should skill conflicts be resolved?

### Runtime / Harness

18. Should the harness live inside the Electron main process, as a sidecar
    process, or in a dedicated local service?
19. Should tmux remain the execution substrate, or only the transcript/viewer
    substrate?
20. How does Agent SDK fit in:
    - full runtime replacement
    - optional runtime backend
    - orchestration layer above terminal-backed agents
21. How are session resume and replay handled when the agent runtime is not
    literally the terminal process?

### Human Interaction

22. How should humans edit identity and context:
    - drag/drop attachments
    - inspector panel
    - direct editing in cards/files
23. What should be interruptible from the terminal surface vs a higher-level
    agent control UI?
24. How should handoff work visually between agents?

## Proposed v1 Semantics

To unblock implementation, use these provisional rules:

- Agent shape is the first-class runtime object.
- Terminal shape is bound to `agentId`.
- `SOUL.md` is always included identity.
- `AGENTS.md` is always included operational policy.
- Directly attached docs/cards are included as current task context.
- Frame membership is ambient context, lower priority than direct attachments.
- Skills are always visible in a manifest, but loaded on demand.

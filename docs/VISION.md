# Ateli Vision

## One-liner

A spatial canvas for running agentic teams where humans express intent
and agents self-organize to deliver.

## The Problem

Today's agent workflows are invisible. You start a Claude session, it
works in a hidden context window, maybe spawns sub-agents you can't see.
There's no way to:

- See what multiple agents are doing simultaneously
- Express high-level intent and have agents decompose it into work
- Have agents communicate with each other
- Be a human in the loop without being a bottleneck
- Think spatially about project structure

## The Solution

Ateli is an infinite canvas where:

1. **You express intent** — drag in a Linear ticket, write a note, describe
   what you want. Place it on the canvas.

2. **An agent PM decomposes it** — reads your intent, breaks it into tasks,
   spawns agent workers into frames on the canvas.

3. **Agents self-organize** — they read their spatial context (what's in
   their frame), communicate through a coordination layer (Linear ticket
   statuses, shared shapes, direct messaging), and produce artifacts
   (code, docs, designs) that appear on the canvas.

4. **You observe and steer** — zoom out to see the whole team working.
   Zoom into a frame to see details. Drag a shape from one agent's frame
   to another to redirect work. Type into a terminal to talk to an agent
   directly. The canvas is your window into the swarm.

## Core Principles

### Canvas = Spatial Memory
The canvas is the shared workspace. Everything that matters is a shape.
Agents and humans read the same surface. No hidden state.

### Composable, Not Rigid
Small primitives that compose. Cards, frames, terminals, arrows.
No special "project shape" or "task shape" — a Linear ticket is just
a card. A GitHub PR is just a card. Meaning comes from spatial arrangement.

### Agents Are Peers
Agents and humans are both participants on the canvas. An agent can
create shapes, read context, spawn other agents. A human can do the
same things. The canvas doesn't distinguish — it just provides the
surface.

### Coordination Is Pluggable
Linear is one coordination backend. Could be GitHub issues, Notion,
or a simple shared note. The canvas doesn't care about the coordination
layer — it cares about spatial relationships and shape content.

## Agent Communication Primitives

This is the critical unsolved piece. How do agents know about each other?

### Option A: Ticket-Based (Linear as message bus)
- Agent PM creates tickets, assigns to agents
- Agents poll their assigned tickets for status changes
- Agents update ticket status when done
- Pro: uses existing infra, audit trail, human-readable
- Con: polling latency, Linear as bottleneck, coupling

### Option B: Canvas-Native (shapes as messages)
- Agents drop "message shapes" in each other's frames
- A message shape is just a card with sourceType: "agent-message"
- Agents poll their frame for new shapes
- Pro: everything visible on canvas, no external dependency
- Con: no ordering guarantees, polling, canvas gets cluttered

### Option C: Agent Registry + Direct RPC
- Agents register with the canvas on spawn (id, role, frame, capabilities)
- New RPC methods: agent.list, agent.send(targetId, message), agent.inbox
- Pro: fast, structured, purpose-built
- Con: more infrastructure to build, invisible communication

### Option D: Hybrid
- Linear for high-level task coordination (what to work on)
- Canvas shapes for context and artifacts (what to work with)
- Direct RPC for real-time agent-to-agent communication (how to coordinate)
- Human sees everything on the canvas + in Linear
- Each layer does what it's good at

**Current lean: Option D.** Linear manages the backlog. The canvas manages
spatial context. A lightweight agent registry handles real-time coordination.

## User Experience

### Expressing Intent
User drags a Linear ticket onto the canvas, or writes a note:
"Build the authentication system using OAuth2"

### Agent PM Activates
The PM agent (always running, monitoring the canvas) sees the new intent.
It reads the content, checks Linear for related tickets, and creates a
plan. The plan appears as shapes on the canvas:

```
[Frame: "Auth System"]
  ├── [Card: Original intent note]
  ├── [Card: TH-471 - Research OAuth2 providers]
  ├── [Card: TH-472 - Implement auth middleware]
  ├── [Card: TH-473 - Add login UI]
  ├── [Terminal: Research Agent] → working on TH-471
  └── [Terminal: Code Agent] → waiting for TH-471
```

### Human in the Loop
The user sees this unfold. They can:
- Drag TH-473 out of the frame ("skip the UI for now")
- Drop a screenshot into the frame ("make it look like this")
- Type into a terminal ("use Clerk instead of rolling our own")
- Resize/rearrange to focus on what matters

### Completion
Agents finish work, update Linear tickets, leave artifacts on the canvas.
The frame becomes a record of what was done. Zoom out, start a new frame
for the next piece of work.

## What We Need to Build

### Phase 1: Primitives (current)
- Card shape (any content becomes a shape)
- Frame RPC (agents can create/query frames)
- Agent context reading (agents know their surroundings)

### Phase 2: Agent Awareness
- Agent registry (agents know about each other)
- Agent spawn primitive (PM can spawn workers)
- Agent communication (direct messaging or shared context)

### Phase 3: Orchestration
- PM agent loop (monitors canvas, decomposes intent, assigns work)
- Linear sync (tickets ↔ canvas cards, status updates)
- Multi-agent workflows (handoffs, dependencies, parallel work)

### Phase 4: Intelligence
- Anthropic Agent SDK integration (containerized agents with SOUL.md)
- Semantic zoom (detail level adapts to zoom)
- Canvas-aware context windows (agents get relevant shapes, not everything)

# Brainstorm / Ideas Parking Lot

## Containerized Agents with Anthropic Agent SDK
_Source: user, 2026-03-19_

Instead of spawning Claude Code instances in terminals, use the Anthropic
Agent SDK to spawn real containerized agents. Each agent gets:

- Its own `SOUL.md` (personality, role, constraints)
- Isolated container/sandbox
- Defined tool access
- Structured input/output (not terminal scraping)

This would replace the current "start claude in tmux" pattern with something
more robust. The terminal shape becomes a viewer/controller for the agent
rather than the agent itself.

**Why this matters:**
- Agents get persistent identity (SOUL.md survives sessions)
- Better than parsing terminal output — structured communication
- Can limit tool access per agent (researcher vs coder vs reviewer)
- Container isolation for safety
- Could run agents remotely, not just local

**Open questions:**
- How does Agent SDK integrate with Electron? Main process spawns agents?
- What's the interface between agent and canvas? Still RPC? Or direct SDK?
- How do agents see canvas context? Push vs pull?
- Cost/latency implications of SDK agents vs local Claude Code?

## Other Ideas

### Canvas as Agent Memory
Agents could "pin" important context as shapes on the canvas. When they
start a new session, they read their frame to rebuild context. The canvas
IS the memory, not a separate system.

### Agent Handoff
Agent A drags a shape (its work output) into Agent B's frame. Agent B
picks it up as new context on its next poll. Spatial handoff.

### Zoom Levels = Abstraction Levels
Zoomed out: see frames as labeled cards (project overview)
Zoomed in: see individual shapes, terminal output, card content
The canvas adapts detail level to zoom, like a semantic zoom.

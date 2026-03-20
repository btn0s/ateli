# Architecture Decisions

## ADR-001: Unix philosophy — composable primitives over rigid systems
**Date:** 2026-03-19
**Status:** Accepted

The canvas uses small, composable primitives. No special workspace types,
status systems, or integration-specific shapes. A card is a card. A frame
is a frame. Agents compose these into workflows.

**Consequences:** We don't build "Linear integration" as a feature. Agents
that have Linear MCP tools can read/write tickets. Cards on the canvas are
just references with rendered previews.

## ADR-002: tmux-backed terminals
**Date:** 2026-03-19
**Status:** Accepted

Terminal sessions run inside tmux. node-pty attaches to tmux for xterm.js
rendering. Benefits: sessions persist across app restarts, `tmux capture-pane`
for reliable output reading, standard tooling.

## ADR-003: JSON-RPC over Unix socket for agent interface
**Date:** 2026-03-19
**Status:** Accepted

Agents interact with the canvas via a JSON-RPC 2.0 server on a Unix domain
socket. Path written to `~/.collaborator/socket-path`. Newline-delimited JSON.
Simple, language-agnostic, works from bash.

## ADR-004: Spatial proximity = context
**Date:** 2026-03-19
**Status:** Proposed

An agent's context is determined by what's spatially near it on the canvas.
If a terminal is inside a frame, it can read all sibling shapes as context.
No explicit "assign ticket to agent" — just drag the ticket into the frame.

## ADR-005: One card shape, many renderers
**Date:** 2026-03-19
**Status:** Proposed

A single `card` shape type handles all external content (Linear tickets,
GitHub PRs, URLs, notes). The `sourceType` prop determines how it renders.
No proliferation of shape types per integration.

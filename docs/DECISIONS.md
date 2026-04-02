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

## ADR-002: Sidecar-backed terminals
**Date:** 2026-03-19 (updated 2026-04-02)
**Status:** Accepted (supersedes tmux)

Terminal sessions run in a detached Node.js sidecar process using node-pty.
The sidecar survives app restarts. A shared control socket (JSON-RPC 2.0)
handles session lifecycle, and each session gets its own data socket for raw
PTY I/O. An 8MB ring buffer per session enables scrollback replay on reconnect.
tmux is no longer used.

**Consequences:** No external tmux dependency. Terminals reconnect seamlessly
after app restart. External agents get scrollback via `terminal.read` backed
by the ring buffer instead of `tmux capture-pane`.

See: `docs/superpowers/specs/2026-04-02-sidecar-pty-refactor-design.md`

## ADR-003: JSON-RPC over Unix socket for agent interface
**Date:** 2026-03-19
**Status:** Accepted

Agents interact with the canvas via a JSON-RPC 2.0 server on a Unix domain
socket. Path written to `~/.ateli/socket-path`. Newline-delimited JSON.
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

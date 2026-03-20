# Ateli Roadmap

## Phase 0: Foundation (DONE)
- [x] Electron app with tldraw canvas
- [x] Terminal shape (xterm.js + node-pty + tmux)
- [x] JSON-RPC server over Unix socket
- [x] Agent-to-agent communication
- [x] Canvas persistence per folder
- [x] Custom dot grid with cursor glow

## Phase 1: Composable Primitives (CURRENT)
_The canvas becomes a spatial OS through small, composable primitives._

### Card Shape
- [ ] Generic card shape: { title, body, url, sourceType, meta }
- [ ] Markdown rendering in card body
- [ ] Source type indicators (icon/badge for linear, github, etc)

### Agent Context
- [ ] RPC: workspace.context — agent reads its frame + siblings
- [ ] Spatial proximity fallback when not in a frame
- [ ] Context includes shape content, not just IDs

### Drop Target / Paste
- [ ] Paste URL → auto-create card shape
- [ ] Drag-and-drop URL from browser
- [ ] URL metadata fetching (title, description, favicon)

### Frame Enhancements
- [ ] RPC: canvas.createFrame — create labeled frame via RPC
- [ ] RPC: canvas.moveToFrame — reparent shapes into a frame
- [ ] Keyboard shortcut for group-into-frame

## Phase 2: Agent Orchestration (NEXT)
- [ ] agent.spawn — create terminal + start claude in one RPC call
- [ ] Agent can read context, do work, write results back as shapes
- [ ] Multiple agents working in parallel in different frames

## Phase 3: Polish
- [ ] Drop targets for files from Finder
- [ ] Image/screenshot shape
- [ ] Recent projects list on launch
- [ ] Keyboard navigation between frames

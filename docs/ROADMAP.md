# Ateli Roadmap

## Phase 0: Foundation (DONE)
- [x] Electron app with tldraw canvas
- [x] Terminal shape (xterm.js + node-pty + tmux)
- [x] JSON-RPC server over Unix socket
- [x] Agent-to-agent communication
- [x] Canvas persistence per folder
- [x] Custom dot grid with cursor glow

## Phase 1: Workspace Shell (CURRENT)
_The canvas becomes a durable coding workspace with a stable shell._

### Workspace Shell
- [ ] Harden left sidebar chat model
- [ ] Improve right sidebar file tree and terminal stack
- [ ] Smooth canvas / sidebar interaction boundaries
- [ ] Make layout persist cleanly per workspace

### Groups / Workstreams
- [ ] Rename groups cleanly
- [ ] Make groups/frame labels feel first-class
- [ ] Improve grouping and reparenting flows
- [ ] Clarify how terminals belong to groups

### Worktrees
- [ ] Make worktree attachment more visible
- [ ] Improve IDE open flows
- [ ] Clarify worktree bindings in the UI
- [ ] Add worktree creation/management ergonomics

### Claude Config / Skills
- [ ] Global Claude config manager
- [ ] Global skills manager
- [ ] Workspace-level defaults and overrides
- [ ] File-backed config editing flows

## Phase 2: Canvas Primitives
- [ ] Generic card shape: { title, body, url, sourceType, meta }
- [ ] Markdown rendering in card body
- [ ] Paste URL → auto-create card shape
- [ ] Drag-and-drop URL from browser
- [ ] URL metadata fetching
- [ ] RPC: canvas.createFrame
- [ ] RPC: canvas.moveToFrame

## Phase 3: Agent Runtime Experiments
- [ ] Prototype isolated agent sessions outside the main canvas product
- [ ] Prototype custom Claude CLI / wrapper flows
- [ ] Explore SOUL / identity / memory primitives
- [ ] Explore agent spawning, delegation, and handoff in a separate UI/TUI

## Phase 4: Polish
- [ ] Drop targets for files from Finder
- [ ] Image/screenshot shape
- [ ] Recent projects list on launch
- [ ] Keyboard navigation between frames

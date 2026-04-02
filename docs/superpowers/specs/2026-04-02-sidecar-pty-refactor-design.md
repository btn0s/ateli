# Sidecar PTY Refactor — Design Spec

## Overview

Replace tmux-backed terminal sessions with a detached Node.js sidecar process,
matching the architecture proven in Collaborator. This gives us durable terminals
that survive app restarts, proper scrollback replay via ring buffers, and a
clean agent-facing RPC surface — without the tmux external dependency.

The tldraw canvas, renderer UI, and shape system are not changing. This refactor
targets the main process internals and the terminal data path only.

## Motivation

The current terminal architecture has several problems:

1. **tmux is an external dependency** — requires system install, version-specific
   behavior, `execSync` calls for output capture
2. **No reconnection** — if the app restarts, the tmux session is alive but ateli
   has no way to reattach (no persisted session metadata)
3. **Monolithic main process** — PTY management, RPC handling, and IPC bridging
   are all tangled in `index.ts` and `pty-store.ts`
4. **Polling for output** — agents call `terminal.read` which runs
   `tmux capture-pane`, a synchronous shell command
5. **No scrollback on reconnect** — even if we could reconnect, there's no buffer
   to replay

Collaborator solved all of these with a sidecar architecture. We adopt it.

## Architecture

### Process Model (after refactor)

```
Electron Main Process
  ├── index.ts          — app lifecycle, window, IPC bridge (thin)
  ├── pty.ts            — PTY orchestration, session lifecycle
  ├── rpc.ts            — JSON-RPC server + router + handlers
  └── sidecar/
      ├── client.ts     — talks to sidecar via control socket
      └── (spawns →)

Sidecar Process (detached, survives app restart)
  ├── entry.ts          — process entry point
  ├── server.ts         — control socket + per-session data sockets
  ├── protocol.ts       — shared types/constants
  └── ring-buffer.ts    — 8MB circular buffer per session
```

### Channel Separation

Two communication channels between main process and sidecar:

**Control channel** (`~/.ateli/pty-sidecar.sock`):
- JSON-RPC 2.0, newline-delimited
- Low-frequency request/reply: create, kill, resize, reconnect, ping
- Sidecar → main notifications: `session.exited`

**Data channels** (`~/.ateli/pty-sessions/{sessionId}.sock`):
- One Unix domain socket per session
- Raw bidirectional PTY I/O — no framing, no JSON
- High-throughput streaming, prevents head-of-line blocking on control channel

## Component Specs

### 1. Sidecar Process

**Location:** `src/main/sidecar/`

**`entry.ts`** — Spawned as a detached child process by the main process.
Accepts `--token` argument for validation. Instantiates `SidecarServer` and
listens on control socket.

**`server.ts`** — `SidecarServer` class:
- Listens on `~/.ateli/pty-sidecar.sock` (control)
- Creates per-session data sockets under `~/.ateli/pty-sessions/`
- Manages `node-pty` instances (spawn, write, resize, kill)
- Each session has a `RingBuffer` (8MB) capturing all PTY output
- **Single-client data socket** (last-attach-wins): new connection evicts the
  previous client, matching Collaborator's proven model. No multi-client fanout.
- On reconnect: enters reconnect mode, queues output, flushes ring buffer
  snapshot + queued data to new client when it connects

**Control channel methods:**

| Method | Params | Returns |
|---|---|---|
| `session.create` | shell, cwd, cols, rows, env? | sessionId, socketPath, pid |
| `session.reconnect` | sessionId, cols, rows | sessionId, socketPath |
| `session.resize` | sessionId, cols, rows | — |
| `session.kill` | sessionId | — |
| `session.list` | — | sessions[] |
| `session.foreground` | sessionId | command |
| `session.signal` | sessionId, signal | — |
| `session.snapshot` | sessionId | Buffer (ring buffer contents) |
| `sidecar.ping` | — | pid, uptime, version, token |
| `sidecar.shutdown` | — | — (graceful exit if idle) |

**Notifications (sidecar → main):**
- `session.exited` — { sessionId, exitCode }

**Lifecycle management:**
- PID + token + version written to `~/.ateli/pty-sidecar.pid`
- Main process validates sidecar via ping + token check on startup
- Stale sidecar (wrong version/token, dead PID) gets respawned
- 30-minute idle timeout: sidecar exits if no sessions and no clients
- App quit calls `sidecar.shutdown` for graceful cleanup when idle

**`protocol.ts`** — Shared constants and types:
```typescript
const SIDECAR_VERSION = 1
const DEFAULT_RING_BUFFER_BYTES = 8 * 1024 * 1024 // 8MB
const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
```

**`ring-buffer.ts`** — `RingBuffer` class:
- Fixed-capacity circular buffer
- `write(data: Buffer)` — append, silently overwrites oldest on full
- `snapshot(): Buffer` — returns copy of contents in write order
- `clear()` — reset

### 2. Sidecar Client

**Location:** `src/main/sidecar/client.ts`

**`SidecarClient` class** (used by main process):
- `ensureSidecar()` — check PID file, ping, respawn if needed. **Coalesces
  concurrent calls** (single in-flight promise) to prevent parallel spawn races.
- `createSession(opts)` — RPC to sidecar, returns session info
- `reconnectSession(sessionId, cols, rows)` — RPC to sidecar
- `resizeSession(sessionId, cols, rows)` — RPC to sidecar
- `killSession(sessionId)` — RPC to sidecar
- `shutdownIfIdle()` — graceful sidecar shutdown on app quit
- `listSessions()` — RPC to sidecar
- `snapshotSession(sessionId)` — get ring buffer contents (backs `terminal.read`)
- `onNotification(cb)` — listen for sidecar notifications (session.exited)
- `connectDataSocket(socketPath)` — connect to per-session data socket

### 3. PTY Orchestration

**Location:** `src/main/pty.ts`

Bridges sidecar to the rest of the app. Single module that `index.ts` delegates to.

**Responsibilities:**
- `createSession(opts)` — call sidecar client, connect data socket, persist
  terminal metadata to `sessions.json`, pipe data to renderer via IPC
- `reconnectSession(id, cols, rows)` — call sidecar reconnect, attach new data
  socket, pipe ring buffer replay + live data to renderer
- `killSession(id)` — close data socket, call sidecar kill. The sidecar sends
  `session.exited` notification which triggers cleanup (remove from
  `sessions.json`, broadcast `terminal.exit` to RPC clients and renderer).
  Single exit path — all exits flow through the `session.exited` handler.
- `resizeSession(id, cols, rows)` — forward to sidecar
- `writeSession(id, data)` — write to session's data socket
- `discoverSessions()` — on startup, compare `sessions.json` against sidecar's
  live sessions. Keep entries with surviving sidecar sessions, remove the rest.
- `cleanDetachedSessions()` — kill sidecar sessions not referenced by any
  persisted terminal metadata (prevents leaks). Runs after `discoverSessions()`
  to avoid racing with metadata writes.

### 4. State Persistence

**Location:** managed by `pty.ts`, stored under `~/.ateli/`

**`~/.ateli/sessions.json`** — terminal metadata registry:
```typescript
interface TerminalMetadata {
  id: string
  name?: string
  sidecarSessionId: string
  shell: string
  cwd: string
  pid: number | null
  createdAt: string
}
```

Entries are removed on exit — no `dead` state. If a session is in
`sessions.json`, it is expected to be alive. Startup reconciliation removes
entries whose sidecar sessions no longer exist.

**Write strategy:**
- Atomic writes (write to temp file, then rename)
- Immediate on create/delete
- Debounced (500ms) on non-critical updates

**Other state files:**
- `~/.ateli/pty-sidecar.pid` — sidecar PID + token + version
- `~/.ateli/socket-path` — breadcrumb for external agent discovery
- `~/.ateli/server.token` — RPC server auth nonce

**Canvas/shape persistence:** Unchanged. tldraw's `persistenceKey` continues to
handle canvas state in localStorage. The `sidecarSessionId` stored in shape props
is the bridge between canvas shapes and the terminal registry.

### 5. RPC Server

**Location:** `src/main/rpc.ts`

JSON-RPC 2.0 server on `~/.ateli/ipc.sock`. Socket path written to
`~/.ateli/socket-path` for external discovery.

**Auth:** Nonce token written to `~/.ateli/server.token`. Clients must send
token on connect (first message). Unauthenticated clients are rejected.

**Methods:**

| Method | Description | Broadcast |
|---|---|---|
| `terminal.create` | Create terminal session | `terminal.created` |
| `terminal.list` | List all terminals with metadata | — |
| `terminal.write` | Send data to terminal | — |
| `terminal.resize` | Resize terminal | — |
| `terminal.kill` | Kill session | `terminal.exit` |
| `terminal.reconnect` | Reconnect + scrollback replay | — |
| `terminal.read` | Snapshot current scrollback (ring buffer) | — |
| `canvas.getShapes` | All shapes on current canvas | — |
| `canvas.createTerminal` | Create terminal shape at position | — |
| `workspace.context` | Spatial context for a session | — |

**Broadcast notifications:** Authenticated clients on the socket receive
JSON-RPC notifications (no `id` field) for state changes. This lets external
agents react to events without polling.

**Router pattern:** Methods registered as `name → handler` map. Dispatch by
method name with standard JSON-RPC error codes. 10-second timeout per request.

### 6. Electron Main Process

**Location:** `src/main/index.ts`

Becomes a thin shell:
- App lifecycle (`app.whenReady`, window creation, quit cleanup)
- Sidecar startup via `SidecarClient.ensureSidecar()`
- RPC server startup
- IPC handler registration — thin wrappers delegating to `pty.ts`:

```
terminal:create    → pty.createSession()
terminal:input     → pty.writeSession()
terminal:resize    → pty.resizeSession()
terminal:dispose   → pty.killSession()
terminal:reconnect → pty.reconnectSession()  (new)
```

- Notification relay: sidecar events and RPC broadcasts forwarded to renderer
  via `rpc:notification` IPC channel

### 7. Preload Bridge

**Location:** `src/preload/index.ts`

**Addition to `window.electron.terminal`:**
```typescript
reconnect(sessionKey: string, cols: number, rows: number): Promise<void>
```

Everything else stays the same.

### 8. Terminal Shape Component

**Location:** `src/renderer/shapes/terminal-shape.tsx`

**Shape props change:**
```typescript
// Before
{ w: number; h: number }

// After
{ w: number; h: number; sidecarSessionId?: string }
```

**Mount flow change:**
1. Mount → check `shape.props.sidecarSessionId`
2. If present → `window.electron.terminal.reconnect(sessionId, cols, rows)`
   → sidecar flushes ring buffer → xterm renders scrollback
   → **If reconnect fails** (session not found): clear `sidecarSessionId` from
   shape props, fall through to step 3 (create new session)
3. If absent → `window.electron.terminal.create(shapeId, cwd)`
   → get sessionId → `editor.updateShape()` to store `sidecarSessionId` in props
4. Listen for `terminal:data:{sessionKey}` → pipe to xterm

**Unmount behavior change:**
- Unmount **detaches** (closes data socket) but does **not** kill the session
- Session stays alive in sidecar for reconnection
- Explicit "close/delete terminal" action calls `terminal:dispose` which kills it

## File Changes Summary

**New files:**
- `src/main/sidecar/server.ts`
- `src/main/sidecar/client.ts`
- `src/main/sidecar/protocol.ts`
- `src/main/sidecar/entry.ts`
- `src/main/sidecar/ring-buffer.ts`
- `src/main/pty.ts`

**Modified files:**
- `src/main/index.ts` — gutted to thin shell
- `src/main/rpc.ts` — rewritten with router, auth, broadcast, new methods
- `src/preload/index.ts` — add `terminal.reconnect`
- `src/renderer/shapes/terminal-shape.tsx` — reconnect flow, sidecarSessionId prop
- `src/renderer/env.d.ts` — update window.electron types
- `docs/DECISIONS.md` — update ADR-002

**Deleted files:**
- `src/main/pty-store.ts`

**Deleted dependencies:**
- tmux (system dependency, no longer needed)

## ADR Updates

### ADR-002: Sidecar-backed terminals
**Date:** 2026-03-19 (updated 2026-04-02)
**Status:** Accepted (supersedes tmux)

Terminal sessions run in a detached Node.js sidecar process using node-pty.
The sidecar survives app restarts. Each session has a control channel (JSON-RPC
2.0 over Unix socket) and a per-session data socket (raw PTY I/O). An 8MB ring
buffer per session enables scrollback replay on reconnect. tmux is no longer used.

**Consequences:** No external tmux dependency. Terminals reconnect seamlessly
after app restart. External agents get scrollback via `terminal.read` backed
by the ring buffer instead of `tmux capture-pane`.

### ADR-003: JSON-RPC over Unix socket (updated)
Socket path moves from `~/.collaborator/socket-path` to `~/.ateli/socket-path`.
Adds nonce-based auth (token required on connect) and 10-second request timeout.

## Intentional Divergences from Collaborator

These are deliberate choices, not oversights:

1. **macOS-only for now.** No Windows named-pipe branching. We'll add cross-platform
   socket paths when we need them.
2. **Generic `rpc:notification` IPC relay** instead of dedicated per-event IPC
   channels. Our surface is smaller — one relay channel keeps the preload bridge
   simple. Can split later if perf demands it.
3. **Token auth on the agent RPC socket.** Collaborator's socket is open.
   We add a nonce because external agents (Claude Code, etc.) connecting to
   `~/.ateli/ipc.sock` should authenticate.
4. **`sessions.json` is single-writer** — all writes go through `pty.ts`. No
   concurrent writer conflict because create/kill/exit/discovery are serialized
   through the same module.

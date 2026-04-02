# Sidecar PTY Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tmux-backed terminals with a detached Node.js sidecar process for durable, reconnectable terminal sessions.

**Architecture:** A detached sidecar process owns all node-pty instances and survives app restarts. It exposes a JSON-RPC control socket and per-session data sockets. The Electron main process bridges the sidecar to the renderer via IPC, and exposes a JSON-RPC server for external agents.

**Tech Stack:** Node.js, node-pty, Electron IPC, JSON-RPC 2.0, Unix domain sockets, xterm.js, tldraw

**Spec:** `docs/superpowers/specs/2026-04-02-sidecar-pty-refactor-design.md`

**Reference:** Collaborator sidecar at `examples/collab-public/collab-electron/src/main/sidecar/`

---

## File Structure

```
apps/desktop/src/main/
  sidecar/
    protocol.ts     — shared types, constants, JSON-RPC helpers (NEW)
    ring-buffer.ts  — circular scrollback buffer (NEW)
    server.ts       — SidecarServer class, PTY management (NEW)
    entry.ts        — sidecar process entry point (NEW)
    client.ts       — SidecarClient class, spawns/connects to sidecar (NEW)
  pty.ts            — PTY orchestration, bridges sidecar to IPC/RPC (NEW)
  rpc.ts            — JSON-RPC server, router, auth, handlers (REWRITE)
  index.ts          — thin shell: lifecycle, IPC wiring (MODIFY)
  pty-store.ts      — DELETE

apps/desktop/src/preload/
  index.ts          — add terminal.reconnect, terminal.detach (MODIFY)

apps/desktop/src/renderer/
  shapes/terminal-shape.tsx — reconnect flow, sidecarSessionId prop (MODIFY)
  env.d.ts                  — update Window types (MODIFY)

apps/desktop/
  electron.vite.config.ts   — add sidecar entry point (MODIFY)
```

---

### Task 1: Protocol & Ring Buffer

Foundation types shared between sidecar server and client. No Electron dependency — pure Node.js.

**Files:**
- Create: `apps/desktop/src/main/sidecar/protocol.ts`
- Create: `apps/desktop/src/main/sidecar/ring-buffer.ts`

- [ ] **Step 1: Create `protocol.ts` with shared types and helpers**

```typescript
// apps/desktop/src/main/sidecar/protocol.ts
import path from "node:path"
import os from "node:os"

export const ATELI_DIR = path.join(os.homedir(), ".ateli")
export const SIDECAR_VERSION = 1
export const DEFAULT_RING_BUFFER_BYTES = 8 * 1024 * 1024 // 8MB
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

export const SIDECAR_SOCKET_PATH = path.join(ATELI_DIR, "pty-sidecar.sock")
export const SIDECAR_PID_PATH = path.join(ATELI_DIR, "pty-sidecar.pid")
export const SESSION_SOCKET_DIR = path.join(ATELI_DIR, "pty-sessions")

export function sessionSocketPath(sessionId: string): string {
  return path.join(SESSION_SOCKET_DIR, `${sessionId}.sock`)
}

// JSON-RPC 2.0 types
export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

export interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: Record<string, unknown>
}

export function makeRequest(
  id: number,
  method: string,
  params?: Record<string, unknown>,
): string {
  const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }
  return JSON.stringify(msg) + "\n"
}

export function makeResponse(id: number, result: unknown): string {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, result }
  return JSON.stringify(msg) + "\n"
}

export function makeError(id: number, code: number, message: string): string {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } }
  return JSON.stringify(msg) + "\n"
}

export function makeNotification(
  method: string,
  params?: Record<string, unknown>,
): string {
  const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params }
  return JSON.stringify(msg) + "\n"
}

// PID file format
export interface PidFileData {
  pid: number
  token: string
  version: number
}

// session.create params/result
export interface SessionCreateParams {
  shell: string
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
}

export interface SessionCreateResult {
  sessionId: string
  socketPath: string
  pid: number
}

// session.reconnect params/result
export interface SessionReconnectParams {
  sessionId: string
  cols: number
  rows: number
}

export interface SessionReconnectResult {
  sessionId: string
  socketPath: string
}

// session.list result
export interface SessionInfo {
  sessionId: string
  shell: string
  cwd: string
  pid: number
  createdAt: string
}

// sidecar.ping result
export interface PingResult {
  pid: number
  uptime: number
  version: number
  token: string
}
```

- [ ] **Step 2: Create `ring-buffer.ts`**

Port directly from Collaborator's implementation — it's clean and well-tested.

```typescript
// apps/desktop/src/main/sidecar/ring-buffer.ts

/**
 * Fixed-capacity circular byte buffer. Oldest data is silently
 * overwritten when the buffer is full. Snapshot returns a copy
 * of the live contents in write order.
 */
export class RingBuffer {
  private buf: Buffer
  private head = 0 // next write position
  private filled = 0 // bytes currently stored (up to capacity)
  private total = 0 // lifetime bytes written

  constructor(private readonly capacity: number) {
    this.buf = Buffer.alloc(capacity)
  }

  get bytesWritten(): number {
    return this.total
  }

  write(data: Uint8Array): void {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const len = chunk.length
    this.total += len

    if (len >= this.capacity) {
      // Data larger than buffer — keep only the tail
      chunk.copy(this.buf, 0, len - this.capacity, len)
      this.head = 0
      this.filled = this.capacity
      return
    }

    const spaceToEnd = this.capacity - this.head

    if (len <= spaceToEnd) {
      chunk.copy(this.buf, this.head)
    } else {
      chunk.copy(this.buf, this.head, 0, spaceToEnd)
      chunk.copy(this.buf, 0, spaceToEnd)
    }

    this.head = (this.head + len) % this.capacity
    this.filled = Math.min(this.filled + len, this.capacity)
  }

  /** Return a copy of buffered data in write order. */
  snapshot(): Buffer {
    if (this.filled === 0) return Buffer.alloc(0)

    if (this.filled < this.capacity) {
      // Haven't wrapped yet — data starts at 0
      return Buffer.from(this.buf.subarray(0, this.filled))
    }

    // Wrapped: oldest data starts at head, newest ends just before head
    const result = Buffer.alloc(this.capacity)
    const tailLen = this.capacity - this.head
    this.buf.copy(result, 0, this.head, this.head + tailLen)
    this.buf.copy(result, tailLen, 0, this.head)
    return result
  }

  clear(): void {
    this.head = 0
    this.filled = 0
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors from `sidecar/protocol.ts` or `sidecar/ring-buffer.ts` (other files may have errors since the refactor is in progress)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/sidecar/protocol.ts apps/desktop/src/main/sidecar/ring-buffer.ts
git commit -m "feat: add sidecar protocol types and ring buffer"
```

---

### Task 2: Sidecar Server

The detached process that owns PTY sessions. Matches Collaborator's `server.ts` adapted for ateli.

**Files:**
- Create: `apps/desktop/src/main/sidecar/server.ts`
- Create: `apps/desktop/src/main/sidecar/entry.ts`
- Modify: `apps/desktop/electron.vite.config.ts`

- [ ] **Step 1: Create `server.ts` — SidecarServer class**

```typescript
// apps/desktop/src/main/sidecar/server.ts
import * as net from "node:net"
import * as fs from "node:fs"
import * as crypto from "node:crypto"
import * as pty from "node-pty"
import { RingBuffer } from "./ring-buffer"
import {
  makeResponse,
  makeError,
  makeNotification,
  DEFAULT_RING_BUFFER_BYTES,
  SIDECAR_VERSION,
  sessionSocketPath,
  type JsonRpcRequest,
  type SessionCreateParams,
  type SessionCreateResult,
  type SessionReconnectParams,
  type SessionReconnectResult,
  type SessionInfo,
  type PingResult,
  type PidFileData,
} from "./protocol"

interface ServerOptions {
  controlSocketPath: string
  sessionSocketDir: string
  pidFilePath: string
  token: string
  idleTimeoutMs?: number
  ringBufferBytes?: number
}

interface Session {
  id: string
  pty: pty.IPty
  shell: string
  cwd: string
  createdAt: string
  ringBuffer: RingBuffer
  dataServer: net.Server
  dataClient: net.Socket | null
  socketPath: string
  hasAttachedClient: boolean
  /** When non-null, PTY output is queued here instead of sent to client. */
  reconnectQueue: Buffer[] | null
}

export class SidecarServer {
  private controlServer: net.Server | null = null
  private controlClients = new Set<net.Socket>()
  private sessions = new Map<string, Session>()
  private startTime = Date.now()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly opts: Required<ServerOptions>

  constructor(opts: ServerOptions) {
    this.opts = {
      ...opts,
      idleTimeoutMs: opts.idleTimeoutMs ?? 0,
      ringBufferBytes: opts.ringBufferBytes ?? DEFAULT_RING_BUFFER_BYTES,
    }
  }

  async start(): Promise<void> {
    fs.mkdirSync(this.opts.sessionSocketDir, { recursive: true })

    // Clean up stale control socket
    try { fs.unlinkSync(this.opts.controlSocketPath) } catch {}

    // Write PID file
    const pidData: PidFileData = {
      pid: process.pid,
      token: this.opts.token,
      version: SIDECAR_VERSION,
    }
    fs.writeFileSync(this.opts.pidFilePath, JSON.stringify(pidData))

    await new Promise<void>((resolve) => {
      this.controlServer = net.createServer((sock) =>
        this.handleControlClient(sock),
      )
      this.controlServer.listen(this.opts.controlSocketPath, resolve)
    })

    this.resetIdleTimer()
  }

  async shutdown(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer)

    const ids = [...this.sessions.keys()]
    for (const id of ids) {
      this.killSession(id)
    }

    for (const client of this.controlClients) {
      client.destroy()
    }

    if (this.controlServer) {
      await new Promise<void>((resolve) =>
        this.controlServer!.close(() => resolve()),
      )
    }

    try { fs.unlinkSync(this.opts.controlSocketPath) } catch {}
    try { fs.unlinkSync(this.opts.pidFilePath) } catch {}
  }

  private handleControlClient(sock: net.Socket): void {
    this.controlClients.add(sock)
    this.resetIdleTimer()
    let buf = ""

    sock.on("data", (chunk) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        this.handleRpcMessage(sock, line)
      }
    })

    sock.on("close", () => {
      this.controlClients.delete(sock)
      this.resetIdleTimer()
    })

    sock.on("error", () => {
      this.controlClients.delete(sock)
    })
  }

  private handleRpcMessage(sock: net.Socket, line: string): void {
    let msg: JsonRpcRequest
    try {
      msg = JSON.parse(line)
    } catch {
      sock.write(makeError(0, -32700, "Parse error"))
      return
    }

    const { id, method, params } = msg

    switch (method) {
      case "sidecar.ping":
        return this.handlePing(sock, id)
      case "sidecar.shutdown":
        // Only shut down if idle (no active sessions)
        if (this.sessions.size > 0) {
          sock.write(makeResponse(id, { ok: false, reason: "sessions active" }))
        } else {
          sock.write(makeResponse(id, { ok: true }))
          void this.shutdown().then(() => process.exit(0))
        }
        return
      case "session.create":
        return this.handleCreate(sock, id, params as unknown as SessionCreateParams)
      case "session.reconnect":
        return this.handleReconnect(sock, id, params as unknown as SessionReconnectParams)
      case "session.resize":
        return this.handleResize(sock, id, params as Record<string, unknown>)
      case "session.kill":
        return this.handleKill(sock, id, params as Record<string, unknown>)
      case "session.list":
        return this.handleList(sock, id)
      case "session.snapshot":
        return this.handleSnapshot(sock, id, params as Record<string, unknown>)
      case "session.foreground":
        return this.handleForeground(sock, id, params as Record<string, unknown>)
      case "session.signal":
        return this.handleSignal(sock, id, params as Record<string, unknown>)
      default:
        sock.write(makeError(id, -32601, `Unknown method: ${method}`))
    }
  }

  private handlePing(sock: net.Socket, id: number): void {
    const result: PingResult = {
      pid: process.pid,
      uptime: Date.now() - this.startTime,
      version: SIDECAR_VERSION,
      token: this.opts.token,
    }
    sock.write(makeResponse(id, result))
  }

  private handleCreate(
    sock: net.Socket,
    id: number,
    params: SessionCreateParams,
  ): void {
    const sessionId = crypto.randomBytes(8).toString("hex")
    const socketPath = sessionSocketPath(sessionId)

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...params.env,
      ATELI_PTY_SESSION_ID: sessionId,
    }
    // Don't leak ELECTRON_RUN_AS_NODE into user shells
    delete env.ELECTRON_RUN_AS_NODE

    if (!env.LANG || !env.LANG.includes("UTF-8")) {
      env.LANG = "en_US.UTF-8"
    }

    let ptyProcess: pty.IPty
    try {
      ptyProcess = pty.spawn(params.shell, [], {
        name: "xterm-256color",
        cols: params.cols,
        rows: params.rows,
        cwd: params.cwd,
        env,
        encoding: null,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sock.write(makeError(id, -32000, `Failed to spawn: ${msg}`))
      return
    }

    const ringBuffer = new RingBuffer(this.opts.ringBufferBytes)
    const session: Session = {
      id: sessionId,
      pty: ptyProcess,
      shell: params.shell,
      cwd: params.cwd,
      createdAt: new Date().toISOString(),
      ringBuffer,
      dataServer: null!,
      dataClient: null,
      socketPath,
      hasAttachedClient: false,
      reconnectQueue: null,
    }

    // Listen for PTY output
    ptyProcess.onData((data: string | Buffer) => {
      const buf = typeof data === "string" ? Buffer.from(data) : data
      ringBuffer.write(buf)

      if (session.reconnectQueue) {
        session.reconnectQueue.push(buf)
        return
      }

      if (session.dataClient && !session.dataClient.destroyed) {
        session.dataClient.write(buf)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      const notification = makeNotification("session.exited", {
        sessionId,
        exitCode,
      })
      for (const client of this.controlClients) {
        client.write(notification)
      }
      this.cleanupSession(sessionId)
    })

    // Create per-session data socket server
    try { fs.unlinkSync(socketPath) } catch {}
    const dataServer = net.createServer((client) => {
      // Last-attach-wins: close previous client
      if (session.dataClient && !session.dataClient.destroyed) {
        session.dataClient.destroy()
      }
      session.dataClient = client

      // If reconnecting, flush ring buffer snapshot + queued data
      if (session.reconnectQueue) {
        const snapshot = ringBuffer.snapshot()
        if (snapshot.length > 0) {
          client.write(snapshot)
        }
        for (const queued of session.reconnectQueue) {
          client.write(queued)
        }
        session.reconnectQueue = null
      } else if (!session.hasAttachedClient) {
        // First attach — send any buffered output
        const snapshot = ringBuffer.snapshot()
        if (snapshot.length > 0) {
          client.write(snapshot)
        }
      }
      session.hasAttachedClient = true

      // Pipe client input to PTY
      client.on("data", (data) => {
        ptyProcess.write(data.toString())
      })

      client.on("close", () => {
        if (session.dataClient === client) {
          session.dataClient = null
        }
      })

      client.on("error", () => {
        if (session.dataClient === client) {
          session.dataClient = null
        }
      })
    })
    session.dataServer = dataServer
    this.sessions.set(sessionId, session)

    dataServer.listen(socketPath, () => {
      this.resetIdleTimer()
      const result: SessionCreateResult = {
        sessionId,
        socketPath,
        pid: ptyProcess.pid,
      }
      sock.write(makeResponse(id, result))
    })
  }

  private handleReconnect(
    sock: net.Socket,
    id: number,
    params: SessionReconnectParams,
  ): void {
    const session = this.sessions.get(params.sessionId)
    if (!session) {
      sock.write(makeError(id, -32000, `Session not found: ${params.sessionId}`))
      return
    }

    // Start queuing PTY output
    session.reconnectQueue = []

    // Resize to match new client
    session.pty.resize(params.cols, params.rows)

    // Close old data client if present
    if (session.dataClient && !session.dataClient.destroyed) {
      session.dataClient.destroy()
      session.dataClient = null
    }

    const result: SessionReconnectResult = {
      sessionId: params.sessionId,
      socketPath: session.socketPath,
    }
    sock.write(makeResponse(id, result))
  }

  private handleResize(
    sock: net.Socket,
    id: number,
    params: Record<string, unknown>,
  ): void {
    const session = this.sessions.get(params.sessionId as string)
    if (!session) {
      sock.write(makeError(id, -32000, "Session not found"))
      return
    }
    session.pty.resize(params.cols as number, params.rows as number)
    sock.write(makeResponse(id, { ok: true }))
  }

  private handleKill(
    sock: net.Socket,
    id: number,
    params: Record<string, unknown>,
  ): void {
    const sessionId = params.sessionId as string
    this.killSession(sessionId)
    sock.write(makeResponse(id, { ok: true }))
  }

  private handleList(sock: net.Socket, id: number): void {
    const sessions: SessionInfo[] = []
    for (const s of this.sessions.values()) {
      sessions.push({
        sessionId: s.id,
        shell: s.shell,
        cwd: s.cwd,
        pid: s.pty.pid,
        createdAt: s.createdAt,
      })
    }
    sock.write(makeResponse(id, { sessions }))
  }

  private handleSnapshot(
    sock: net.Socket,
    id: number,
    params: Record<string, unknown>,
  ): void {
    const session = this.sessions.get(params.sessionId as string)
    if (!session) {
      sock.write(makeError(id, -32000, "Session not found"))
      return
    }
    const snapshot = session.ringBuffer.snapshot()
    sock.write(makeResponse(id, { data: snapshot.toString("utf-8") }))
  }

  private handleForeground(
    sock: net.Socket,
    id: number,
    params: Record<string, unknown>,
  ): void {
    const session = this.sessions.get(params.sessionId as string)
    if (!session) {
      sock.write(makeError(id, -32000, "Session not found"))
      return
    }
    try {
      const { execFileSync } = require("node:child_process")
      const out = execFileSync(
        "ps",
        ["-o", "pid=,comm=", "-g", String(session.pty.pid)],
        { encoding: "utf8", timeout: 2000 },
      ).trim()
      const lines = out.split("\n").filter(Boolean)
      const last = lines[lines.length - 1]?.trim()
      const command = last ? last.replace(/^\d+\s+/, "") : session.shell
      sock.write(makeResponse(id, { command }))
    } catch {
      sock.write(makeResponse(id, { command: session.shell }))
    }
  }

  private handleSignal(
    sock: net.Socket,
    id: number,
    params: Record<string, unknown>,
  ): void {
    const session = this.sessions.get(params.sessionId as string)
    if (!session) {
      sock.write(makeError(id, -32000, "Session not found"))
      return
    }
    try {
      process.kill(session.pty.pid, params.signal as string)
      sock.write(makeResponse(id, { ok: true }))
    } catch (err) {
      sock.write(makeError(id, -32000, String(err)))
    }
  }

  private killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.pty.kill()
    if (session.dataClient && !session.dataClient.destroyed) {
      session.dataClient.destroy()
    }
    session.dataServer.close()
    try { fs.unlinkSync(session.socketPath) } catch {}
    this.sessions.delete(sessionId)
    this.resetIdleTimer()
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.dataClient && !session.dataClient.destroyed) {
      session.dataClient.destroy()
    }
    session.dataServer.close()
    try { fs.unlinkSync(session.socketPath) } catch {}
    this.sessions.delete(sessionId)
    this.resetIdleTimer()
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.opts.idleTimeoutMs <= 0) return
    if (this.sessions.size > 0 || this.controlClients.size > 0) return

    this.idleTimer = setTimeout(() => {
      if (this.sessions.size === 0 && this.controlClients.size === 0) {
        void this.shutdown().then(() => process.exit(0))
      }
    }, this.opts.idleTimeoutMs)
  }
}
```

- [ ] **Step 2: Create `entry.ts` — sidecar process entry point**

```typescript
// apps/desktop/src/main/sidecar/entry.ts
import { SidecarServer } from "./server"
import {
  SIDECAR_SOCKET_PATH,
  SIDECAR_PID_PATH,
  SESSION_SOCKET_DIR,
  IDLE_TIMEOUT_MS,
} from "./protocol"

function main(): void {
  const args = process.argv.slice(2)
  const tokenIdx = args.indexOf("--token")
  const token = tokenIdx !== -1 ? args[tokenIdx + 1] : ""

  if (!token) {
    process.stderr.write("Error: --token is required\n")
    process.exit(1)
  }

  const server = new SidecarServer({
    controlSocketPath: SIDECAR_SOCKET_PATH,
    sessionSocketDir: SESSION_SOCKET_DIR,
    pidFilePath: SIDECAR_PID_PATH,
    token,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
  })

  process.on("SIGTERM", () => {
    void server.shutdown().then(() => process.exit(0))
  })

  process.on("SIGINT", () => {
    void server.shutdown().then(() => process.exit(0))
  })

  void server.start()
}

main()
```

- [ ] **Step 3: Add sidecar as a separate build entry in `electron.vite.config.ts`**

The sidecar runs as a detached child process. It needs its own build entry so electron-vite compiles it alongside the main process.

```typescript
// apps/desktop/electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "src/main/index.ts"),
          "sidecar-entry": path.resolve(__dirname, "src/main/sidecar/entry.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/renderer"),
        "@workspace/ui": path.resolve(__dirname, "../../packages/ui/src"),
      },
    },
  },
})
```

- [ ] **Step 4: Verify the build works**

Run: `cd apps/desktop && npx electron-vite build 2>&1 | tail -10`
Expected: Build completes. `out/main/sidecar-entry.js` exists alongside `out/main/index.js`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/sidecar/server.ts apps/desktop/src/main/sidecar/entry.ts apps/desktop/electron.vite.config.ts
git commit -m "feat: add sidecar server and entry point"
```

---

### Task 3: Sidecar Client

The main process uses this to spawn, connect to, and communicate with the sidecar.

**Files:**
- Create: `apps/desktop/src/main/sidecar/client.ts`

- [ ] **Step 1: Create `client.ts` — SidecarClient class**

```typescript
// apps/desktop/src/main/sidecar/client.ts
import * as net from "node:net"
import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { spawn } from "node:child_process"
import {
  makeRequest,
  SIDECAR_SOCKET_PATH,
  SIDECAR_PID_PATH,
  SIDECAR_VERSION,
  type JsonRpcResponse,
  type SessionCreateParams,
  type SessionCreateResult,
  type SessionReconnectResult,
  type SessionInfo,
  type PingResult,
  type PidFileData,
} from "./protocol"

type NotificationHandler = (
  method: string,
  params: Record<string, unknown>,
) => void

export class SidecarClient {
  private socket: net.Socket | null = null
  private nextId = 1
  private pending = new Map<
    number,
    {
      resolve: (resp: JsonRpcResponse) => void
      reject: (err: Error) => void
    }
  >()
  private buf = ""
  private notificationHandler: NotificationHandler | null = null
  private sidecarStarting: Promise<void> | null = null

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler
  }

  /**
   * Ensure sidecar is running and we're connected.
   * Coalesces concurrent calls to prevent parallel spawn races.
   */
  async ensureSidecar(): Promise<void> {
    if (this.sidecarStarting) return this.sidecarStarting
    this.sidecarStarting = this._ensureSidecar()
    try {
      await this.sidecarStarting
    } finally {
      this.sidecarStarting = null
    }
  }

  private async _ensureSidecar(): Promise<void> {
    // Check if already connected and responsive
    if (this.socket) {
      try {
        await this.ping()
        return
      } catch {
        this.disconnect()
      }
    }

    // Check PID file for existing sidecar
    const existing = this.readPidFile()
    if (existing) {
      try {
        process.kill(existing.pid, 0) // Check if alive
        if (existing.version === SIDECAR_VERSION) {
          await this.connect()
          const pong = await this.ping()
          if (pong.token === existing.token) return
        }
      } catch {
        // Dead or wrong version — respawn
      }
      this.disconnect()
    }

    // Spawn new sidecar
    const token = crypto.randomUUID()
    const sidecarEntry = path.join(__dirname, "sidecar-entry.js")

    const child = spawn(process.execPath, [sidecarEntry, "--token", token], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    })
    child.unref()

    // Wait for sidecar to be ready (poll PID file)
    await this.waitForSidecar(token, 5000)
    await this.connect()
  }

  private readPidFile(): PidFileData | null {
    try {
      const raw = fs.readFileSync(SIDECAR_PID_PATH, "utf-8")
      return JSON.parse(raw) as PidFileData
    } catch {
      return null
    }
  }

  private async waitForSidecar(token: string, timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const pid = this.readPidFile()
      if (pid && pid.token === token) {
        // Socket might not be listening yet — try connecting
        try {
          await this.connect()
          return
        } catch {
          // Socket not ready yet
          this.disconnect()
        }
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error("Sidecar failed to start within timeout")
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(SIDECAR_SOCKET_PATH, () => {
        this.socket!.removeListener("error", reject)
        this.socket!.on("error", () => this.rejectAllPending())
        this.socket!.on("close", () => this.rejectAllPending())
        resolve()
      })
      this.socket.on("error", reject)
      this.socket.on("data", (chunk) => this.handleData(chunk))
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.rejectAllPending()
  }

  private rejectAllPending(): void {
    const err = new Error("Sidecar connection lost")
    for (const [, { reject }] of this.pending) {
      reject(err)
    }
    this.pending.clear()
  }

  private handleData(chunk: Buffer): void {
    this.buf += chunk.toString()
    let nl: number
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + 1)
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }

      if (msg.id === undefined) {
        this.notificationHandler?.(
          msg.method as string,
          (msg.params ?? {}) as Record<string, unknown>,
        )
        continue
      }

      const pending = this.pending.get(msg.id as number)
      if (pending) {
        this.pending.delete(msg.id as number)
        pending.resolve(msg as unknown as JsonRpcResponse)
      }
    }
  }

  private async rpc(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.socket) throw new Error("Not connected to sidecar")
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, 10_000)

      this.pending.set(id, {
        resolve: (resp) => {
          clearTimeout(timer)
          if (resp.error) {
            reject(new Error(resp.error.message))
          } else {
            resolve(resp.result)
          }
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
      this.socket!.write(makeRequest(id, method, params))
    })
  }

  async ping(): Promise<PingResult> {
    return this.rpc("sidecar.ping") as Promise<PingResult>
  }

  async createSession(params: SessionCreateParams): Promise<SessionCreateResult> {
    return this.rpc(
      "session.create",
      params as unknown as Record<string, unknown>,
    ) as Promise<SessionCreateResult>
  }

  async reconnectSession(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<SessionReconnectResult> {
    return this.rpc("session.reconnect", { sessionId, cols, rows }) as Promise<SessionReconnectResult>
  }

  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.rpc("session.resize", { sessionId, cols, rows })
  }

  async killSession(sessionId: string): Promise<void> {
    await this.rpc("session.kill", { sessionId })
  }

  async listSessions(): Promise<SessionInfo[]> {
    const result = (await this.rpc("session.list")) as { sessions: SessionInfo[] }
    return result.sessions
  }

  async snapshotSession(sessionId: string): Promise<string> {
    const result = (await this.rpc("session.snapshot", { sessionId })) as { data: string }
    return result.data
  }

  async shutdownIfIdle(): Promise<void> {
    try {
      await this.rpc("sidecar.shutdown")
    } catch {
      // Already dead or not connected
    }
  }

  async attachDataSocket(
    socketPath: string,
    onData: (data: Buffer) => void,
  ): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(socketPath, () => {
        resolve(sock)
      })
      sock.on("data", (chunk) => onData(chunk))
      sock.on("error", reject)
    })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors from `sidecar/client.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/sidecar/client.ts
git commit -m "feat: add sidecar client with spawn and reconnect"
```

---

### Task 4: PTY Orchestration Layer

Bridges the sidecar to Electron IPC and manages session metadata persistence.

**Files:**
- Create: `apps/desktop/src/main/pty.ts`

- [ ] **Step 1: Create `pty.ts` — PtyManager class**

```typescript
// apps/desktop/src/main/pty.ts
import * as net from "node:net"
import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import os from "node:os"
import { BrowserWindow } from "electron"
import { SidecarClient } from "./sidecar/client"
import type { SessionCreateResult } from "./sidecar/protocol"
import { broadcast } from "./rpc"

const ATELI_DIR = path.join(os.homedir(), ".ateli")
const SESSIONS_PATH = path.join(ATELI_DIR, "sessions.json")

export interface TerminalMetadata {
  id: string
  name?: string
  sidecarSessionId: string
  shell: string
  cwd: string
  pid: number | null
  createdAt: string
}

interface ActiveSession {
  metadata: TerminalMetadata
  dataSocket: net.Socket | null
}

export class PtyManager {
  private client: SidecarClient
  private sessions = new Map<string, ActiveSession>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.client = new SidecarClient()
  }

  async init(): Promise<void> {
    this.client.onNotification((method, params) => {
      if (method === "session.exited") {
        this.handleSessionExited(
          params.sessionId as string,
          params.exitCode as number,
        )
      }
    })

    await this.client.ensureSidecar()
    await this.discoverSessions()
    await this.cleanDetachedSessions()
  }

  async createSession(opts: {
    cwd: string
    name?: string
  }): Promise<{ id: string; sessionKey: string }> {
    await this.client.ensureSidecar()

    const shell = process.env.SHELL || "/bin/zsh"
    const result: SessionCreateResult = await this.client.createSession({
      shell,
      cwd: opts.cwd,
      cols: 80,
      rows: 24,
    })

    const id = crypto.randomUUID().slice(0, 8)
    const metadata: TerminalMetadata = {
      id,
      name: opts.name,
      sidecarSessionId: result.sessionId,
      shell,
      cwd: opts.cwd,
      pid: result.pid,
      createdAt: new Date().toISOString(),
    }

    const session: ActiveSession = { metadata, dataSocket: null }
    this.sessions.set(id, session)
    this.saveSessionsImmediate()

    // Attach data socket and pipe to renderer
    await this.attachDataSocket(id, result.socketPath)

    return { id, sessionKey: result.sessionId }
  }

  async reconnectSession(
    id: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Unknown session: ${id}`)

    await this.client.ensureSidecar()
    const result = await this.client.reconnectSession(
      session.metadata.sidecarSessionId,
      cols,
      rows,
    )

    // Destroy old data socket if present
    if (session.dataSocket && !session.dataSocket.destroyed) {
      session.dataSocket.destroy()
      session.dataSocket = null
    }

    // Attach new data socket — sidecar will flush ring buffer + queued data
    await this.attachDataSocket(id, result.socketPath)
  }

  async writeSession(id: string, data: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session?.dataSocket) return
    session.dataSocket.write(data)
  }

  async resizeSession(id: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    await this.client.resizeSession(session.metadata.sidecarSessionId, cols, rows)
  }

  async killSession(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    // Close data socket
    if (session.dataSocket && !session.dataSocket.destroyed) {
      session.dataSocket.destroy()
    }
    // Ask sidecar to kill — session.exited notification handles cleanup
    try {
      await this.client.killSession(session.metadata.sidecarSessionId)
    } catch {
      // Already dead
    }
  }

  /**
   * Detach from a session without killing it. Used when terminal shape unmounts.
   */
  detachSession(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.dataSocket && !session.dataSocket.destroyed) {
      session.dataSocket.destroy()
      session.dataSocket = null
    }
  }

  async readSession(id: string): Promise<string> {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Unknown session: ${id}`)
    return this.client.snapshotSession(session.metadata.sidecarSessionId)
  }

  listSessions(): TerminalMetadata[] {
    return [...this.sessions.values()].map((s) => s.metadata)
  }

  async shutdown(): Promise<void> {
    // Detach all data sockets (don't kill sessions — sidecar keeps them)
    for (const session of this.sessions.values()) {
      if (session.dataSocket && !session.dataSocket.destroyed) {
        session.dataSocket.destroy()
      }
    }
    // Graceful shutdown if idle
    await this.client.shutdownIfIdle()
    this.client.disconnect()
  }

  // --- Internal ---

  private async attachDataSocket(id: string, socketPath: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return

    const dataSocket = await this.client.attachDataSocket(
      socketPath,
      (data) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.webContents.send(
            `terminal:data:${session.metadata.sidecarSessionId}`,
            data.toString(),
          )
        }
      },
    )
    session.dataSocket = dataSocket
  }

  private handleSessionExited(sidecarSessionId: string, exitCode: number): void {
    // Find our session by sidecar ID
    let found: { id: string; session: ActiveSession } | null = null
    for (const [id, session] of this.sessions) {
      if (session.metadata.sidecarSessionId === sidecarSessionId) {
        found = { id, session }
        break
      }
    }
    if (!found) return

    // Cleanup
    if (found.session.dataSocket && !found.session.dataSocket.destroyed) {
      found.session.dataSocket.destroy()
    }
    this.sessions.delete(found.id)
    this.saveSessionsImmediate()

    // Notify renderer
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send(`terminal:exit:${sidecarSessionId}`, exitCode)
    }

    // Broadcast to external RPC clients
    broadcast("terminal.exit", { id: found.id, sessionKey: sidecarSessionId, exitCode })
  }

  private async discoverSessions(): Promise<void> {
    const persisted = this.loadSessions()
    if (persisted.length === 0) return

    let liveSessions: Set<string>
    try {
      const sidecarSessions = await this.client.listSessions()
      liveSessions = new Set(sidecarSessions.map((s) => s.sessionId))
    } catch {
      liveSessions = new Set()
    }

    for (const meta of persisted) {
      if (liveSessions.has(meta.sidecarSessionId)) {
        this.sessions.set(meta.id, { metadata: meta, dataSocket: null })
      }
      // Dead sessions are simply not loaded — they get pruned
    }

    this.saveSessionsImmediate()
  }

  private async cleanDetachedSessions(): Promise<void> {
    try {
      const sidecarSessions = await this.client.listSessions()
      const knownSidecarIds = new Set(
        [...this.sessions.values()].map((s) => s.metadata.sidecarSessionId),
      )
      for (const session of sidecarSessions) {
        if (!knownSidecarIds.has(session.sessionId)) {
          await this.client.killSession(session.sessionId)
        }
      }
    } catch {
      // Sidecar not available
    }
  }

  private loadSessions(): TerminalMetadata[] {
    try {
      const raw = fs.readFileSync(SESSIONS_PATH, "utf-8")
      return JSON.parse(raw) as TerminalMetadata[]
    } catch {
      return []
    }
  }

  private saveSessionsImmediate(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const data = [...this.sessions.values()].map((s) => s.metadata)
    fs.mkdirSync(ATELI_DIR, { recursive: true })
    const tmp = SESSIONS_PATH + "." + crypto.randomUUID().slice(0, 8)
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, SESSIONS_PATH)
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors from `pty.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/pty.ts
git commit -m "feat: add PTY orchestration layer bridging sidecar to Electron"
```

---

### Task 5: Rewrite RPC Server

Replace the tmux-backed monolithic RPC with a proper router and sidecar-backed handlers.

**Files:**
- Modify: `apps/desktop/src/main/rpc.ts`

- [ ] **Step 1: Rewrite `rpc.ts` with router pattern and new methods**

```typescript
// apps/desktop/src/main/rpc.ts
import net from "node:net"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { BrowserWindow, ipcMain } from "electron"
import type { PtyManager } from "./pty"

const ATELI_DIR = path.join(os.homedir(), ".ateli")
const SOCKET_PATH_FILE = path.join(ATELI_DIR, "socket-path")
const TOKEN_PATH = path.join(ATELI_DIR, "server.token")
const SHAPES_TIMEOUT_MS = 5000

type RpcHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>

let server: net.Server | null = null
let socketPath: string | null = null
let nonce: string | null = null
const authenticatedClients = new Set<net.Socket>()

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function broadcast(method: string, params: Record<string, unknown>): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"
  for (const client of authenticatedClients) {
    if (!client.destroyed) {
      client.write(msg)
    }
  }
}

export function startRpcServer(ptyManager: PtyManager) {
  fs.mkdirSync(ATELI_DIR, { recursive: true })

  // Generate auth nonce
  nonce = crypto.randomUUID()
  fs.writeFileSync(TOKEN_PATH, nonce)

  socketPath = path.join(ATELI_DIR, `rpc-${crypto.randomUUID().slice(0, 8)}.sock`)
  try { fs.unlinkSync(socketPath) } catch {}

  // Clean up stale sockets
  try {
    const entries = fs.readdirSync(ATELI_DIR)
    for (const entry of entries) {
      if (!entry.startsWith("rpc-") || !entry.endsWith(".sock")) continue
      if (path.join(ATELI_DIR, entry) === socketPath) continue
      const fullPath = path.join(ATELI_DIR, entry)
      const sock = net.createConnection(fullPath)
      sock.on("error", () => {
        try { fs.unlinkSync(fullPath) } catch {}
      })
      sock.on("connect", () => sock.destroy())
    }
  } catch {}

  // Method registry
  const methods = new Map<string, RpcHandler>()

  methods.set("rpc.discover", () => ({
    methods: Array.from(methods.keys()),
  }))

  // --- Terminal methods ---

  methods.set("terminal.create", async (params) => {
    const cwd = params.cwd as string | undefined
    const win = getMainWindow()
    if (!cwd && !win) throw new Error("cwd is required when no window is open")
    const result = await ptyManager.createSession({
      cwd: cwd || process.cwd(),
      name: params.name as string | undefined,
    })
    broadcast("terminal.created", { id: result.id, sessionKey: result.sessionKey })
    return result
  })

  methods.set("terminal.list", () => {
    return { sessions: ptyManager.listSessions() }
  })

  methods.set("terminal.write", async (params) => {
    const id = params.id as string
    if (!id) throw new Error("id is required")
    const data = params.data as string
    if (typeof data !== "string") throw new Error("data is required")
    await ptyManager.writeSession(id, data)
    return { ok: true }
  })

  methods.set("terminal.resize", async (params) => {
    const id = params.id as string
    if (!id) throw new Error("id is required")
    await ptyManager.resizeSession(id, params.cols as number, params.rows as number)
    return { ok: true }
  })

  methods.set("terminal.kill", async (params) => {
    const id = params.id as string
    if (!id) throw new Error("id is required")
    await ptyManager.killSession(id)
    // terminal.exit broadcast happens via session.exited handler in pty.ts
    return { ok: true }
  })

  methods.set("terminal.reconnect", async (params) => {
    const id = params.id as string
    if (!id) throw new Error("id is required")
    await ptyManager.reconnectSession(id, params.cols as number ?? 80, params.rows as number ?? 24)
    return { ok: true }
  })

  methods.set("terminal.read", async (params) => {
    const id = params.id as string
    if (!id) throw new Error("id is required")
    const data = await ptyManager.readSession(id)
    return { data }
  })

  // --- Canvas methods ---

  methods.set("canvas.getShapes", async () => {
    const win = getMainWindow()
    if (!win) throw new Error("No window available")

    return new Promise((resolve, reject) => {
      const channel = `rpc:shapes-response:${crypto.randomUUID()}`
      const timer = setTimeout(() => {
        ipcMain.removeAllListeners(channel)
        reject(new Error("Timed out waiting for renderer"))
      }, SHAPES_TIMEOUT_MS)

      ipcMain.once(channel, (_event, shapes) => {
        clearTimeout(timer)
        resolve(shapes)
      })

      win.webContents.send("rpc:get-shapes", { responseChannel: channel })
    })
  })

  methods.set("canvas.createTerminal", async (params) => {
    const win = getMainWindow()
    if (!win) throw new Error("No window available")

    const x = typeof params.x === "number" ? params.x : 0
    const y = typeof params.y === "number" ? params.y : 0
    const w = typeof params.w === "number" ? params.w : 600
    const h = typeof params.h === "number" ? params.h : 400

    const shapeId = `shape:rpc-${crypto.randomUUID().slice(0, 12)}`
    win.webContents.send("rpc:create-terminal", { shapeId, x, y, w, h })
    return { shapeId }
  })

  // --- Workspace methods ---

  methods.set("workspace.context", async (params) => {
    const win = getMainWindow()
    if (!win) throw new Error("No window available")

    const sessionKey = params.sessionKey as string
    if (!sessionKey) throw new Error("sessionKey is required")

    return new Promise((resolve, reject) => {
      const channel = `rpc:context-response:${crypto.randomUUID()}`
      const timer = setTimeout(() => {
        ipcMain.removeAllListeners(channel)
        reject(new Error("Timed out waiting for renderer"))
      }, SHAPES_TIMEOUT_MS)

      ipcMain.once(channel, (_event, context) => {
        clearTimeout(timer)
        resolve(context)
      })

      win.webContents.send("rpc:get-context", { sessionKey, responseChannel: channel })
    })
  })

  // --- Server ---

  server = net.createServer((conn) => {
    let buffer = ""
    let authenticated = false

    conn.on("data", async (chunk) => {
      buffer += chunk.toString()

      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (!line) continue

        // First message must be auth token
        if (!authenticated) {
          if (line === nonce) {
            authenticated = true
            authenticatedClients.add(conn)
            conn.write(JSON.stringify({ jsonrpc: "2.0", id: 0, result: { authenticated: true } }) + "\n")
          } else {
            conn.write(JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: -32005, message: "Auth required" } }) + "\n")
            conn.destroy()
          }
          continue
        }

        try {
          const body = JSON.parse(line)
          const id = body.id ?? null

          if (body.jsonrpc !== "2.0") {
            conn.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } }) + "\n")
            continue
          }

          const handler = methods.get(body.method)
          if (!handler) {
            conn.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${body.method}` } }) + "\n")
            continue
          }

          try {
            const result = await Promise.race([
              handler(body.params ?? {}),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Request timeout")), 10_000),
              ),
            ])
            conn.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
          } catch (err) {
            conn.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: String(err) } }) + "\n")
          }
        } catch {
          conn.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n")
        }
      }
    })

    conn.on("close", () => {
      authenticatedClients.delete(conn)
    })

    conn.on("error", () => {
      authenticatedClients.delete(conn)
    })
  })

  server.listen(socketPath)
  fs.writeFileSync(SOCKET_PATH_FILE, socketPath)
}

export { broadcast }

export function stopRpcServer() {
  if (server) {
    server.close()
    server = null
  }
  if (socketPath) {
    try { fs.unlinkSync(socketPath) } catch {}
  }
  try { fs.unlinkSync(SOCKET_PATH_FILE) } catch {}
  try { fs.unlinkSync(TOKEN_PATH) } catch {}
  authenticatedClients.clear()
}

process.on("SIGTERM", () => stopRpcServer())
process.on("SIGINT", () => stopRpcServer())
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors from `rpc.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/rpc.ts
git commit -m "feat: rewrite RPC server with router, auth, and sidecar-backed handlers"
```

---

### Task 6: Rewire Electron Main Process

Gut `index.ts` to a thin shell that delegates to `PtyManager` and the RPC server. Delete `pty-store.ts`.

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Delete: `apps/desktop/src/main/pty-store.ts`

- [ ] **Step 1: Rewrite `index.ts`**

```typescript
// apps/desktop/src/main/index.ts
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import path from "node:path"
import { PtyManager } from "./pty"
import { startRpcServer, stopRpcServer } from "./rpc"

const ptyManager = new PtyManager()

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      sandbox: false,
    },
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"))
  }
}

// --- IPC Handlers ---

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Select a project folder",
  })
  if (result.canceled) return null
  return result.filePaths[0] ?? null
})

ipcMain.handle(
  "terminal:create",
  async (_event, { cwd }: { shapeId: string; cwd: string }) => {
    const result = await ptyManager.createSession({ cwd })
    return { pid: null, sessionKey: result.sessionKey }
  },
)

ipcMain.handle(
  "terminal:reconnect",
  async (_event, { sessionKey, cols, rows }: { sessionKey: string; cols: number; rows: number }) => {
    // Find session by sidecar session ID
    const sessions = ptyManager.listSessions()
    const meta = sessions.find((s) => s.sidecarSessionId === sessionKey)
    if (!meta) throw new Error(`Unknown session: ${sessionKey}`)
    await ptyManager.reconnectSession(meta.id, cols, rows)
  },
)

function findSessionByKey(sessionKey: string) {
  const sessions = ptyManager.listSessions()
  return sessions.find((s) => s.sidecarSessionId === sessionKey)
}

ipcMain.on(
  "terminal:input",
  (_event, { sessionKey, data }: { sessionKey: string; data: string }) => {
    const meta = findSessionByKey(sessionKey)
    if (!meta) { console.warn(`terminal:input — unknown session: ${sessionKey}`); return }
    void ptyManager.writeSession(meta.id, data)
  },
)

ipcMain.on(
  "terminal:resize",
  (_event, { sessionKey, cols, rows }: { sessionKey: string; cols: number; rows: number }) => {
    const meta = findSessionByKey(sessionKey)
    if (!meta) { console.warn(`terminal:resize — unknown session: ${sessionKey}`); return }
    void ptyManager.resizeSession(meta.id, cols, rows)
  },
)

ipcMain.on("terminal:dispose", (_event, { sessionKey }: { sessionKey: string }) => {
  const meta = findSessionByKey(sessionKey)
  if (!meta) { console.warn(`terminal:dispose — unknown session: ${sessionKey}`); return }
  void ptyManager.killSession(meta.id)
})

ipcMain.on("terminal:detach", (_event, { sessionKey }: { sessionKey: string }) => {
  const meta = findSessionByKey(sessionKey)
  if (!meta) return // Silent — detach on already-dead session is fine
  ptyManager.detachSession(meta.id)
})

// --- App Lifecycle ---

app.whenReady().then(async () => {
  createWindow()
  await ptyManager.init()
  startRpcServer(ptyManager)

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("before-quit", () => {
  stopRpcServer()
  void ptyManager.shutdown()
})
```

- [ ] **Step 2: Delete `pty-store.ts`**

```bash
git rm apps/desktop/src/main/pty-store.ts
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors. No references to `pty-store` remain.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat: rewire main process as thin shell, delete pty-store.ts"
```

---

### Task 7: Update Preload Bridge & Type Declarations

Add `terminal.reconnect` and `terminal.detach` to the preload API.

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/env.d.ts`

- [ ] **Step 1: Update `preload/index.ts`**

```typescript
// apps/desktop/src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron"

function onIpc<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  selectFolder: () => ipcRenderer.invoke("select-folder") as Promise<string | null>,
  terminal: {
    create: (shapeId: string, cwd: string) =>
      ipcRenderer.invoke("terminal:create", { shapeId, cwd }) as Promise<{
        pid: number | null
        sessionKey: string
      }>,
    reconnect: (sessionKey: string, cols: number, rows: number) =>
      ipcRenderer.invoke("terminal:reconnect", { sessionKey, cols, rows }) as Promise<void>,
    write: (sessionKey: string, data: string) =>
      ipcRenderer.send("terminal:input", { sessionKey, data }),
    resize: (sessionKey: string, cols: number, rows: number) =>
      ipcRenderer.send("terminal:resize", { sessionKey, cols, rows }),
    dispose: (sessionKey: string) =>
      ipcRenderer.send("terminal:dispose", { sessionKey }),
    detach: (sessionKey: string) =>
      ipcRenderer.send("terminal:detach", { sessionKey }),
    onData: (sessionKey: string, callback: (data: string) => void) =>
      onIpc(`terminal:data:${sessionKey}`, callback),
    onExit: (sessionKey: string, callback: () => void) =>
      onIpc(`terminal:exit:${sessionKey}`, callback),
  },
  rpc: {
    onCreateTerminal: (callback: (data: { shapeId: string; x: number; y: number; w: number; h: number }) => void) =>
      onIpc("rpc:create-terminal", callback),
    onGetShapes: (callback: (data: { responseChannel: string }) => void) =>
      onIpc("rpc:get-shapes", callback),
    respondShapes: (channel: string, shapes: unknown) => {
      if (!channel.startsWith("rpc:shapes-response:")) {
        throw new Error("Invalid response channel")
      }
      ipcRenderer.send(channel, shapes)
    },
  },
})
```

- [ ] **Step 2: Update `env.d.ts` with new types**

```typescript
// apps/desktop/src/renderer/env.d.ts
interface Window {
  electron: {
    platform: string
    selectFolder: () => Promise<string | null>
    terminal: {
      create: (
        shapeId: string,
        cwd: string,
      ) => Promise<{ pid: number | null; sessionKey: string }>
      reconnect: (sessionKey: string, cols: number, rows: number) => Promise<void>
      write: (sessionKey: string, data: string) => void
      resize: (sessionKey: string, cols: number, rows: number) => void
      dispose: (sessionKey: string) => void
      detach: (sessionKey: string) => void
      onData: (sessionKey: string, callback: (data: string) => void) => () => void
      onExit: (sessionKey: string, callback: () => void) => () => void
    }
    rpc: {
      onCreateTerminal: (callback: (data: { shapeId: string; x: number; y: number; w: number; h: number }) => void) => () => void
      onGetShapes: (callback: (data: { responseChannel: string }) => void) => () => void
      respondShapes: (channel: string, shapes: unknown) => void
    }
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/renderer/env.d.ts
git commit -m "feat: add reconnect and detach to preload bridge"
```

---

### Task 8: Update Terminal Shape Component

Add `sidecarSessionId` to shape props, implement reconnect-on-mount, detach-on-unmount.

**Files:**
- Modify: `apps/desktop/src/renderer/shapes/terminal-shape.tsx`

- [ ] **Step 1: Update terminal shape with reconnection support**

Replace the full file content:

```typescript
// apps/desktop/src/renderer/shapes/terminal-shape.tsx
import { useEffect, useRef } from "react"
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
  useEditor,
} from "tldraw"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"

const TERMINAL_SHAPE_TYPE = "terminal" as const

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [TERMINAL_SHAPE_TYPE]: { w: number; h: number; sidecarSessionId?: string }
  }
}

type TerminalShape = TLShape<typeof TERMINAL_SHAPE_TYPE>

function TerminalComponent({
  shape,
  isInteractive,
  cwd,
}: {
  shape: TerminalShape
  isInteractive: boolean
  cwd: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const editor = useEditor()

  useEffect(() => {
    if (!containerRef.current) return

    const shapeId = shape.id
    const existingSessionId = shape.props.sidecarSessionId
    const state = {
      disposed: false,
      sessionKey: existingSessionId ?? (null as string | null),
      removeData: null as null | (() => void),
      removeExit: null as null | (() => void),
    }

    const term = new Terminal({
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      theme: {
        background: "#1a1a1a",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        selectionBackground: "#ffffff30",
        black: "#1a1a1a",
        brightBlack: "#555555",
        white: "#e0e0e0",
        brightWhite: "#ffffff",
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    function attachSession(sessionKey: string) {
      state.sessionKey = sessionKey

      state.removeData = window.electron.terminal.onData(sessionKey, (data) => {
        term.write(data)
      })

      state.removeExit = window.electron.terminal.onExit(sessionKey, () => {
        // Session died — clear the binding
        editor.updateShape<TerminalShape>({
          id: shapeId,
          type: TERMINAL_SHAPE_TYPE,
          props: { sidecarSessionId: undefined },
        })
        term.write("\r\n[Session ended]\r\n")
      })

      term.onResize(({ cols, rows }) => {
        if (!state.disposed && state.sessionKey) {
          window.electron.terminal.resize(state.sessionKey, cols, rows)
        }
      })

      term.onData((data) => {
        if (!state.disposed && state.sessionKey) {
          window.electron.terminal.write(state.sessionKey, data)
        }
      })

      fitAddon.fit()
      const dim = term.dimensions
      if (dim) {
        window.electron.terminal.resize(sessionKey, dim.cols, dim.rows)
      }
    }

    ;(async () => {
      try {
        if (existingSessionId) {
          // Reconnect to existing session
          try {
            const dim = term.dimensions
            await window.electron.terminal.reconnect(
              existingSessionId,
              dim?.cols ?? 80,
              dim?.rows ?? 24,
            )
            if (state.disposed) return
            attachSession(existingSessionId)
            return
          } catch {
            // Session not found — clear prop and create new
            editor.updateShape<TerminalShape>({
              id: shapeId,
              type: TERMINAL_SHAPE_TYPE,
              props: { sidecarSessionId: undefined },
            })
          }
        }

        // Create new session
        const { sessionKey } = await window.electron.terminal.create(shapeId, cwd)
        if (state.disposed) {
          window.electron.terminal.dispose(sessionKey)
          return
        }

        // Store sidecar session ID in shape props for reconnection
        editor.updateShape<TerminalShape>({
          id: shapeId,
          type: TERMINAL_SHAPE_TYPE,
          props: { sidecarSessionId: sessionKey },
        })

        attachSession(sessionKey)
      } catch (err: unknown) {
        term.write(`\r\nFailed to create terminal: ${err}\r\n`)
      }
    })()

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
    })
    observer.observe(containerRef.current)

    return () => {
      state.disposed = true
      observer.disconnect()
      state.removeData?.()
      state.removeExit?.()
      // Detach, don't kill — session stays alive in sidecar
      if (state.sessionKey) {
        window.electron.terminal.detach(state.sessionKey)
      }
      term.dispose()
    }
  }, [cwd, shape.id])

  useEffect(() => {
    fitRef.current?.fit()
  }, [shape.props.w, shape.props.h])

  useEffect(() => {
    if (isInteractive) {
      termRef.current?.focus()
    } else {
      termRef.current?.blur()
    }
  }, [isInteractive, shape.id])

  useEffect(() => {
    if (!isInteractive) return
    const el = containerRef.current
    if (!el) return

    const stopBubble = (e: Event) => {
      e.stopPropagation()
    }

    el.addEventListener("keydown", stopBubble)
    el.addEventListener("keyup", stopBubble)
    el.addEventListener("keypress", stopBubble)
    el.addEventListener("pointerdown", stopBubble)
    el.addEventListener("touchstart", stopBubble)
    el.addEventListener("touchend", stopBubble)

    return () => {
      el.removeEventListener("keydown", stopBubble)
      el.removeEventListener("keyup", stopBubble)
      el.removeEventListener("keypress", stopBubble)
      el.removeEventListener("pointerdown", stopBubble)
      el.removeEventListener("touchstart", stopBubble)
      el.removeEventListener("touchend", stopBubble)
    }
  }, [isInteractive])

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        padding: 8,
        background: "#1a1a1a",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border)",
        boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      }}
    />
  )
}

// Store cwd at module level so the shape util can access it
let _cwd = ""

export function setTerminalCwd(cwd: string) {
  _cwd = cwd
}

export class TerminalShapeUtil extends BaseBoxShapeUtil<TerminalShape> {
  static override type = TERMINAL_SHAPE_TYPE
  static override props: RecordProps<TerminalShape> = {
    w: T.number,
    h: T.number,
    sidecarSessionId: T.string.optional(),
  }

  override canEdit() {
    return true
  }

  override canResize() {
    return true
  }

  getDefaultProps(): TerminalShape["props"] {
    return { w: 600, h: 400 }
  }

  component(shape: TerminalShape) {
    const selectedIds = this.editor.getSelectedShapeIds()
    const isSoleSelected =
      selectedIds.length === 1 && selectedIds[0] === shape.id
    const isEditing = this.editor.getEditingShapeId() === shape.id
    const isInteractive = isEditing || isSoleSelected

    return (
      <HTMLContainer
        id={shape.id}
        style={{ pointerEvents: isInteractive ? "all" : "none" }}
      >
        <TerminalComponent shape={shape} isInteractive={isInteractive} cwd={_cwd} />
      </HTMLContainer>
    )
  }

  indicator(shape: TerminalShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/shapes/terminal-shape.tsx
git commit -m "feat: terminal shape with reconnect-on-mount and detach-on-unmount"
```

---

### Task 9: Integration Test — Build & Run

Verify the full system works end-to-end.

**Files:** None (testing only)

- [ ] **Step 1: Verify clean build**

Run: `cd apps/desktop && npx electron-vite build 2>&1 | tail -20`
Expected: Build succeeds. `out/main/index.js` and `out/main/sidecar-entry.js` both exist.

- [ ] **Step 2: Verify no leftover tmux references**

Run: `cd apps/desktop && grep -r "tmux\|pty-store" src/ --include="*.ts" --include="*.tsx"`
Expected: No output (zero matches)

- [ ] **Step 3: Verify sidecar entry point is self-contained**

Run: `cd apps/desktop && node -e "require('./out/main/sidecar-entry.js')" 2>&1 | head -5`
Expected: Error about `--token is required` (expected — confirms the entry point loads and runs)

- [ ] **Step 4: Run the app in dev mode**

Run: `cd apps/desktop && npx electron-vite dev`
Manual verification:
1. App launches, shows folder picker or canvas
2. Click "Add Terminal" — terminal appears and is interactive
3. Type a command (e.g. `echo hello`) — output renders
4. Check `~/.ateli/sessions.json` — has an entry
5. Check `~/.ateli/pty-sidecar.pid` — sidecar is running
6. Close and reopen the app — terminal reconnects with scrollback

- [ ] **Step 5: Commit any fixups needed from testing**

```bash
git add -A && git commit -m "fix: integration test fixups"
```

(Only if needed — skip if everything passes clean)

---

### Task 10: Final Cleanup

- [ ] **Step 1: Verify `~/.collaborator/` references are gone**

Run: `cd apps/desktop && grep -r "collaborator" src/ --include="*.ts" --include="*.tsx"`
Expected: No output

- [ ] **Step 2: Verify no unused imports or dead code**

Run: `cd apps/desktop && npx tsc --noEmit --pretty`
Expected: Clean compile

- [ ] **Step 3: Final commit with ADR update**

The ADR was already updated in the spec phase. Verify it's committed:

Run: `git log --oneline -5`
Expected: See the spec commits from earlier

- [ ] **Step 4: Done**

The refactor is complete. Terminal sessions now run in a detached sidecar process, survive app restarts, and support scrollback replay via ring buffers. The RPC server is agent-ready with auth and broadcast notifications. tmux is gone.

# Plan: Security Hardening (RPC + Sidecar + Renderer)

> Findings #2 and #10 from `docs/architecture-review-2026-04-22.md`.
> Status: **locked — ready for Codex.**

**Goal:** Fix the discrete security bugs in the desktop app's local RPC, PTY sidecar control socket, home-dir permissions, and Electron renderer sandbox/CSP. Not addressing the broader "RPC trust model" framing — just the real bugs and the unwired surface.

**Why now:** these are small, discrete fixes concentrated in `apps/desktop/src/main/`, independent of the renderer work from finding #6. Cheap, high signal.

**Decisions baked in:**
- **No peer-credential check on Unix sockets for now.** 0600/0700 perms give the same practical guarantee (same-user-only) with no Node/platform complexity. Revisit if the threat model changes.
- **`workspace.context` is removed, not wired.** Preload has no `rpc:get-context` receiver; the method is a dangling surface. Ship it properly when the feature is real; delete the fake surface today.
- **Sandbox flipped on (`sandbox: true`).** Preload uses only `contextBridge` + `ipcRenderer` + `process.platform`, which is sandbox-safe. If something breaks, roll back specifically, don't re-enable the whole sandbox.
- **CSP via `<meta>` tag in index.html** rather than via `session.webRequest.onHeadersReceived`. Simpler first pass; can move to header-based CSP with env-aware policy later.

---

## Tasks

### 1. Remove `workspace.context` dangling method

**File:** `apps/desktop/src/main/rpc.ts`

Delete the entire `workspace.context` method registration (roughly lines 179–200). Leave no reference behind. `rpc.discover` will no longer list it.

```ts
// REMOVE this block entirely from rpc.ts:
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
```

Also check if anything in `apps/desktop/src/` references `rpc:get-context` and clean up dead references. Preload doesn't wire it; renderer doesn't handle it.

Commit: `refactor(desktop): drop unwired workspace.context RPC method`.

---

### 2. Sidecar control socket: require auth before any method

**Files:**
- `apps/desktop/src/main/sidecar/server.ts`
- `apps/desktop/src/main/sidecar/client.ts`
- `apps/desktop/src/main/sidecar/protocol.ts`

**Protocol change:** the first message on a control-socket connection must be `sidecar.auth` with the token as a param. Any other method before auth returns error `-32005` and the connection is closed.

Bump `SIDECAR_VERSION` in `protocol.ts` from `1` to `2`. This forces the client to spawn a fresh sidecar instead of connecting to a stale old-protocol one.

**`protocol.ts` — bump version, drop `token` from `PingResult`:**

```ts
export const SIDECAR_VERSION = 2

export interface PingResult {
  pid: number
  uptime: number
  version: number
  // token removed — do not leak back to client
}
```

**`server.ts` — track auth per connection; require `sidecar.auth` first:**

Track a `Set<net.Socket>` of authenticated clients (or a WeakMap<Socket, boolean>). Modify `handleControlClient`:

```ts
private authenticatedClients = new WeakSet<net.Socket>()

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
    this.authenticatedClients.delete(sock)
    this.resetIdleTimer()
  })

  sock.on("error", () => {
    this.controlClients.delete(sock)
    this.authenticatedClients.delete(sock)
  })
}
```

Modify `handleRpcMessage` to route `sidecar.auth` without requiring auth, and reject any other method until auth completes:

```ts
private handleRpcMessage(sock: net.Socket, line: string): void {
  let msg: JsonRpcRequest
  try {
    msg = JSON.parse(line)
  } catch {
    sock.write(makeError(0, -32700, "Parse error"))
    return
  }

  const { id, method, params } = msg

  // Auth must happen first.
  if (method === "sidecar.auth") {
    const token = (params as { token?: string } | undefined)?.token
    if (typeof token === "string" && token === this.opts.token) {
      this.authenticatedClients.add(sock)
      sock.write(makeResponse(id, { ok: true }))
    } else {
      sock.write(makeError(id, -32005, "Auth failed"))
      sock.destroy()
    }
    return
  }

  if (!this.authenticatedClients.has(sock)) {
    sock.write(makeError(id, -32005, "Auth required"))
    sock.destroy()
    return
  }

  switch (method) {
    case "sidecar.ping":
      return this.handlePing(sock, id)
    // ... unchanged
  }
}
```

And `handlePing` no longer returns the token:

```ts
private handlePing(sock: net.Socket, id: number): void {
  const result: PingResult = {
    pid: process.pid,
    uptime: Date.now() - this.startTime,
    version: SIDECAR_VERSION,
  }
  sock.write(makeResponse(id, result))
}
```

**`client.ts` — send `sidecar.auth` after connect, before any other RPC:**

Add an `auth` method and call it from `connect()` (or immediately after in `_ensureSidecar`). The client needs the token — it already reads it from the PID file in `readPidFile()` or generates it fresh when spawning.

```ts
async connect(token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    this.socket = net.createConnection(SIDECAR_SOCKET_PATH, async () => {
      this.socket!.removeListener("error", reject)
      this.socket!.on("error", () => this.rejectAllPending())
      this.socket!.on("close", () => this.rejectAllPending())
      try {
        await this.rpc("sidecar.auth", { token })
        resolve()
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    this.socket.on("error", reject)
    this.socket.on("data", (chunk) => this.handleData(chunk))
  })
}
```

Update callers of `connect()` in `_ensureSidecar` and `waitForSidecar` to pass the token. For the reuse path (existing sidecar), use `existing.token`. For the fresh spawn path, use the just-generated token variable.

Then in `_ensureSidecar`:

```ts
const existing = this.readPidFile()
if (existing) {
  try {
    process.kill(existing.pid, 0)
    if (existing.version === SIDECAR_VERSION) {
      await this.connect(existing.token)
      // Auth already verified identity; no need to compare token via ping anymore.
      await this.ping()
      return
    }
  } catch {
    // Dead or wrong version
  }
  this.disconnect()
}

const token = crypto.randomUUID()
// ...spawn...
await this.waitForSidecar(token, 5000)
// waitForSidecar now calls connect(token) internally
```

And in `waitForSidecar`:

```ts
private async waitForSidecar(token: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const pid = this.readPidFile()
    if (pid && pid.token === token) {
      try {
        await this.connect(token)
        return
      } catch {
        this.disconnect()
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("Sidecar failed to start within timeout")
}
```

Commit: `fix(desktop): require auth on sidecar control socket; stop leaking token in ping`.

---

### 3. Lock down `~/.ateli` permissions

**Files:**
- `apps/desktop/src/main/rpc.ts`
- `apps/desktop/src/main/sidecar/server.ts`

After creating the `~/.ateli` directory or any file/socket inside it, chmod to 0700 (dir) or 0600 (file/socket).

**`rpc.ts` — in `startRpcServer`:**

```ts
fs.mkdirSync(ATELI_DIR, { recursive: true, mode: 0o700 })
try { fs.chmodSync(ATELI_DIR, 0o700) } catch {}

nonce = crypto.randomUUID()
fs.writeFileSync(TOKEN_PATH, nonce, { mode: 0o600 })
try { fs.chmodSync(TOKEN_PATH, 0o600) } catch {}

// ...socketPath assignment, unlink, stale-socket cleanup unchanged...

// After server.listen(socketPath):
server.listen(socketPath, () => {
  try { fs.chmodSync(socketPath, 0o600) } catch {}
  fs.writeFileSync(SOCKET_PATH_FILE, socketPath, { mode: 0o600 })
  try { fs.chmodSync(SOCKET_PATH_FILE, 0o600) } catch {}
})
```

Note: `server.listen(path)` is async; the chmod needs to run in the listen callback (or use a post-listen await). Current code calls `server.listen(socketPath)` without a callback on line 349 — move the `fs.writeFileSync(SOCKET_PATH_FILE, ...)` into a `listen` callback along with the chmod.

**`sidecar/server.ts` — in `start()`:**

```ts
async start(): Promise<void> {
  fs.mkdirSync(this.opts.sessionSocketDir, { recursive: true, mode: 0o700 })
  try { fs.chmodSync(this.opts.sessionSocketDir, 0o700) } catch {}
  try { fs.chmodSync(ATELI_DIR, 0o700) } catch {}

  prepareEndpoint(this.opts.controlSocketPath)

  const pidData: PidFileData = {
    pid: process.pid,
    token: this.opts.token,
    version: SIDECAR_VERSION,
  }
  fs.writeFileSync(this.opts.pidFilePath, JSON.stringify(pidData), { mode: 0o600 })
  try { fs.chmodSync(this.opts.pidFilePath, 0o600) } catch {}

  await new Promise<void>((resolve) => {
    this.controlServer = net.createServer((sock) =>
      this.handleControlClient(sock),
    )
    this.controlServer.listen(this.opts.controlSocketPath, () => {
      try { fs.chmodSync(this.opts.controlSocketPath, 0o600) } catch {}
      resolve()
    })
  })

  this.resetIdleTimer()
}
```

Similarly for per-session data sockets: after `dataServer.listen(socketPath, ...)` fires, chmod the socketPath to 0600.

Commit: `fix(desktop): 0600/0700 perms on ~/.ateli files, sockets, pid file`.

---

### 4. Enable renderer sandbox

**File:** `apps/desktop/src/main/index.ts`

Change `webPreferences.sandbox: false` → `sandbox: true` on line ~39.

```ts
webPreferences: {
  preload: path.join(__dirname, "../preload/index.mjs"),
  sandbox: true,
},
```

Preload (`apps/desktop/src/preload/index.ts`) uses only `contextBridge`, `ipcRenderer`, and `process.platform` — all sandbox-compatible. No change needed to preload.

If Codex's build or runtime hits a sandbox-incompatible API in preload, revert to `sandbox: false` specifically in that commit rather than re-disabling broadly. Note in the commit message which API forced it.

Commit: `fix(desktop): enable renderer sandbox`.

---

### 5. Add CSP to index.html

**File:** `apps/desktop/src/renderer/index.html`

Add a `<meta>` CSP in `<head>`:

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com data:;
  img-src 'self' data: blob:;
  connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*;
">
```

Rationale:
- `script-src 'unsafe-inline' 'unsafe-eval'`: needed for Vite dev HMR + tldraw runtime evaluation. Can tighten for prod in a follow-up (switch to header-based CSP that's stricter in prod).
- `style-src 'unsafe-inline'`: needed for Tailwind v4 runtime and tldraw inline styles.
- `font-src` allows Google Fonts (currently loaded in the existing `<link>` tags).
- `connect-src ws:` for Vite HMR WebSocket in dev.

If Codex's `pnpm --filter desktop dev` test shows CSP violations in the renderer console, loosen specifically what's flagged rather than removing the whole CSP.

Commit: `fix(desktop): add renderer CSP meta tag`.

---

## Acceptance criteria (manual; Codex should verify what it can)

1. `pnpm --filter desktop build` — green.
2. `pnpm --filter desktop typecheck` — no new errors introduced by these changes. Existing pre-existing errors (unresolved `@/` aliases, NodeNext import extensions, etc.) may persist — those are outside this plan's scope.
3. `stat -f '%Sp' ~/.ateli` (or `ls -ld ~/.ateli`) shows `drwx------` (0700).
4. `stat -f '%Sp' ~/.ateli/server.token` shows `-rw-------` (0600).
5. `stat -f '%Sp' ~/.ateli/pty-sidecar.sock` (if sidecar running) shows `srw-------` (0600).
6. App launches normally (Codex may skip this per AGENTS.md; user will verify).
7. A raw socket connection to `~/.ateli/pty-sidecar.sock` that sends `session.list` before auth is rejected and closed.
8. `rpc.discover` result no longer lists `workspace.context`.
9. Grep: `rg "rpc:get-context" apps/desktop/src` returns nothing.

## Guardrails for Codex

- **Do not** change ring-buffer sizing, session eviction, or any of finding #5. That's a separate plan.
- **Do not** change `worktree.ts` or worktree metadata JSON behavior. That's finding #3, next plan.
- **Do not** restructure `PtyManager` or the IPC surface in `preload/index.ts` beyond what these fixes require.
- **Do not** introduce any new dependencies.
- **Preserve** the behavior where a stale sidecar from an old protocol version is replaced (version bump handles this via `client.ts`'s existing version check).
- **Commit** in the 5 logical chunks above.

## Handoff command

```bash
node "/Users/btn0s/.claude/plugins/cache/openai-codex/codex/1.0.2/scripts/codex-companion.mjs" \
  task --background --write --effort high \
  "$(cat docs/plans/2026-04-23-security-hardening.md)"
```

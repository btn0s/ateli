// apps/desktop/src/main/rpc.ts
import net from "node:net"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { BrowserWindow, ipcMain } from "electron"
import type { PtyManager } from "./pty"
import { isRpcInvalidParams, RpcInvalidParamsError } from "./jsonrpc-error"
import {
  ensureManagementAllowed,
  loadManagementPolicy,
  updateManagementPolicy,
} from "./management"
import {
  addWorktree,
  listWorktrees,
  findWorktreeById,
  removeWorktree,
  renameWorktreeBranch,
  worktreePath,
  loadWorktreeMetadata,
  saveWorktreeMetadata,
} from "./worktree"
import { isPathInside } from "./path-utils"
import {
  parseManagementPatchRpc,
  rpcFiniteOr,
  rpcObj,
  rpcOptionalBool,
  rpcOptionalNumber,
  rpcOptionalString,
  rpcRequireNumber,
  rpcRequireString,
  rpcRequireStringData,
} from "./rpc-payloads"

const ATELI_DIR = path.join(os.homedir(), ".ateli")
const SOCKET_PATH_FILE = path.join(ATELI_DIR, "socket-path")
const TOKEN_PATH = path.join(ATELI_DIR, "server.token")
const SHAPES_TIMEOUT_MS = 5000
const RPC_REQUEST_TIMEOUT_MS = 10_000

export type RpcContext = { signal: AbortSignal }

type RpcHandler = (
  params: Record<string, unknown>,
  ctx: RpcContext
) => unknown | Promise<unknown>

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return
  }
  const r = signal.reason
  const msg =
    r !== undefined && r !== null && typeof r === "string" ? r : "Aborted"
  throw new Error(msg)
}

let server: net.Server | null = null
let socketPath: string | null = null
let nonce: string | null = null
const authenticatedClients = new Set<net.Socket>()

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

type BroadcastListener = (method: string, params: Record<string, unknown>) => void
const broadcastListeners: BroadcastListener[] = []

export function onBroadcast(listener: BroadcastListener): void {
  broadcastListeners.push(listener)
}

export function broadcast(method: string, params: Record<string, unknown>): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"
  for (const client of authenticatedClients) {
    if (!client.destroyed) {
      client.write(msg)
    }
  }
  for (const listener of broadcastListeners) {
    listener(method, params)
  }
}

export function startRpcServer(ptyManager: PtyManager) {
  fs.mkdirSync(ATELI_DIR, { recursive: true, mode: 0o700 })
  try { fs.chmodSync(ATELI_DIR, 0o700) } catch {}

  // Generate auth nonce
  nonce = crypto.randomUUID()
  fs.writeFileSync(TOKEN_PATH, nonce, { mode: 0o600 })
  try { fs.chmodSync(TOKEN_PATH, 0o600) } catch {}

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

  methods.set("rpc.discover", (_params, _ctx) => ({
    methods: Array.from(methods.keys()),
  }))

  // --- Terminal methods ---

  methods.set("terminal.create", async (params, ctx) => {
    const p = rpcObj(params)
    const cwd = rpcOptionalString(p, "cwd")
    const name = rpcOptionalString(p, "name")
    const win = getMainWindow()
    if (!cwd && !win) {
      throw new Error("cwd is required when no window is open")
    }
    throwIfAborted(ctx.signal)
    const result = await ptyManager.createSession({
      cwd: cwd || process.cwd(),
      name,
    })
    broadcast("terminal.created", { id: result.id, sessionKey: result.sessionKey })
    return result
  })

  methods.set("terminal.list", (_params, _ctx) => {
    return { sessions: ptyManager.listSessions() }
  })

  methods.set("terminal.write", async (params, ctx) => {
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    const data = rpcRequireStringData(p, "data")
    throwIfAborted(ctx.signal)
    await ptyManager.writeSession(id, data)
    return { ok: true }
  })

  methods.set("terminal.resize", async (params, ctx) => {
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    const cols = rpcRequireNumber(p, "cols")
    const rows = rpcRequireNumber(p, "rows")
    throwIfAborted(ctx.signal)
    await ptyManager.resizeSession(id, cols, rows)
    return { ok: true }
  })

  methods.set("terminal.kill", async (params, ctx) => {
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    throwIfAborted(ctx.signal)
    await ptyManager.killSession(id)
    return { ok: true }
  })

  methods.set("terminal.rename", async (params, ctx) => {
    ensureManagementAllowed("agent", "renameTerminal")
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    const name = rpcOptionalString(p, "name")
    throwIfAborted(ctx.signal)
    const updated = ptyManager.renameSession(id, name)
    throwIfAborted(ctx.signal)
    broadcast("terminal.renamed", {
      id: updated.id,
      sessionKey: updated.sidecarSessionId,
      name: updated.name ?? null,
    })
    return updated
  })

  methods.set("terminal.reconnect", async (params, ctx) => {
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    const cols = rpcOptionalNumber(p, "cols", 80)
    const rows = rpcOptionalNumber(p, "rows", 24)
    throwIfAborted(ctx.signal)
    await ptyManager.reconnectSession(id, cols, rows)
    return { ok: true }
  })

  methods.set("terminal.read", async (params, ctx) => {
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    throwIfAborted(ctx.signal)
    const data = await ptyManager.readSession(id)
    return { data }
  })

  // --- Canvas methods ---

  methods.set("canvas.getShapes", async (_params, ctx) => {
    const win = getMainWindow()
    if (!win) {
      throw new Error("No window available")
    }
    throwIfAborted(ctx.signal)
    return new Promise((resolve, reject) => {
      const channel = `rpc:shapes-response:${crypto.randomUUID()}`
      const onAbort = () => {
        clearTimeout(timer)
        ipcMain.removeAllListeners(channel)
        const r = ctx.signal.reason
        reject(new Error(typeof r === "string" ? r : "Aborted"))
      }
      const timer = setTimeout(() => {
        ctx.signal.removeEventListener("abort", onAbort)
        ipcMain.removeAllListeners(channel)
        reject(new Error("Timed out waiting for renderer"))
      }, SHAPES_TIMEOUT_MS)

      ctx.signal.addEventListener("abort", onAbort, { once: true })

      ipcMain.once(channel, (_event, shapes) => {
        clearTimeout(timer)
        ctx.signal.removeEventListener("abort", onAbort)
        resolve(shapes)
      })

      win.webContents.send("rpc:get-shapes", { responseChannel: channel })
    })
  })

  methods.set("canvas.createTerminal", async (params, ctx) => {
    const win = getMainWindow()
    if (!win) {
      throw new Error("No window available")
    }
    throwIfAborted(ctx.signal)
    const p = rpcObj(params)
    const x = rpcFiniteOr(p, "x", 0)
    const y = rpcFiniteOr(p, "y", 0)
    const w = rpcFiniteOr(p, "w", 600)
    const h = rpcFiniteOr(p, "h", 400)

    const shapeId = `shape:rpc-${crypto.randomUUID().slice(0, 12)}`
    win.webContents.send("rpc:create-terminal", { shapeId, x, y, w, h })
    return { shapeId }
  })

  // --- Worktree methods ---

  methods.set("worktree.create", async (params, ctx) => {
    const p = rpcObj(params)
    const repoPath = rpcRequireString(p, "repoPath")
    const branch = rpcRequireString(p, "branch")
    const createBranch = rpcOptionalBool(p, "createBranch", true)
    const startPoint = rpcOptionalString(p, "startPoint")

    const wtPath = worktreePath(repoPath, branch)
    throwIfAborted(ctx.signal)
    await addWorktree({
      repoPath,
      worktreePath: wtPath,
      branch,
      createBranch,
      startPoint,
    })
    throwIfAborted(ctx.signal)

    const id = crypto.randomUUID().slice(0, 8)
    const metadata = loadWorktreeMetadata()
    metadata.entries[wtPath] = {
      id,
      branch,
      createdAt: new Date().toISOString(),
    }
    saveWorktreeMetadata(metadata)
    throwIfAborted(ctx.signal)

    broadcast("worktree.created", { id, path: wtPath, branch })
    return { id, path: wtPath, branch }
  })

  methods.set("worktree.list", async (params, ctx) => {
    const p = rpcObj(params)
    const repoPath = rpcRequireString(p, "repoPath")
    throwIfAborted(ctx.signal)
    const worktrees = await listWorktrees(repoPath)
    return { worktrees }
  })

  methods.set("worktree.remove", async (params, ctx) => {
    const p = rpcObj(params)
    const repoPath = rpcRequireString(p, "repoPath")
    const id = rpcRequireString(p, "id")

    const entry = await findWorktreeById(repoPath, id)
    if (!entry) {
      throw new Error(`Worktree not found: ${id}`)
    }
    throwIfAborted(ctx.signal)

    // Kill terminals whose cwd is inside this worktree
    const sessions = ptyManager.listSessions()
    for (const session of sessions) {
      if (isPathInside(session.cwd, entry.path)) {
        throwIfAborted(ctx.signal)
        await ptyManager.killSession(session.id)
      }
    }
    throwIfAborted(ctx.signal)

    // Remove the git worktree
    try {
      await removeWorktree(entry.repoPath, entry.path)
    } catch {
      // May already be removed from disk
    }
    throwIfAborted(ctx.signal)

    // Remove metadata
    const metadata = loadWorktreeMetadata()
    delete metadata.entries[entry.path]
    saveWorktreeMetadata(metadata)
    throwIfAborted(ctx.signal)

    broadcast("worktree.removed", { id, path: entry.path, branch: entry.branch })
    return { ok: true }
  })

  methods.set("worktree.renameBranch", async (params, ctx) => {
    ensureManagementAllowed("agent", "renameBranch")
    const p = rpcObj(params)
    const repoPath = rpcRequireString(p, "repoPath")
    const id = rpcRequireString(p, "id")
    const branchField = p["branch"]
    const nextBranch =
      typeof branchField === "string" ? branchField.trim() : ""
    if (!nextBranch) {
      throw new RpcInvalidParamsError("branch is required")
    }

    const entry = await findWorktreeById(repoPath, id)
    if (!entry) {
      throw new Error(`Worktree not found: ${id}`)
    }
    throwIfAborted(ctx.signal)

    const previousBranch = entry.branch
    await renameWorktreeBranch(entry.path, nextBranch)
    throwIfAborted(ctx.signal)

    const worktrees = await listWorktrees(repoPath)
    const updated = worktrees.find((worktree) => worktree.id === id)
    if (!updated) {
      throw new Error(`Worktree not found after rename: ${id}`)
    }
    throwIfAborted(ctx.signal)

    broadcast("worktree.renamed", {
      id: updated.id,
      path: updated.path,
      branch: updated.branch,
      previousBranch,
    })
    return updated
  })

  methods.set("management.getPolicy", (_params, _ctx) => {
    return loadManagementPolicy()
  })

  methods.set("management.updatePolicy", async (params, ctx) => {
    ensureManagementAllowed("agent", "updatePolicy")
    const p = rpcObj(params)
    const patch = parseManagementPatchRpc(p)
    throwIfAborted(ctx.signal)
    const policy = updateManagementPolicy(patch)
    throwIfAborted(ctx.signal)
    broadcast("management.policy.updated", { policy })
    return policy
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

        let bodyId: string | number | null = null
        try {
          const body = JSON.parse(line) as { id?: string | number | null; jsonrpc?: string; method?: string; params?: unknown }
          bodyId = body.id ?? null

          if (body.jsonrpc !== "2.0") {
            conn.write(JSON.stringify({ jsonrpc: "2.0", id: bodyId, error: { code: -32600, message: "Invalid Request" } }) + "\n")
            continue
          }

          const handler = body.method && methods.get(body.method)
          if (!handler) {
            conn.write(JSON.stringify({ jsonrpc: "2.0", id: bodyId, error: { code: -32601, message: `Method not found: ${body.method}` } }) + "\n")
            continue
          }

          const ac = new AbortController()
          const timeoutId = setTimeout(
            () => ac.abort("Request timeout"),
            RPC_REQUEST_TIMEOUT_MS
          )
          try {
            const result = await handler(rpcObj(body.params), {
              signal: ac.signal,
            })
            clearTimeout(timeoutId)
            conn.write(JSON.stringify({ jsonrpc: "2.0", id: bodyId, result }) + "\n")
          } catch (err) {
            clearTimeout(timeoutId)
            if (isRpcInvalidParams(err)) {
              conn.write(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: bodyId,
                  error: { code: -32602, message: (err as Error).message || "Invalid params" },
                }) + "\n"
              )
            } else {
              conn.write(
                JSON.stringify({ jsonrpc: "2.0", id: bodyId, error: { code: -32000, message: String(err) } }) + "\n"
              )
            }
          }
        } catch {
          conn.write(JSON.stringify({ jsonrpc: "2.0", id: bodyId, error: { code: -32700, message: "Parse error" } }) + "\n")
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

  server.listen(socketPath, () => {
    try { fs.chmodSync(socketPath!, 0o600) } catch {}
    fs.writeFileSync(SOCKET_PATH_FILE, socketPath!, { mode: 0o600 })
    try { fs.chmodSync(SOCKET_PATH_FILE, 0o600) } catch {}
  })
}

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

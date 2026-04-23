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

type RpcHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>

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

  methods.set("rpc.discover", () => ({
    methods: Array.from(methods.keys()),
  }))

  // --- Terminal methods ---

  methods.set("terminal.create", async (params) => {
    const p = rpcObj(params)
    const cwd = rpcOptionalString(p, "cwd")
    const name = rpcOptionalString(p, "name")
    const win = getMainWindow()
    if (!cwd && !win) {
      throw new Error("cwd is required when no window is open")
    }
    const result = await ptyManager.createSession({
      cwd: cwd || process.cwd(),
      name,
    })
    broadcast("terminal.created", { id: result.id, sessionKey: result.sessionKey })
    return result
  })

  methods.set("terminal.list", () => {
    return { sessions: ptyManager.listSessions() }
  })

  methods.set("terminal.write", async (params) => {
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    const data = rpcRequireStringData(p, "data")
    await ptyManager.writeSession(id, data)
    return { ok: true }
  })

  methods.set("terminal.resize", async (params) => {
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    const cols = rpcRequireNumber(p, "cols")
    const rows = rpcRequireNumber(p, "rows")
    await ptyManager.resizeSession(id, cols, rows)
    return { ok: true }
  })

  methods.set("terminal.kill", async (params) => {
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    await ptyManager.killSession(id)
    return { ok: true }
  })

  methods.set("terminal.rename", async (params) => {
    ensureManagementAllowed("agent", "renameTerminal")
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    const name = rpcOptionalString(p, "name")
    const updated = ptyManager.renameSession(id, name)
    broadcast("terminal.renamed", {
      id: updated.id,
      sessionKey: updated.sidecarSessionId,
      name: updated.name ?? null,
    })
    return updated
  })

  methods.set("terminal.reconnect", async (params) => {
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    const cols = rpcOptionalNumber(p, "cols", 80)
    const rows = rpcOptionalNumber(p, "rows", 24)
    await ptyManager.reconnectSession(id, cols, rows)
    return { ok: true }
  })

  methods.set("terminal.read", async (params) => {
    const p = rpcObj(params)
    const id = rpcRequireString(p, "id")
    const data = await ptyManager.readSession(id)
    return { data }
  })

  // --- Canvas methods ---

  methods.set("canvas.getShapes", async () => {
    const win = getMainWindow()
    if (!win) {
      throw new Error("No window available")
    }

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
    if (!win) {
      throw new Error("No window available")
    }
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

  methods.set("worktree.create", async (params) => {
    const p = rpcObj(params)
    const repoPath = rpcRequireString(p, "repoPath")
    const branch = rpcRequireString(p, "branch")
    const createBranch = rpcOptionalBool(p, "createBranch", true)
    const startPoint = rpcOptionalString(p, "startPoint")

    const wtPath = worktreePath(repoPath, branch)
    await addWorktree({
      repoPath,
      worktreePath: wtPath,
      branch,
      createBranch,
      startPoint,
    })

    const id = crypto.randomUUID().slice(0, 8)
    const metadata = loadWorktreeMetadata()
    metadata.entries[wtPath] = {
      id,
      branch,
      createdAt: new Date().toISOString(),
    }
    saveWorktreeMetadata(metadata)

    broadcast("worktree.created", { id, path: wtPath, branch })
    return { id, path: wtPath, branch }
  })

  methods.set("worktree.list", async (params) => {
    const p = rpcObj(params)
    const repoPath = rpcRequireString(p, "repoPath")
    const worktrees = await listWorktrees(repoPath)
    return { worktrees }
  })

  methods.set("worktree.remove", async (params) => {
    const p = rpcObj(params)
    const repoPath = rpcRequireString(p, "repoPath")
    const id = rpcRequireString(p, "id")

    const entry = await findWorktreeById(repoPath, id)
    if (!entry) {
      throw new Error(`Worktree not found: ${id}`)
    }

    // Kill terminals whose cwd is inside this worktree
    const sessions = ptyManager.listSessions()
    for (const session of sessions) {
      if (session.cwd.startsWith(entry.path)) {
        await ptyManager.killSession(session.id)
      }
    }

    // Remove the git worktree
    try {
      await removeWorktree(entry.repoPath, entry.path)
    } catch {
      // May already be removed from disk
    }

    // Remove metadata
    const metadata = loadWorktreeMetadata()
    delete metadata.entries[entry.path]
    saveWorktreeMetadata(metadata)

    broadcast("worktree.removed", { id, path: entry.path, branch: entry.branch })
    return { ok: true }
  })

  methods.set("worktree.renameBranch", async (params) => {
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

    const previousBranch = entry.branch
    await renameWorktreeBranch(entry.path, nextBranch)

    const worktrees = await listWorktrees(repoPath)
    const updated = worktrees.find((worktree) => worktree.id === id)
    if (!updated) {
      throw new Error(`Worktree not found after rename: ${id}`)
    }

    broadcast("worktree.renamed", {
      id: updated.id,
      path: updated.path,
      branch: updated.branch,
      previousBranch,
    })
    return updated
  })

  methods.set("management.getPolicy", () => {
    return loadManagementPolicy()
  })

  methods.set("management.updatePolicy", async (params) => {
    ensureManagementAllowed("agent", "updatePolicy")
    const p = rpcObj(params)
    const patch = parseManagementPatchRpc(p)
    const policy = updateManagementPolicy(patch)
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

          try {
            const result = await Promise.race([
              handler(rpcObj(body.params)),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Request timeout")), 10_000),
              ),
            ])
            conn.write(JSON.stringify({ jsonrpc: "2.0", id: bodyId, result }) + "\n")
          } catch (err) {
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

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

export function broadcast(method: string, params: Record<string, unknown>): void {
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

import net from "node:net"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { BrowserWindow, ipcMain } from "electron"
import { ptys } from "./pty-store"

const SOCKET_DIR = path.join(os.homedir(), ".collaborator")
const SOCKET_PATH_FILE = path.join(SOCKET_DIR, "socket-path")
const SHAPES_TIMEOUT_MS = 5000

type RpcHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>

const methods = new Map<string, RpcHandler>()

function registerMethod(name: string, handler: RpcHandler) {
  methods.set(name, handler)
}

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

async function handleRequest(body: {
  jsonrpc: string
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}): Promise<object> {
  const id = body.id ?? null

  if (body.jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } }
  }

  if (body.method === "rpc.discover") {
    return { jsonrpc: "2.0", id, result: { methods: Array.from(methods.keys()) } }
  }

  const handler = methods.get(body.method)
  if (!handler) {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${body.method}` } }
  }

  try {
    const result = await handler(body.params ?? {})
    return { jsonrpc: "2.0", id, result }
  } catch (err) {
    return { jsonrpc: "2.0", id, error: { code: -32000, message: String(err) } }
  }
}

let server: net.Server | null = null
let socketPath: string | null = null

function cleanupStaleSockets() {
  try {
    const entries = fs.readdirSync(SOCKET_DIR)
    for (const entry of entries) {
      if (!entry.startsWith("rpc-") || !entry.endsWith(".sock")) continue
      const fullPath = path.join(SOCKET_DIR, entry)
      const sock = net.createConnection(fullPath)
      sock.on("error", () => {
        // Dead socket — remove it
        try { fs.unlinkSync(fullPath) } catch { /* ignore */ }
      })
      sock.on("connect", () => {
        // Alive — leave it alone
        sock.destroy()
      })
    }
  } catch {
    // ignore
  }
}

export function startRpcServer() {
  fs.mkdirSync(SOCKET_DIR, { recursive: true })
  cleanupStaleSockets()

  socketPath = path.join(SOCKET_DIR, `rpc-${crypto.randomUUID().slice(0, 8)}.sock`)

  try { fs.unlinkSync(socketPath) } catch { /* ignore */ }

  server = net.createServer((conn) => {
    let buffer = ""

    conn.on("data", async (chunk) => {
      buffer += chunk.toString()

      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)

        if (!line) continue

        try {
          const body = JSON.parse(line)
          const response = await handleRequest(body)
          conn.write(JSON.stringify(response) + "\n")
        } catch {
          conn.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            }) + "\n",
          )
        }
      }
    })
  })

  server.listen(socketPath)
  fs.writeFileSync(SOCKET_PATH_FILE, socketPath)

  // --- Register methods ---

  registerMethod("canvas.createTerminal", async (params) => {
    const win = getMainWindow()
    if (!win) throw new Error("No window available")

    const x = typeof params["x"] === "number" ? params["x"] : 0
    const y = typeof params["y"] === "number" ? params["y"] : 0
    const w = typeof params["w"] === "number" ? params["w"] : 600
    const h = typeof params["h"] === "number" ? params["h"] : 400

    const shapeId = `shape:rpc-${crypto.randomUUID().slice(0, 12)}`
    win.webContents.send("rpc:create-terminal", { shapeId, x, y, w, h })
    return { shapeId }
  })

  registerMethod("canvas.getShapes", async () => {
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

  registerMethod("terminal.write", async (params) => {
    const sessionKey = params["sessionKey"]
    if (typeof sessionKey !== "string") throw new Error("sessionKey is required")
    const ptyProcess = ptys.get(sessionKey)
    if (!ptyProcess) throw new Error(`No terminal with sessionKey: ${sessionKey}`)

    const data = params["data"]
    if (typeof data !== "string") throw new Error("data is required")
    ptyProcess.write(data)
    return { ok: true }
  })

  registerMethod("terminal.list", async () => {
    return { sessions: Array.from(ptys.keys()) }
  })
}

export function stopRpcServer() {
  if (server) {
    server.close()
    server = null
  }
  if (socketPath) {
    try { fs.unlinkSync(socketPath) } catch { /* ignore */ }
  }
  try { fs.unlinkSync(SOCKET_PATH_FILE) } catch { /* ignore */ }
}

// Clean up on unexpected termination
process.on("SIGTERM", () => stopRpcServer())
process.on("SIGINT", () => stopRpcServer())

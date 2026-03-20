import net from "node:net"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { BrowserWindow } from "electron"

const SOCKET_DIR = path.join(os.homedir(), ".collaborator")
const SOCKET_PATH_FILE = path.join(SOCKET_DIR, "socket-path")

type RpcHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>

const methods = new Map<string, RpcHandler>()

export function registerMethod(name: string, handler: RpcHandler) {
  methods.set(name, handler)
}

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows[0] ?? null
}

async function handleRequest(body: {
  jsonrpc: string
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}): Promise<object> {
  if (body.jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32600, message: "Invalid Request" } }
  }

  if (body.method === "rpc.discover") {
    return {
      jsonrpc: "2.0",
      id: body.id ?? null,
      result: {
        methods: Array.from(methods.keys()),
      },
    }
  }

  const handler = methods.get(body.method)
  if (!handler) {
    return {
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32601, message: `Method not found: ${body.method}` },
    }
  }

  try {
    const result = await handler(body.params ?? {})
    return { jsonrpc: "2.0", id: body.id ?? null, result }
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32000, message: String(err) },
    }
  }
}

let server: net.Server | null = null
let socketPath: string | null = null

export function startRpcServer() {
  // Ensure socket directory exists
  fs.mkdirSync(SOCKET_DIR, { recursive: true })

  // Generate a unique socket path
  socketPath = path.join(SOCKET_DIR, `rpc-${crypto.randomUUID().slice(0, 8)}.sock`)

  // Clean up stale socket if it exists
  try {
    fs.unlinkSync(socketPath)
  } catch {
    // ignore
  }

  server = net.createServer((conn) => {
    let buffer = ""

    conn.on("data", async (chunk) => {
      buffer += chunk.toString()

      // Process newline-delimited JSON
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

  server.listen(socketPath, () => {
    // Write socket path so clients can find it
    fs.writeFileSync(SOCKET_PATH_FILE, socketPath!)
  })

  // Register built-in methods
  registerMethod("canvas.createTerminal", async (params) => {
    const win = getMainWindow()
    if (!win) throw new Error("No window available")

    const x = typeof params["x"] === "number" ? params["x"] : 0
    const y = typeof params["y"] === "number" ? params["y"] : 0
    const w = typeof params["w"] === "number" ? params["w"] : 600
    const h = typeof params["h"] === "number" ? params["h"] : 400

    // Send to renderer to create the shape
    const shapeId = `shape:rpc-${crypto.randomUUID().slice(0, 12)}`
    win.webContents.send("rpc:create-terminal", { shapeId, x, y, w, h })
    return { shapeId }
  })

  registerMethod("terminal.write", async (params) => {
    const { ptys } = await import("./index")
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
    const { ptys } = await import("./index")
    return {
      sessions: Array.from(ptys.keys()),
    }
  })

  registerMethod("canvas.getShapes", async () => {
    const win = getMainWindow()
    if (!win) throw new Error("No window available")

    return new Promise((resolve) => {
      const { ipcMain } = require("electron") as typeof import("electron")
      const channel = `rpc:shapes-response:${crypto.randomUUID()}`
      ipcMain.once(channel, (_event, shapes) => {
        resolve(shapes)
      })
      win.webContents.send("rpc:get-shapes", { responseChannel: channel })
    })
  })
}

export function stopRpcServer() {
  if (server) {
    server.close()
    server = null
  }
  if (socketPath) {
    try {
      fs.unlinkSync(socketPath)
    } catch {
      // ignore
    }
  }
  try {
    fs.unlinkSync(SOCKET_PATH_FILE)
  } catch {
    // ignore
  }
}

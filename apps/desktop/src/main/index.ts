import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import fs from "node:fs/promises"
import crypto from "node:crypto"
import path from "node:path"
import { startRpcServer, stopRpcServer } from "./rpc.js"
import { ptys, createTmuxSession, killTmuxSession, tmuxSessionName } from "./pty-store.js"

// node-pty is a native module — require it at runtime to avoid bundler issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require("node-pty") as typeof import("node-pty")

type WorkspaceTreeNode = {
  name: string
  path: string
  kind: "file" | "directory"
  children?: WorkspaceTreeNode[]
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
])

async function readWorkspaceTree(root: string, depth: number): Promise<WorkspaceTreeNode[]> {
  try {
    const entries = (await fs.readdir(root, { withFileTypes: true })) as Array<{
      isDirectory(): boolean
      name: string
    }>

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    const children: WorkspaceTreeNode[] = []

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        continue
      }

      const fullPath = path.join(root, entry.name)

      if (entry.isDirectory()) {
        children.push({
          name: entry.name,
          path: fullPath,
          kind: "directory",
          children: depth > 0 ? await readWorkspaceTree(fullPath, depth - 1) : [],
        })
        continue
      }

      children.push({
        name: entry.name,
        path: fullPath,
        kind: "file",
      })
    }

    return children
  } catch {
    return []
  }
}

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

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Select a project folder",
  })
  if (result.canceled) return null
  return result.filePaths[0] ?? null
})

ipcMain.handle(
  "workspace:list-tree",
  async (_event, { root, depth }: { root: string; depth?: number }) => {
    if (typeof root !== "string" || root.trim() === "") {
      throw new Error("root is required")
    }

    const resolvedRoot = path.resolve(root)
    return readWorkspaceTree(resolvedRoot, typeof depth === "number" ? depth : 3)
  },
)

ipcMain.handle(
  "terminal:create",
  (event, { cwd }: { shapeId: string; cwd: string }) => {
    const sender = event.sender
    const sessionKey = crypto.randomUUID().slice(0, 8)

    // Create a tmux session, then attach node-pty to it
    createTmuxSession(sessionKey, cwd)
    const tmuxName = tmuxSessionName(sessionKey)
    const ptyProcess = pty.spawn("tmux", ["attach-session", "-t", tmuxName], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      env: process.env as Record<string, string>,
    })

    ptys.set(sessionKey, ptyProcess)

    ptyProcess.onData((data) => {
      sender.send(`terminal:data:${sessionKey}`, data)
    })

    ptyProcess.onExit(() => {
      ptys.delete(sessionKey)
      sender.send(`terminal:exit:${sessionKey}`)
    })

    return { pid: ptyProcess.pid, sessionKey }
  },
)

ipcMain.on(
  "terminal:input",
  (_event, { sessionKey, data }: { sessionKey: string; data: string }) => {
    ptys.get(sessionKey)?.write(data)
  },
)

ipcMain.on(
  "terminal:resize",
  (
    _event,
    { sessionKey, cols, rows }: { sessionKey: string; cols: number; rows: number },
  ) => {
    ptys.get(sessionKey)?.resize(cols, rows)
  },
)

ipcMain.on("terminal:dispose", (_event, { sessionKey }: { sessionKey: string }) => {
  ptys.get(sessionKey)?.kill()
  ptys.delete(sessionKey)
  killTmuxSession(sessionKey)
})

app.whenReady().then(() => {
  createWindow()
  startRpcServer()

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
})

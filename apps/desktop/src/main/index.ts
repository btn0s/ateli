import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import path from "node:path"
import crypto from "node:crypto"
import { PtyManager } from "./pty"
import { startRpcServer, stopRpcServer, onBroadcast, broadcast } from "./rpc"
import {
  addWorktree,
  listWorktrees,
  findWorktreeById,
  removeWorktree as removeGitWorktree,
  worktreePath,
  loadWorktreeMetadata,
  saveWorktreeMetadata,
} from "./worktree"
import {
  readProjectDirectory,
  startFsWatch,
  fsWatchKey,
} from "./file-tree"
import { getGitChangesOverview } from "./git-status"

if (process.env.NODE_ENV_ELECTRON_VITE === "development") {
  console.log("[ateli] main dev load (change this file to confirm --watch restart)")
}

const ptyManager = new PtyManager()

const fsWatchByKey = new Map<string, () => void>()

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      sandbox: true,
    },
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow.show()
  })

  mainWindow.on("closed", () => {
    for (const [k, fn] of [...fsWatchByKey.entries()]) {
      if (k.startsWith(`${mainWindow.id}\0`)) {
        fn()
        fsWatchByKey.delete(k)
      }
    }
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
  if (!meta) return
  ptyManager.detachSession(meta.id)
})

// --- Worktree IPC ---

ipcMain.handle(
  "worktree:list",
  async (_event, { repoPath }: { repoPath: string }) => {
    return listWorktrees(repoPath)
  },
)

ipcMain.handle(
  "git:status",
  async (_event, { repoPath }: { repoPath: string }) => {
    return getGitChangesOverview(repoPath)
  },
)

ipcMain.handle(
  "worktree:create",
  async (_event, { repoPath, branch }: { repoPath: string; branch: string }) => {
    const wtPath = worktreePath(repoPath, branch)
    await addWorktree({
      repoPath,
      worktreePath: wtPath,
      branch,
      createBranch: true,
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
  },
)

ipcMain.handle(
  "worktree:remove",
  async (_event, { repoPath, id }: { repoPath: string; id: string }) => {
    const entry = await findWorktreeById(repoPath, id)
    if (!entry) throw new Error(`Worktree not found: ${id}`)

    for (const session of ptyManager.listSessions()) {
      if (session.cwd.startsWith(entry.path)) {
        await ptyManager.killSession(session.id)
      }
    }

    try {
      await removeGitWorktree(repoPath, entry.path)
    } catch {
      // Already removed on disk.
    }

    const metadata = loadWorktreeMetadata()
    delete metadata.entries[entry.path]
    saveWorktreeMetadata(metadata)

    broadcast("worktree.removed", { id, path: entry.path, branch: entry.branch })
    return { ok: true }
  },
)

// --- File tree / FS IPC ---

ipcMain.handle(
  "fs:readdir",
  async (_event, { dirPath }: { dirPath: string }) => {
    return readProjectDirectory(dirPath)
  },
)

ipcMain.handle(
  "fs:open-path",
  async (_event, { filePath }: { filePath: string }) => {
    const err = await shell.openPath(filePath)
    if (err) throw new Error(err)
  },
)

ipcMain.handle(
  "fs:watch-root",
  async (event, { rootPath }: { rootPath: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const key = fsWatchKey(win.id, rootPath)
    fsWatchByKey.get(key)?.()
    const cleanup = startFsWatch(key, rootPath, () => {
      if (!win.isDestroyed()) {
        win.webContents.send("fs:changed", { rootPath: path.resolve(rootPath) })
      }
    })
    fsWatchByKey.set(key, cleanup)
  },
)

ipcMain.on(
  "fs:unwatch-root",
  (event, { rootPath }: { rootPath: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const key = fsWatchKey(win.id, rootPath)
    fsWatchByKey.get(key)?.()
    fsWatchByKey.delete(key)
  },
)

// --- App Lifecycle ---

// Single-instance lock: prevents two ateli processes racing on the sidecar
// PID file and RPC socket. The second invocation exits immediately; we focus
// the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

app.whenReady().then(async () => {
  createWindow()
  await ptyManager.init()
  startRpcServer(ptyManager)

  // Relay RPC broadcasts to renderer
  onBroadcast((method, params) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send("rpc:notification", { method, params })
    }
  })

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

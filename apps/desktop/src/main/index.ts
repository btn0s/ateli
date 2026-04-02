import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import path from "node:path"
import { PtyManager } from "./pty"
import { startRpcServer, stopRpcServer, onBroadcast } from "./rpc"

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

// --- App Lifecycle ---

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

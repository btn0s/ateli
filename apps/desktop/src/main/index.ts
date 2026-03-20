import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import crypto from "node:crypto"
import path from "node:path"
import os from "node:os"

// node-pty is a native module — require it at runtime to avoid bundler issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require("node-pty") as typeof import("node-pty")

export const ptys = new Map<string, import("node-pty").IPty>()

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
  "terminal:create",
  (event, { cwd }: { shapeId: string; cwd: string }) => {
    const sender = event.sender
    const sessionKey = crypto.randomUUID()
    const userShell =
      os.platform() === "win32" ? "powershell.exe" : process.env["SHELL"] || "/bin/zsh"
    const ptyProcess = pty.spawn(userShell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
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
})

import { startRpcServer, stopRpcServer } from "./rpc"

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

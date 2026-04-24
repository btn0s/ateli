import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import path from "node:path"
import crypto from "node:crypto"
import { PtyManager } from "./pty"
import { startRpcServer, stopRpcServer, onBroadcast, broadcast } from "./rpc"
import {
  ensureManagementAllowed,
  loadManagementPolicy,
  updateManagementPolicy,
} from "./management"
import {
  addWorktree,
  listWorktrees,
  findWorktreeById,
  removeWorktree as removeGitWorktree,
  renameWorktreeBranch,
  worktreePath,
  loadWorktreeMetadata,
  saveWorktreeMetadata,
} from "./worktree"
import {
  readPackageJsonScripts,
  readProjectDirectory,
  startFsWatch,
  fsWatchKey,
} from "./file-tree"
import { isPathInside } from "./path-utils"
import { getGitChangesOverview, getGitFilePatch } from "./git-status"
import {
  gitGenerateCommitMessage,
  gitPush,
  gitStageAllCommit,
  gitStagePaths,
  gitUnstagePaths,
} from "./git-ops"
import {
  assertRecord,
  expectBooleanKey,
  expectGitDiffRequest,
  expectNumber,
  expectOptionalStringArray,
  expectOptionalString,
  expectString,
  expectStringArray,
  parseManagementPolicyPatch,
  requireStringValue,
} from "./ipc-payloads"

if (process.env.NODE_ENV_ELECTRON_VITE === "development") {
  console.log(
    "[ateli] main dev load (change this file to confirm --watch restart)"
  )
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
    // Suppress the macOS "unsaved changes" dot on the red close button.
    // We don't have a document model and never want to show this indicator.
    mainWindow.setDocumentEdited(false)
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

ipcMain.handle("terminal:create", async (_event, payload) => {
  const r = assertRecord(payload, "terminal:create")
  const cwd = expectString(r, "cwd", "terminal:create")
  const result = await ptyManager.createSession({ cwd })
  return { pid: null, sessionKey: result.sessionKey }
})

ipcMain.handle("terminal:reconnect", async (_event, payload) => {
  const r = assertRecord(payload, "terminal:reconnect")
  const sessionKey = expectString(r, "sessionKey", "terminal:reconnect")
  const cols = expectNumber(r, "cols", "terminal:reconnect")
  const rows = expectNumber(r, "rows", "terminal:reconnect")
  const sessions = ptyManager.listSessions()
  const meta = sessions.find((s) => s.sidecarSessionId === sessionKey)
  if (!meta) {
    throw new Error(`Unknown session: ${sessionKey}`)
  }
  await ptyManager.reconnectSession(meta.id, cols, rows)
})

function findSessionByKey(sessionKey: string) {
  return ptyManager.getSessionByKey(sessionKey)
}

ipcMain.on("terminal:input", (_event, payload) => {
  const r = assertRecord(payload, "terminal:input")
  const sessionKey = expectString(r, "sessionKey", "terminal:input")
  const data = requireStringValue(r, "data", "terminal:input")
  const meta = findSessionByKey(sessionKey)
  if (!meta) {
    console.warn(`terminal:input — unknown session: ${sessionKey}`)
    return
  }
  void ptyManager.writeSession(meta.id, data)
})

ipcMain.on("terminal:resize", (_event, payload) => {
  const r = assertRecord(payload, "terminal:resize")
  const sessionKey = expectString(r, "sessionKey", "terminal:resize")
  const cols = expectNumber(r, "cols", "terminal:resize")
  const rows = expectNumber(r, "rows", "terminal:resize")
  const meta = findSessionByKey(sessionKey)
  if (!meta) {
    console.warn(`terminal:resize — unknown session: ${sessionKey}`)
    return
  }
  void ptyManager.resizeSession(meta.id, cols, rows)
})

ipcMain.on("terminal:dispose", (_event, payload) => {
  const r = assertRecord(payload, "terminal:dispose")
  const sessionKey = expectString(r, "sessionKey", "terminal:dispose")
  const meta = findSessionByKey(sessionKey)
  if (!meta) {
    console.warn(`terminal:dispose — unknown session: ${sessionKey}`)
    return
  }
  void ptyManager.killSession(meta.id)
})

ipcMain.on("terminal:detach", (_event, payload) => {
  const r = assertRecord(payload, "terminal:detach")
  const sessionKey = expectString(r, "sessionKey", "terminal:detach")
  const meta = findSessionByKey(sessionKey)
  if (!meta) {
    return
  }
  ptyManager.detachSession(meta.id)
})

ipcMain.handle("terminal:list", async () => {
  return ptyManager.listSessions()
})

ipcMain.handle("terminal:rename", async (_event, payload) => {
  ensureManagementAllowed("user", "renameTerminal")
  const r = assertRecord(payload, "terminal:rename")
  const sessionKey = expectString(r, "sessionKey", "terminal:rename")
  const name = expectOptionalString(r, "name")
  const meta = findSessionByKey(sessionKey)
  if (!meta) {
    throw new Error(`Unknown session: ${sessionKey}`)
  }
  const updated = ptyManager.renameSession(meta.id, name)
  broadcast("terminal.renamed", {
    id: updated.id,
    sessionKey: updated.sidecarSessionId,
    name: updated.name ?? null,
  })
  return updated
})

// --- Worktree IPC ---

ipcMain.handle("worktree:list", async (_event, payload) => {
  const r = assertRecord(payload, "worktree:list")
  const repoPath = expectString(r, "repoPath", "worktree:list")
  return listWorktrees(repoPath)
})

ipcMain.handle("git:status", async (_event, payload) => {
  const r = assertRecord(payload, "git:status")
  const repoPath = expectString(r, "repoPath", "git:status")
  return getGitChangesOverview(repoPath)
})

ipcMain.handle("worktree:create", async (_event, payload) => {
  const r = assertRecord(payload, "worktree:create")
  const repoPath = expectString(r, "repoPath", "worktree:create")
  const branch = expectString(r, "branch", "worktree:create")
  const startPoint = expectOptionalString(r, "startPoint")
  const wtPath = worktreePath(repoPath, branch)
  await addWorktree({
    repoPath,
    worktreePath: wtPath,
    branch,
    createBranch: true,
    startPoint: startPoint ?? undefined,
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

ipcMain.handle("worktree:remove", async (_event, payload) => {
  const r = assertRecord(payload, "worktree:remove")
  const repoPath = expectString(r, "repoPath", "worktree:remove")
  const id = expectString(r, "id", "worktree:remove")
  const entry = await findWorktreeById(repoPath, id)
  if (!entry) {
    throw new Error(`Worktree not found: ${id}`)
  }

  for (const session of ptyManager.listSessions()) {
    if (isPathInside(session.cwd, entry.path)) {
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

  broadcast("worktree.removed", {
    id,
    path: entry.path,
    branch: entry.branch,
  })
  return { ok: true }
})

ipcMain.handle("worktree:rename-branch", async (_event, payload) => {
  ensureManagementAllowed("user", "renameBranch")
  const r = assertRecord(payload, "worktree:rename-branch")
  const repoPath = expectString(r, "repoPath", "worktree:rename-branch")
  const id = expectString(r, "id", "worktree:rename-branch")
  const branchField = r["branch"]
  if (typeof branchField !== "string") {
    throw new Error("Invalid worktree:rename-branch: branch is required")
  }
  const nextBranch = branchField.trim()
  if (!nextBranch) {
    throw new Error("branch is required")
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

ipcMain.handle("git:diff", async (_event, payload) => {
  return getGitFilePatch(expectGitDiffRequest(payload))
})

ipcMain.handle("git:commit", async (_event, payload) => {
  const r = assertRecord(payload, "git:commit")
  const repoPath = expectString(r, "repoPath", "git:commit")
  const message = requireStringValue(r, "message", "git:commit")
  const amend = expectBooleanKey(r, "amend") === true
  return gitStageAllCommit(repoPath, message, { amend })
})

ipcMain.handle("git:push", async (_event, payload) => {
  const r = assertRecord(payload, "git:push")
  const repoPath = expectString(r, "repoPath", "git:push")
  return gitPush(repoPath)
})

ipcMain.handle("git:generate-commit-message", async (_event, payload) => {
  const r = assertRecord(payload, "git:generate-commit-message")
  const repoPath = expectString(r, "repoPath", "git:generate-commit-message")
  const stagedPaths = expectOptionalStringArray(
    r,
    "stagedPaths",
    "git:generate-commit-message"
  )
  return gitGenerateCommitMessage(repoPath, { stagedPaths })
})

ipcMain.handle("git:stage-paths", async (_event, payload) => {
  const r = assertRecord(payload, "git:stage-paths")
  const repoPath = expectString(r, "repoPath", "git:stage-paths")
  const paths = expectStringArray(r, "paths", "git:stage-paths")
  return gitStagePaths(repoPath, paths)
})

ipcMain.handle("git:unstage-paths", async (_event, payload) => {
  const r = assertRecord(payload, "git:unstage-paths")
  const repoPath = expectString(r, "repoPath", "git:unstage-paths")
  const paths = expectStringArray(r, "paths", "git:unstage-paths")
  return gitUnstagePaths(repoPath, paths)
})

ipcMain.handle("management:get-policy", async () => {
  return loadManagementPolicy()
})

ipcMain.handle("management:update-policy", async (_event, payload) => {
  ensureManagementAllowed("user", "updatePolicy")
  const patch = parseManagementPolicyPatch(payload)
  const policy = updateManagementPolicy(patch)
  broadcast("management.policy.updated", { policy })
  return policy
})

// --- File tree / FS IPC ---

ipcMain.handle("fs:readdir", async (_event, payload) => {
  const r = assertRecord(payload, "fs:readdir")
  const dirPath = expectString(r, "dirPath", "fs:readdir")
  return readProjectDirectory(dirPath)
})

ipcMain.handle("fs:read-package-json-scripts", async (_event, payload) => {
  const r = assertRecord(payload, "fs:read-package-json-scripts")
  const dirPath = expectString(r, "dirPath", "fs:read-package-json-scripts")
  return readPackageJsonScripts(dirPath)
})

ipcMain.handle("fs:open-path", async (_event, payload) => {
  const r = assertRecord(payload, "fs:open-path")
  const filePath = expectString(r, "filePath", "fs:open-path")
  const err = await shell.openPath(filePath)
  if (err) {
    throw new Error(err)
  }
})

ipcMain.handle("fs:watch-root", async (event, payload) => {
  const r = assertRecord(payload, "fs:watch-root")
  const rootPath = expectString(r, "rootPath", "fs:watch-root")
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    return
  }
  const key = fsWatchKey(win.id, rootPath)
  fsWatchByKey.get(key)?.()
  const resolvedRoot = path.resolve(rootPath)
  const cleanup = startFsWatch(key, rootPath, (changedPath) => {
    if (!win.isDestroyed()) {
      let out: string | undefined
      if (changedPath) {
        const abs = path.resolve(changedPath)
        if (abs === resolvedRoot || isPathInside(abs, resolvedRoot)) {
          out = abs
        }
      }
      win.webContents.send("fs:changed", {
        rootPath: resolvedRoot,
        changedPath: out,
      })
    }
  })
  fsWatchByKey.set(key, cleanup)
})

ipcMain.on("fs:unwatch-root", (event, payload) => {
  const r = assertRecord(payload, "fs:unwatch-root")
  const rootPath = expectString(r, "rootPath", "fs:unwatch-root")
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    return
  }
  const key = fsWatchKey(win.id, rootPath)
  fsWatchByKey.get(key)?.()
  fsWatchByKey.delete(key)
})

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

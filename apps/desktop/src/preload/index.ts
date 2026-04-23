import { contextBridge, ipcRenderer } from "electron"

function onIpc<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  selectFolder: () =>
    ipcRenderer.invoke("select-folder") as Promise<string | null>,
  terminal: {
    create: (shapeId: string, cwd: string) =>
      ipcRenderer.invoke("terminal:create", { shapeId, cwd }) as Promise<{
        pid: number | null
        sessionKey: string
      }>,
    list: () =>
      ipcRenderer.invoke("terminal:list") as Promise<
        {
          id: string
          name?: string
          sidecarSessionId: string
          shell: string
          cwd: string
          pid: number | null
          createdAt: string
        }[]
      >,
    reconnect: (sessionKey: string, cols: number, rows: number) =>
      ipcRenderer.invoke("terminal:reconnect", {
        sessionKey,
        cols,
        rows,
      }) as Promise<void>,
    rename: (sessionKey: string, name?: string) =>
      ipcRenderer.invoke("terminal:rename", { sessionKey, name }) as Promise<{
        id: string
        name?: string
        sidecarSessionId: string
        shell: string
        cwd: string
        pid: number | null
        createdAt: string
      }>,
    write: (sessionKey: string, data: string) =>
      ipcRenderer.send("terminal:input", { sessionKey, data }),
    resize: (sessionKey: string, cols: number, rows: number) =>
      ipcRenderer.send("terminal:resize", { sessionKey, cols, rows }),
    dispose: (sessionKey: string) =>
      ipcRenderer.send("terminal:dispose", { sessionKey }),
    detach: (sessionKey: string) =>
      ipcRenderer.send("terminal:detach", { sessionKey }),
    onData: (sessionKey: string, callback: (data: string) => void) =>
      onIpc(`terminal:data:${sessionKey}`, callback),
    onExit: (sessionKey: string, callback: () => void) =>
      onIpc(`terminal:exit:${sessionKey}`, callback),
  },
  git: {
    status: (repoPath: string) =>
      ipcRenderer.invoke("git:status", { repoPath }) as Promise<{
        entries: {
          path: string
          absPath: string
          indexStatus: string
          workTreeStatus: string
          added: number
          removed: number
        }[]
        branch: string
        trunk: string | null
        error: string | null
      }>,
    diff: (request: {
      repoPath: string
      path: string
      absPath: string
      indexStatus: string
      workTreeStatus: string
    }) =>
      ipcRenderer.invoke("git:diff", request) as Promise<{
        patch: string | null
        error: string | null
      }>,
  },
  worktree: {
    list: (repoPath: string) =>
      ipcRenderer.invoke("worktree:list", { repoPath }) as Promise<
        {
          id: string
          path: string
          branch: string
          head: string
          isMain: boolean
          createdAt: string
          repoPath: string
        }[]
      >,
    create: (repoPath: string, branch: string) =>
      ipcRenderer.invoke("worktree:create", { repoPath, branch }) as Promise<{
        id: string
        path: string
        branch: string
      }>,
    remove: (repoPath: string, id: string) =>
      ipcRenderer.invoke("worktree:remove", { repoPath, id }) as Promise<{
        ok: true
      }>,
    renameBranch: (repoPath: string, id: string, branch: string) =>
      ipcRenderer.invoke("worktree:rename-branch", {
        repoPath,
        id,
        branch,
      }) as Promise<{
        id: string
        path: string
        branch: string
        head: string
        isMain: boolean
        createdAt: string
        repoPath: string
      }>,
  },
  management: {
    getPolicy: () =>
      ipcRenderer.invoke("management:get-policy") as Promise<{
        version: number
        user: {
          renameTerminal: boolean
          renameBranch: boolean
        }
        agent: {
          renameTerminal: boolean
          renameBranch: boolean
        }
      }>,
    updatePolicy: (
      patch: Partial<{
        user: Partial<{
          renameTerminal: boolean
          renameBranch: boolean
        }>
        agent: Partial<{
          renameTerminal: boolean
          renameBranch: boolean
        }>
      }>
    ) =>
      ipcRenderer.invoke("management:update-policy", patch) as Promise<{
        version: number
        user: {
          renameTerminal: boolean
          renameBranch: boolean
        }
        agent: {
          renameTerminal: boolean
          renameBranch: boolean
        }
      }>,
  },
  fs: {
    readdir: (dirPath: string) =>
      ipcRenderer.invoke("fs:readdir", { dirPath }) as Promise<{
        entries: { name: string; path: string; isDirectory: boolean }[]
        repoRoot: string | null
      }>,
    openPath: (filePath: string) =>
      ipcRenderer.invoke("fs:open-path", { filePath }) as Promise<void>,
    watchRoot: (rootPath: string) =>
      ipcRenderer.invoke("fs:watch-root", { rootPath }) as Promise<void>,
    unwatchRoot: (rootPath: string) =>
      ipcRenderer.send("fs:unwatch-root", { rootPath }),
    onChanged: (callback: (data: { rootPath: string }) => void) =>
      onIpc("fs:changed", callback),
  },
  rpc: {
    onCreateTerminal: (
      callback: (data: {
        shapeId: string
        x: number
        y: number
        w: number
        h: number
      }) => void
    ) => onIpc("rpc:create-terminal", callback),
    onGetShapes: (callback: (data: { responseChannel: string }) => void) =>
      onIpc("rpc:get-shapes", callback),
    respondShapes: (channel: string, shapes: unknown) => {
      if (!channel.startsWith("rpc:shapes-response:")) {
        throw new Error("Invalid response channel")
      }
      ipcRenderer.send(channel, shapes)
    },
    onNotification: (
      callback: (data: {
        method: string
        params: Record<string, unknown>
      }) => void
    ) => onIpc("rpc:notification", callback),
  },
})

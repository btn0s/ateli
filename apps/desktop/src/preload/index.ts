import { contextBridge, ipcRenderer } from "electron"

type WorkspaceTreeNode = {
  name: string
  path: string
  kind: "file" | "directory"
  children?: WorkspaceTreeNode[]
}

function onIpc<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  selectFolder: () => ipcRenderer.invoke("select-folder") as Promise<string | null>,
  workspace: {
    listTree: (root: string, depth = 3) =>
      ipcRenderer.invoke("workspace:list-tree", { root, depth }) as Promise<WorkspaceTreeNode[]>,
  },
  terminal: {
    create: (shapeId: string, cwd: string) =>
      ipcRenderer.invoke("terminal:create", { shapeId, cwd }) as Promise<{
        pid: number
        sessionKey: string
      }>,
    write: (sessionKey: string, data: string) =>
      ipcRenderer.send("terminal:input", { sessionKey, data }),
    resize: (sessionKey: string, cols: number, rows: number) =>
      ipcRenderer.send("terminal:resize", { sessionKey, cols, rows }),
    dispose: (sessionKey: string) =>
      ipcRenderer.send("terminal:dispose", { sessionKey }),
    onData: (sessionKey: string, callback: (data: string) => void) =>
      onIpc(`terminal:data:${sessionKey}`, callback),
    onExit: (sessionKey: string, callback: () => void) =>
      onIpc(`terminal:exit:${sessionKey}`, callback),
  },
  rpc: {
    onCreateTerminal: (callback: (data: { shapeId: string; x: number; y: number; w: number; h: number }) => void) =>
      onIpc("rpc:create-terminal", callback),
    onGetShapes: (callback: (data: { responseChannel: string }) => void) =>
      onIpc("rpc:get-shapes", callback),
    respondShapes: (channel: string, shapes: unknown) => {
      if (!channel.startsWith("rpc:shapes-response:")) {
        throw new Error("Invalid response channel")
      }
      ipcRenderer.send(channel, shapes)
    },
  },
})

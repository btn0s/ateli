import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  selectFolder: () => ipcRenderer.invoke("select-folder") as Promise<string | null>,
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
    onData: (sessionKey: string, callback: (data: string) => void) => {
      const channel = `terminal:data:${sessionKey}`
      const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onExit: (sessionKey: string, callback: () => void) => {
      const channel = `terminal:exit:${sessionKey}`
      const handler = () => callback()
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
  },
})

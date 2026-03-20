interface Window {
  electron: {
    platform: string
    selectFolder: () => Promise<string | null>
    terminal: {
      create: (
        shapeId: string,
        cwd: string,
      ) => Promise<{ pid: number; sessionKey: string }>
      write: (sessionKey: string, data: string) => void
      resize: (sessionKey: string, cols: number, rows: number) => void
      dispose: (sessionKey: string) => void
      onData: (sessionKey: string, callback: (data: string) => void) => () => void
      onExit: (sessionKey: string, callback: () => void) => () => void
    }
    rpc: {
      onCreateTerminal: (callback: (data: { shapeId: string; x: number; y: number; w: number; h: number }) => void) => () => void
      onGetShapes: (callback: (data: { responseChannel: string }) => void) => () => void
      respondShapes: (channel: string, shapes: unknown) => void
    }
  }
}

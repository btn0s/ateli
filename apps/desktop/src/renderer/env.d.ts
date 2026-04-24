interface Window {
  electron: {
    platform: string
    selectFolder: () => Promise<string | null>
    terminal: {
      create: (
        shapeId: string,
        cwd: string
      ) => Promise<{ pid: number | null; sessionKey: string }>
      list: () => Promise<
        {
          id: string
          name?: string
          sidecarSessionId: string
          shell: string
          cwd: string
          pid: number | null
          createdAt: string
        }[]
      >
      reconnect: (
        sessionKey: string,
        cols: number,
        rows: number
      ) => Promise<void>
      rename: (
        sessionKey: string,
        name?: string
      ) => Promise<{
        id: string
        name?: string
        sidecarSessionId: string
        shell: string
        cwd: string
        pid: number | null
        createdAt: string
      }>
      write: (sessionKey: string, data: string) => void
      resize: (sessionKey: string, cols: number, rows: number) => void
      dispose: (sessionKey: string) => void
      detach: (sessionKey: string) => void
      onData: (
        sessionKey: string,
        callback: (data: string) => void
      ) => () => void
      onExit: (sessionKey: string, callback: () => void) => () => void
    }
    fs: {
      readdir: (dirPath: string) => Promise<{
        entries: { name: string; path: string; isDirectory: boolean }[]
        repoRoot: string | null
      }>
      openPath: (filePath: string) => Promise<void>
      watchRoot: (rootPath: string) => Promise<void>
      unwatchRoot: (rootPath: string) => void
      onChanged: (
        callback: (data: { rootPath: string; changedPath?: string }) => void
      ) => () => void
    }
    git: {
      status: (repoPath: string) => Promise<{
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
      }>
      diff: (request: {
        repoPath: string
        path: string
        absPath: string
        indexStatus: string
        workTreeStatus: string
      }) => Promise<{
        patch: string | null
        error: string | null
      }>
      commit: (request: {
        repoPath: string
        message: string
        amend?: boolean
      }) => Promise<{ ok: true } | { ok: false; error: string }>
      push: (repoPath: string) => Promise<
        { ok: true } | { ok: false; error: string }
      >
      generateCommitMessage: (repoPath: string) => Promise<{
        message: string | null
        error: string | null
      }>
      stagePaths: (
        repoPath: string,
        paths: string[]
      ) => Promise<{ ok: true } | { ok: false; error: string }>
      unstagePaths: (
        repoPath: string,
        paths: string[]
      ) => Promise<{ ok: true } | { ok: false; error: string }>
    }
    worktree: {
      list: (repoPath: string) => Promise<
        {
          id: string
          path: string
          branch: string
          head: string
          isMain: boolean
          createdAt: string
          repoPath: string
        }[]
      >
      create: (
        repoPath: string,
        branch: string,
        options?: { startPoint?: string }
      ) => Promise<{
        id: string
        path: string
        branch: string
      }>
      remove: (repoPath: string, id: string) => Promise<{ ok: true }>
      renameBranch: (
        repoPath: string,
        id: string,
        branch: string
      ) => Promise<{
        id: string
        path: string
        branch: string
        head: string
        isMain: boolean
        createdAt: string
        repoPath: string
      }>
    }
    management: {
      getPolicy: () => Promise<{
        version: number
        user: {
          renameTerminal: boolean
          renameBranch: boolean
          updatePolicy: boolean
        }
        agent: {
          renameTerminal: boolean
          renameBranch: boolean
          updatePolicy: boolean
        }
      }>
      updatePolicy: (patch: {
        user?: {
          renameTerminal?: boolean
          renameBranch?: boolean
          updatePolicy?: boolean
        }
        agent?: {
          renameTerminal?: boolean
          renameBranch?: boolean
          updatePolicy?: boolean
        }
      }) => Promise<{
        version: number
        user: {
          renameTerminal: boolean
          renameBranch: boolean
          updatePolicy: boolean
        }
        agent: {
          renameTerminal: boolean
          renameBranch: boolean
          updatePolicy: boolean
        }
      }>
    }
    rpc: {
      onCreateTerminal: (
        callback: (data: {
          shapeId: string
          x: number
          y: number
          w: number
          h: number
        }) => void
      ) => () => void
      onGetShapes: (
        callback: (data: { responseChannel: string }) => void
      ) => () => void
      respondShapes: (channel: string, shapes: unknown) => void
      onNotification: (
        callback: (data: {
          method: string
          params: Record<string, unknown>
        }) => void
      ) => () => void
    }
  }
}

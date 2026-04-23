import { createContext, useContext, useRef, type ReactNode } from "react"

export type TerminalSessionAttachment = {
  sessionId: string
  ipcSessionKey: string
  refs: number
  cwd: string
}

export type TerminalSessionHandle = {
  sessionId: string
  ipcSessionKey: string
}

type TerminalSessionSubscriber = {
  onData: (data: string) => void
  onExit: () => void
}

type TerminalSessionEntry = TerminalSessionAttachment & {
  subscribers: Set<TerminalSessionSubscriber>
  removeData: (() => void) | null
  removeExit: (() => void) | null
}

type AttachTerminalSessionOptions = {
  existingSessionId?: string
  ownerId: string
  cwd: string
  cols?: number
  rows?: number
}

export type TerminalSessionStore = {
  attach: (opts: AttachTerminalSessionOptions) => Promise<TerminalSessionHandle>
  detach: (sessionId: string) => void
  subscribe: (
    sessionId: string,
    handlers: TerminalSessionSubscriber
  ) => () => void
  write: (sessionId: string, data: string) => void
  resize: (sessionId: string, cols: number, rows: number) => void
  list: () => TerminalSessionAttachment[]
}

const TerminalSessionContext = createContext<TerminalSessionStore | null>(null)

class RendererTerminalSessionStore implements TerminalSessionStore {
  private sessions = new Map<string, TerminalSessionEntry>()

  async attach({
    existingSessionId,
    ownerId,
    cwd,
    cols = 80,
    rows = 24,
  }: AttachTerminalSessionOptions): Promise<TerminalSessionHandle> {
    if (existingSessionId) {
      const existing = this.sessions.get(existingSessionId)
      if (existing) {
        existing.refs += 1
        return this.toHandle(existing)
      }

      await window.electron.terminal.reconnect(existingSessionId, cols, rows)
      const entry = this.createEntry({
        sessionId: existingSessionId,
        ipcSessionKey: existingSessionId,
        refs: 1,
        cwd,
      })
      this.sessions.set(entry.sessionId, entry)
      this.ensureIpcSubscriptions(entry)
      return this.toHandle(entry)
    }

    const { sessionKey } = await window.electron.terminal.create(ownerId, cwd)
    const entry = this.createEntry({
      sessionId: sessionKey,
      ipcSessionKey: sessionKey,
      refs: 1,
      cwd,
    })
    this.sessions.set(entry.sessionId, entry)
    this.ensureIpcSubscriptions(entry)
    return this.toHandle(entry)
  }

  detach(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    entry.refs = Math.max(0, entry.refs - 1)
    if (entry.refs > 0) return

    this.removeSession(entry)
    window.electron.terminal.dispose(entry.ipcSessionKey)
  }

  subscribe(
    sessionId: string,
    handlers: TerminalSessionSubscriber
  ): () => void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return () => {}

    entry.subscribers.add(handlers)
    return () => {
      entry.subscribers.delete(handlers)
    }
  }

  write(sessionId: string, data: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    window.electron.terminal.write(entry.ipcSessionKey, data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    window.electron.terminal.resize(entry.ipcSessionKey, cols, rows)
  }

  list(): TerminalSessionAttachment[] {
    return [...this.sessions.values()].map(
      ({ sessionId, ipcSessionKey, refs, cwd }) => ({
        sessionId,
        ipcSessionKey,
        refs,
        cwd,
      })
    )
  }

  private createEntry(
    attachment: TerminalSessionAttachment
  ): TerminalSessionEntry {
    return {
      ...attachment,
      subscribers: new Set(),
      removeData: null,
      removeExit: null,
    }
  }

  private ensureIpcSubscriptions(entry: TerminalSessionEntry): void {
    if (!entry.removeData) {
      entry.removeData = window.electron.terminal.onData(
        entry.ipcSessionKey,
        (data) => {
          for (const subscriber of [...entry.subscribers]) {
            subscriber.onData(data)
          }
        }
      )
    }

    if (!entry.removeExit) {
      entry.removeExit = window.electron.terminal.onExit(
        entry.ipcSessionKey,
        () => {
          this.removeSession(entry)
          for (const subscriber of [...entry.subscribers]) {
            subscriber.onExit()
          }
          entry.subscribers.clear()
        }
      )
    }
  }

  private removeSession(entry: TerminalSessionEntry): void {
    entry.removeData?.()
    entry.removeExit?.()
    entry.removeData = null
    entry.removeExit = null
    this.sessions.delete(entry.sessionId)
  }

  private toHandle(entry: TerminalSessionEntry): TerminalSessionHandle {
    return {
      sessionId: entry.sessionId,
      ipcSessionKey: entry.ipcSessionKey,
    }
  }
}

export function TerminalSessionProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<TerminalSessionStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = new RendererTerminalSessionStore()
  }

  return (
    <TerminalSessionContext.Provider value={storeRef.current}>
      {children}
    </TerminalSessionContext.Provider>
  )
}

export function useTerminalSessionStore(): TerminalSessionStore {
  const store = useContext(TerminalSessionContext)
  if (!store) {
    throw new Error(
      "useTerminalSessionStore must be used within TerminalSessionProvider"
    )
  }
  return store
}

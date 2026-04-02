// apps/desktop/src/main/pty.ts
import * as net from "node:net"
import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import os from "node:os"
import { BrowserWindow } from "electron"
import { SidecarClient } from "./sidecar/client"
import { broadcast } from "./rpc"
import type { SessionCreateResult } from "./sidecar/protocol"

const ATELI_DIR = path.join(os.homedir(), ".ateli")
const SESSIONS_PATH = path.join(ATELI_DIR, "sessions.json")

export interface TerminalMetadata {
  id: string
  name?: string
  sidecarSessionId: string
  shell: string
  cwd: string
  pid: number | null
  createdAt: string
}

interface ActiveSession {
  metadata: TerminalMetadata
  dataSocket: net.Socket | null
}

export class PtyManager {
  private client: SidecarClient
  private sessions = new Map<string, ActiveSession>()

  constructor() {
    this.client = new SidecarClient()
  }

  async init(): Promise<void> {
    this.client.onNotification((method, params) => {
      if (method === "session.exited") {
        this.handleSessionExited(
          params.sessionId as string,
          params.exitCode as number,
        )
      }
    })

    await this.client.ensureSidecar()
    await this.discoverSessions()
    await this.cleanDetachedSessions()
  }

  async createSession(opts: {
    cwd: string
    name?: string
  }): Promise<{ id: string; sessionKey: string }> {
    await this.client.ensureSidecar()

    const shell = process.env.SHELL || "/bin/zsh"
    const result: SessionCreateResult = await this.client.createSession({
      shell,
      cwd: opts.cwd,
      cols: 80,
      rows: 24,
    })

    const id = crypto.randomUUID().slice(0, 8)
    const metadata: TerminalMetadata = {
      id,
      name: opts.name,
      sidecarSessionId: result.sessionId,
      shell,
      cwd: opts.cwd,
      pid: result.pid,
      createdAt: new Date().toISOString(),
    }

    const session: ActiveSession = { metadata, dataSocket: null }
    this.sessions.set(id, session)
    this.saveSessionsImmediate()

    await this.attachDataSocket(id, result.socketPath)

    return { id, sessionKey: result.sessionId }
  }

  async reconnectSession(
    id: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Unknown session: ${id}`)

    await this.client.ensureSidecar()
    const result = await this.client.reconnectSession(
      session.metadata.sidecarSessionId,
      cols,
      rows,
    )

    if (session.dataSocket && !session.dataSocket.destroyed) {
      session.dataSocket.destroy()
      session.dataSocket = null
    }

    await this.attachDataSocket(id, result.socketPath)
  }

  async writeSession(id: string, data: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session?.dataSocket) return
    session.dataSocket.write(data)
  }

  async resizeSession(id: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    await this.client.resizeSession(session.metadata.sidecarSessionId, cols, rows)
  }

  async killSession(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.dataSocket && !session.dataSocket.destroyed) {
      session.dataSocket.destroy()
    }
    try {
      await this.client.killSession(session.metadata.sidecarSessionId)
    } catch {
      // Already dead
    }
  }

  detachSession(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.dataSocket && !session.dataSocket.destroyed) {
      session.dataSocket.destroy()
      session.dataSocket = null
    }
  }

  async readSession(id: string): Promise<string> {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Unknown session: ${id}`)
    return this.client.snapshotSession(session.metadata.sidecarSessionId)
  }

  listSessions(): TerminalMetadata[] {
    return [...this.sessions.values()].map((s) => s.metadata)
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.dataSocket && !session.dataSocket.destroyed) {
        session.dataSocket.destroy()
      }
    }
    await this.client.shutdownIfIdle()
    this.client.disconnect()
  }

  // --- Internal ---

  private async attachDataSocket(id: string, socketPath: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return

    const dataSocket = await this.client.attachDataSocket(
      socketPath,
      (data) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.webContents.send(
            `terminal:data:${session.metadata.sidecarSessionId}`,
            data.toString(),
          )
        }
      },
    )
    session.dataSocket = dataSocket
  }

  private handleSessionExited(sidecarSessionId: string, exitCode: number): void {
    let found: { id: string; session: ActiveSession } | null = null
    for (const [id, session] of this.sessions) {
      if (session.metadata.sidecarSessionId === sidecarSessionId) {
        found = { id, session }
        break
      }
    }
    if (!found) return

    if (found.session.dataSocket && !found.session.dataSocket.destroyed) {
      found.session.dataSocket.destroy()
    }
    this.sessions.delete(found.id)
    this.saveSessionsImmediate()

    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send(`terminal:exit:${sidecarSessionId}`, exitCode)
    }

    broadcast("terminal.exit", { id: found.id, sessionKey: sidecarSessionId, exitCode })
  }

  private async discoverSessions(): Promise<void> {
    const persisted = this.loadSessions()
    if (persisted.length === 0) return

    let liveSessions: Set<string>
    try {
      const sidecarSessions = await this.client.listSessions()
      liveSessions = new Set(sidecarSessions.map((s) => s.sessionId))
    } catch {
      liveSessions = new Set()
    }

    for (const meta of persisted) {
      if (liveSessions.has(meta.sidecarSessionId)) {
        this.sessions.set(meta.id, { metadata: meta, dataSocket: null })
      }
    }

    this.saveSessionsImmediate()
  }

  private async cleanDetachedSessions(): Promise<void> {
    try {
      const sidecarSessions = await this.client.listSessions()
      const knownSidecarIds = new Set(
        [...this.sessions.values()].map((s) => s.metadata.sidecarSessionId),
      )
      for (const session of sidecarSessions) {
        if (!knownSidecarIds.has(session.sessionId)) {
          await this.client.killSession(session.sessionId)
        }
      }
    } catch {
      // Sidecar not available
    }
  }

  private loadSessions(): TerminalMetadata[] {
    try {
      const raw = fs.readFileSync(SESSIONS_PATH, "utf-8")
      return JSON.parse(raw) as TerminalMetadata[]
    } catch {
      return []
    }
  }

  private saveSessionsImmediate(): void {
    const data = [...this.sessions.values()].map((s) => s.metadata)
    fs.mkdirSync(ATELI_DIR, { recursive: true })
    const tmp = SESSIONS_PATH + "." + crypto.randomUUID().slice(0, 8)
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, SESSIONS_PATH)
  }
}

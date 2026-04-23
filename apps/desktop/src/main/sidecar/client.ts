// apps/desktop/src/main/sidecar/client.ts
import * as net from "node:net"
import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { spawn } from "node:child_process"
import {
  makeRequest,
  SIDECAR_SOCKET_PATH,
  SIDECAR_PID_PATH,
  SIDECAR_VERSION,
  type JsonRpcResponse,
  type SessionCreateParams,
  type SessionCreateResult,
  type SessionReconnectResult,
  type SessionInfo,
  type PingResult,
  type PidFileData,
} from "./protocol"

type NotificationHandler = (
  method: string,
  params: Record<string, unknown>,
) => void

export class SidecarClient {
  private socket: net.Socket | null = null
  private nextId = 1
  private pending = new Map<
    number,
    {
      resolve: (resp: JsonRpcResponse) => void
      reject: (err: Error) => void
    }
  >()
  private buf = ""
  private notificationHandler: NotificationHandler | null = null
  private sidecarStarting: Promise<void> | null = null

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler
  }

  async ensureSidecar(): Promise<void> {
    if (this.sidecarStarting) return this.sidecarStarting
    this.sidecarStarting = this._ensureSidecar()
    try {
      await this.sidecarStarting
    } finally {
      this.sidecarStarting = null
    }
  }

  private async _ensureSidecar(): Promise<void> {
    if (this.socket) {
      try {
        await this.ping()
        return
      } catch {
        this.disconnect()
      }
    }

    const existing = this.readPidFile()
    if (existing) {
      try {
        process.kill(existing.pid, 0)
        if (existing.version === SIDECAR_VERSION) {
          await this.connect(existing.token)
          await this.ping()
          return
        }
      } catch {
        // Dead or wrong version
      }
      this.disconnect()
    }

    const token = crypto.randomUUID()
    const sidecarEntry = path.join(__dirname, "sidecar-entry.js")

    const child = spawn(process.execPath, [sidecarEntry, "--token", token], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    })
    child.unref()

    await this.waitForSidecar(token, 5000)
  }

  private readPidFile(): PidFileData | null {
    try {
      const raw = fs.readFileSync(SIDECAR_PID_PATH, "utf-8")
      return JSON.parse(raw) as PidFileData
    } catch {
      return null
    }
  }

  private async waitForSidecar(token: string, timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const pid = this.readPidFile()
      if (pid && pid.token === token) {
        try {
          await this.connect(token)
          return
        } catch {
          this.disconnect()
        }
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error("Sidecar failed to start within timeout")
  }

  private async connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(SIDECAR_SOCKET_PATH, async () => {
        this.socket!.removeListener("error", reject)
        this.socket!.on("error", () => this.rejectAllPending())
        this.socket!.on("close", () => this.rejectAllPending())
        try {
          await this.rpc("sidecar.auth", { token })
          resolve()
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
      this.socket.on("error", reject)
      this.socket.on("data", (chunk) => this.handleData(chunk))
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.rejectAllPending()
  }

  private rejectAllPending(): void {
    const err = new Error("Sidecar connection lost")
    for (const [, { reject }] of this.pending) {
      reject(err)
    }
    this.pending.clear()
  }

  private handleData(chunk: Buffer | string): void {
    this.buf += chunk.toString()
    let nl: number
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + 1)
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }

      if (msg.id === undefined) {
        this.notificationHandler?.(
          msg.method as string,
          (msg.params ?? {}) as Record<string, unknown>,
        )
        continue
      }

      const pending = this.pending.get(msg.id as number)
      if (pending) {
        this.pending.delete(msg.id as number)
        pending.resolve(msg as unknown as JsonRpcResponse)
      }
    }
  }

  private async rpc(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.socket) throw new Error("Not connected to sidecar")
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, 10_000)

      this.pending.set(id, {
        resolve: (resp) => {
          clearTimeout(timer)
          if (resp.error) {
            reject(new Error(resp.error.message))
          } else {
            resolve(resp.result)
          }
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
      this.socket!.write(makeRequest(id, method, params))
    })
  }

  async ping(): Promise<PingResult> {
    return this.rpc("sidecar.ping") as Promise<PingResult>
  }

  async createSession(params: SessionCreateParams): Promise<SessionCreateResult> {
    return this.rpc(
      "session.create",
      params as unknown as Record<string, unknown>,
    ) as Promise<SessionCreateResult>
  }

  async reconnectSession(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<SessionReconnectResult> {
    return this.rpc("session.reconnect", { sessionId, cols, rows }) as Promise<SessionReconnectResult>
  }

  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.rpc("session.resize", { sessionId, cols, rows })
  }

  async killSession(sessionId: string): Promise<void> {
    await this.rpc("session.kill", { sessionId })
  }

  async listSessions(): Promise<SessionInfo[]> {
    const result = (await this.rpc("session.list")) as { sessions: SessionInfo[] }
    return result.sessions
  }

  async snapshotSession(sessionId: string): Promise<string> {
    const result = (await this.rpc("session.snapshot", { sessionId })) as { data: string }
    return result.data
  }

  async shutdownIfIdle(): Promise<void> {
    try {
      await this.rpc("sidecar.shutdown")
    } catch {
      // Already dead or not connected
    }
  }

  async attachDataSocket(
    socketPath: string,
    onData: (data: Buffer | string) => void,
  ): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(socketPath, () => {
        resolve(sock)
      })
      sock.on("data", (chunk) => onData(chunk))
      sock.on("error", reject)
    })
  }
}

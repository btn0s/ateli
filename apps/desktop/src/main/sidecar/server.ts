// apps/desktop/src/main/sidecar/server.ts
import * as net from "node:net";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as pty from "node-pty";
import { RingBuffer } from "./ring-buffer";
import {
  makeResponse,
  makeError,
  makeNotification,
  DEFAULT_RING_BUFFER_BYTES,
  SIDECAR_VERSION,
  ATELI_DIR,
  sessionSocketPath as buildSessionSocketPath,
  type JsonRpcRequest,
  type SessionCreateParams,
  type SessionCreateResult,
  type SessionReconnectParams,
  type SessionReconnectResult,
  type SessionInfo,
  type PingResult,
  type PidFileData,
} from "./protocol";

export interface ServerOptions {
  controlSocketPath: string;
  sessionSocketDir: string;
  pidFilePath: string;
  token: string;
  idleTimeoutMs?: number;
  ringBufferBytes?: number;
}

interface Session {
  id: string;
  pty: pty.IPty;
  shell: string;
  cwd: string;
  createdAt: string;
  ringBuffer: RingBuffer;
  dataServer: net.Server;
  dataClient: net.Socket | null;
  socketPath: string;
  hasAttachedClient: boolean;
  /** When non-null, PTY output is queued here instead of sent to client. */
  reconnectQueue: Buffer[] | null;
  killEscalationTimer: NodeJS.Timeout | null;
}

// --- Socket helpers (no Windows support) ---

function prepareEndpoint(endpoint: string): void {
  fs.mkdirSync(ATELI_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(ATELI_DIR, 0o700);
  } catch {
    // Best effort; restrictive umask may already be sufficient.
  }
  if (fs.existsSync(endpoint)) {
    try {
      fs.unlinkSync(endpoint);
    } catch {
      // Already gone.
    }
  }
}

function cleanupEndpoint(endpoint: string): void {
  if (!fs.existsSync(endpoint)) return;
  try {
    fs.unlinkSync(endpoint);
  } catch {
    // Already gone.
  }
}

export class SidecarServer {
  private controlServer: net.Server | null = null;
  private controlClients = new Set<net.Socket>();
  private authenticatedClients = new WeakSet<net.Socket>();
  private sessions = new Map<string, Session>();
  private startTime = Date.now();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: Required<ServerOptions>;

  constructor(opts: ServerOptions) {
    this.opts = {
      ...opts,
      idleTimeoutMs: opts.idleTimeoutMs ?? 0,
      ringBufferBytes: opts.ringBufferBytes ?? DEFAULT_RING_BUFFER_BYTES,
    };
  }

  async start(): Promise<void> {
    fs.mkdirSync(this.opts.sessionSocketDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.opts.sessionSocketDir, 0o700);
    } catch {
      // Best effort.
    }
    try {
      fs.chmodSync(ATELI_DIR, 0o700);
    } catch {
      // Best effort.
    }
    prepareEndpoint(this.opts.controlSocketPath);

    // Write PID file
    const pidData: PidFileData = {
      pid: process.pid,
      token: this.opts.token,
      version: SIDECAR_VERSION,
    };
    fs.writeFileSync(this.opts.pidFilePath, JSON.stringify(pidData), {
      mode: 0o600,
    });
    try {
      fs.chmodSync(this.opts.pidFilePath, 0o600);
    } catch {
      // Best effort.
    }

    await new Promise<void>((resolve) => {
      this.controlServer = net.createServer((sock) =>
        this.handleControlClient(sock),
      );
      this.controlServer.listen(this.opts.controlSocketPath, () => {
        try {
          fs.chmodSync(this.opts.controlSocketPath, 0o600);
        } catch {
          // Best effort.
        }
        resolve();
      });
    });

    this.resetIdleTimer();
  }

  async shutdown(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);

    // Kill all sessions
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      this.killSession(id);
    }

    // Close control clients
    for (const client of this.controlClients) {
      client.destroy();
    }

    // Close control server
    if (this.controlServer) {
      await new Promise<void>((resolve) =>
        this.controlServer!.close(() => resolve()),
      );
    }

    // Clean up files
    cleanupEndpoint(this.opts.controlSocketPath);
    try {
      fs.unlinkSync(this.opts.pidFilePath);
    } catch {
      // Already gone.
    }
  }

  // --- Control channel ---

  private handleControlClient(sock: net.Socket): void {
    this.controlClients.add(sock);
    this.resetIdleTimer();
    let buf = "";

    sock.on("data", (chunk) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        this.handleRpcMessage(sock, line);
      }
    });

    sock.on("close", () => {
      this.controlClients.delete(sock);
      this.authenticatedClients.delete(sock);
      this.resetIdleTimer();
    });

    sock.on("error", () => {
      this.controlClients.delete(sock);
      this.authenticatedClients.delete(sock);
    });
  }

  private handleRpcMessage(sock: net.Socket, line: string): void {
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(line);
    } catch {
      sock.write(makeError(0, -32700, "Parse error"));
      return;
    }

    const { id, method, params } = msg;

    if (method === "sidecar.auth") {
      const token = (params as { token?: string } | undefined)?.token;
      if (typeof token === "string" && token === this.opts.token) {
        this.authenticatedClients.add(sock);
        sock.write(makeResponse(id, { ok: true }));
      } else {
        sock.write(makeError(id, -32005, "Auth failed"));
        sock.destroy();
      }
      return;
    }

    if (!this.authenticatedClients.has(sock)) {
      sock.write(makeError(id, -32005, "Auth required"));
      sock.destroy();
      return;
    }

    switch (method) {
      case "sidecar.ping":
        return this.handlePing(sock, id);
      case "sidecar.shutdown":
        return this.handleShutdown(sock, id);
      case "session.create":
        return this.handleCreate(
          sock,
          id,
          params as unknown as SessionCreateParams,
        );
      case "session.reconnect":
        return this.handleReconnect(
          sock,
          id,
          params as unknown as SessionReconnectParams,
        );
      case "session.resize":
        return this.handleResize(sock, id, params as Record<string, unknown>);
      case "session.kill":
        return this.handleKill(sock, id, params as Record<string, unknown>);
      case "session.list":
        return this.handleList(sock, id);
      case "session.snapshot":
        return this.handleSnapshot(sock, id, params as Record<string, unknown>);
      case "session.foreground":
        return this.handleForeground(
          sock,
          id,
          params as Record<string, unknown>,
        );
      case "session.signal":
        return this.handleSignal(sock, id, params as Record<string, unknown>);
      default:
        sock.write(makeError(id, -32601, `Unknown method: ${method}`));
    }
  }

  // --- RPC handlers ---

  private handlePing(sock: net.Socket, id: number): void {
    const result: PingResult = {
      pid: process.pid,
      uptime: Date.now() - this.startTime,
      version: SIDECAR_VERSION,
    };
    sock.write(makeResponse(id, result));
  }

  private handleShutdown(sock: net.Socket, id: number): void {
    if (this.sessions.size > 0) {
      sock.write(
        makeError(id, -32000, "Cannot shutdown: active sessions exist"),
      );
      return;
    }
    sock.write(makeResponse(id, { ok: true }));
    void this.shutdown().then(() => process.exit(0));
  }

  private handleCreate(
    sock: net.Socket,
    id: number,
    params: SessionCreateParams,
  ): void {
    const sessionId = crypto.randomBytes(8).toString("hex");
    const socketPath = buildSessionSocketPath(sessionId);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...params.env,
    };
    // ELECTRON_RUN_AS_NODE must not leak into user shells
    delete env.ELECTRON_RUN_AS_NODE;
    if (!env.LANG || !env.LANG.includes("UTF-8")) {
      env.LANG = "en_US.UTF-8";
    }

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(params.shell, [], {
        name: "xterm-256color",
        cols: params.cols,
        rows: params.rows,
        cwd: params.cwd,
        env,
        encoding: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `pty.spawn failed: shell=${params.shell} cwd=${params.cwd} error=${msg}\n`,
      );
      sock.write(makeError(id, -32000, `Failed to spawn: ${msg}`));
      return;
    }

    const ringBuffer = new RingBuffer(this.opts.ringBufferBytes);
    const session: Session = {
      id: sessionId,
      pty: ptyProcess,
      shell: params.shell,
      cwd: params.cwd,
      createdAt: new Date().toISOString(),
      ringBuffer,
      dataServer: null!,
      dataClient: null,
      socketPath,
      hasAttachedClient: false,
      reconnectQueue: null,
      killEscalationTimer: null,
    };

    // Listen for PTY output
    ptyProcess.onData((data: string | Buffer) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      ringBuffer.write(buf);

      if (session.reconnectQueue) {
        session.reconnectQueue.push(buf);
        return;
      }

      if (session.dataClient && !session.dataClient.destroyed) {
        session.dataClient.write(buf);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      // Notify all control clients
      const notification = makeNotification("session.exited", {
        sessionId,
        exitCode,
      });
      for (const client of this.controlClients) {
        if (!this.authenticatedClients.has(client)) continue;
        client.write(notification);
      }
      this.cleanupSession(sessionId);
    });

    // Create per-session data socket server
    prepareEndpoint(socketPath);
    const dataServer = net.createServer((client) => {
      // Last-attach-wins: close previous client
      if (session.dataClient && !session.dataClient.destroyed) {
        session.dataClient.destroy();
      }
      session.dataClient = client;

      // If reconnecting, flush ring buffer snapshot + queued data
      if (session.reconnectQueue) {
        const snapshot = ringBuffer.snapshot();
        if (snapshot.length > 0) {
          client.write(snapshot);
        }
        for (const queued of session.reconnectQueue) {
          client.write(queued);
        }
        session.reconnectQueue = null;
      } else if (!session.hasAttachedClient) {
        // First attach — send any data produced before client connected
        const snapshot = ringBuffer.snapshot();
        if (snapshot.length > 0) {
          client.write(snapshot);
        }
      }
      session.hasAttachedClient = true;

      // Pipe client input to PTY
      client.on("data", (data) => {
        ptyProcess.write(data.toString());
      });

      client.on("close", () => {
        if (session.dataClient === client) {
          session.dataClient = null;
        }
      });

      client.on("error", () => {
        if (session.dataClient === client) {
          session.dataClient = null;
        }
      });
    });
    session.dataServer = dataServer;
    this.sessions.set(sessionId, session);

    dataServer.listen(socketPath, () => {
      try {
        fs.chmodSync(socketPath, 0o600);
      } catch {
        // Best effort.
      }
      this.resetIdleTimer();
      const result: SessionCreateResult = {
        sessionId,
        socketPath,
        pid: ptyProcess.pid,
      };
      sock.write(makeResponse(id, result));
    });
  }

  private handleReconnect(
    sock: net.Socket,
    id: number,
    params: SessionReconnectParams,
  ): void {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      sock.write(
        makeError(id, -32000, `Session not found: ${params.sessionId}`),
      );
      return;
    }

    // Start queuing PTY output
    session.reconnectQueue = [];

    // Resize to match new client
    session.pty.resize(params.cols, params.rows);

    // Close old data client if present
    if (session.dataClient && !session.dataClient.destroyed) {
      session.dataClient.destroy();
      session.dataClient = null;
    }

    const result: SessionReconnectResult = {
      sessionId: params.sessionId,
      socketPath: session.socketPath,
    };
    sock.write(makeResponse(id, result));
  }

  private handleResize(
    sock: net.Socket,
    id: number,
    params: Record<string, unknown>,
  ): void {
    const session = this.sessions.get(params.sessionId as string);
    if (!session) {
      sock.write(makeError(id, -32000, "Session not found"));
      return;
    }
    session.pty.resize(params.cols as number, params.rows as number);
    sock.write(makeResponse(id, { ok: true }));
  }

  private handleKill(
    sock: net.Socket,
    id: number,
    params: Record<string, unknown>,
  ): void {
    const sessionId = params.sessionId as string;
    this.killSession(sessionId);
    sock.write(makeResponse(id, { ok: true }));
  }

  private handleList(sock: net.Socket, id: number): void {
    const sessions: SessionInfo[] = [];
    for (const s of this.sessions.values()) {
      sessions.push({
        sessionId: s.id,
        shell: s.shell,
        cwd: s.cwd,
        pid: s.pty.pid,
        createdAt: s.createdAt,
      });
    }
    sock.write(makeResponse(id, { sessions }));
  }

  private handleSnapshot(
    sock: net.Socket,
    id: number,
    params: Record<string, unknown>,
  ): void {
    const session = this.sessions.get(params.sessionId as string);
    if (!session) {
      sock.write(makeError(id, -32000, "Session not found"));
      return;
    }
    const snapshot = session.ringBuffer.snapshot();
    sock.write(makeResponse(id, { data: snapshot.toString("utf-8") }));
  }

  private handleForeground(
    sock: net.Socket,
    id: number,
    params: Record<string, unknown>,
  ): void {
    const session = this.sessions.get(params.sessionId as string);
    if (!session) {
      sock.write(makeError(id, -32000, "Session not found"));
      return;
    }
    try {
      const out = execFileSync(
        "ps",
        ["-o", "pid=,comm=", "-g", String(session.pty.pid)],
        { encoding: "utf8", timeout: 2000 },
      ).trim();
      const lines = out.split("\n").filter(Boolean);
      const last = lines[lines.length - 1]?.trim();
      const command = last
        ? last.replace(/^\d+\s+/, "").replace(/^.*\//, "")
        : session.shell;
      sock.write(makeResponse(id, { command }));
    } catch {
      sock.write(makeResponse(id, { command: session.shell }));
    }
  }

  private handleSignal(
    sock: net.Socket,
    id: number,
    params: Record<string, unknown>,
  ): void {
    const session = this.sessions.get(params.sessionId as string);
    if (!session) {
      sock.write(makeError(id, -32000, "Session not found"));
      return;
    }
    try {
      process.kill(session.pty.pid, params.signal as string);
      sock.write(makeResponse(id, { ok: true }));
    } catch (err) {
      sock.write(makeError(id, -32000, String(err)));
    }
  }

  // --- Session lifecycle ---

  private killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.killEscalationTimer) return;

    session.pty.kill("SIGTERM");
    session.killEscalationTimer = setTimeout(() => {
      if (!this.sessions.has(sessionId)) return;
      try {
        session.pty.kill("SIGKILL");
      } catch {
        // The PTY may have exited between the session lookup and escalation.
      }
    }, 500);
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.killEscalationTimer) {
      clearTimeout(session.killEscalationTimer);
      session.killEscalationTimer = null;
    }

    if (session.dataClient && !session.dataClient.destroyed) {
      session.dataClient.destroy();
    }
    session.dataServer.close();
    cleanupEndpoint(session.socketPath);
    this.sessions.delete(sessionId);
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.opts.idleTimeoutMs <= 0) return;
    if (this.sessions.size > 0 || this.controlClients.size > 0) return;

    this.idleTimer = setTimeout(() => {
      if (this.sessions.size === 0 && this.controlClients.size === 0) {
        void this.shutdown().then(() => process.exit(0));
      }
    }, this.opts.idleTimeoutMs);
  }
}

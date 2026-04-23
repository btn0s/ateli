// apps/desktop/src/main/sidecar/protocol.ts
import path from "node:path"
import os from "node:os"

export const ATELI_DIR = path.join(os.homedir(), ".ateli")
export const SIDECAR_VERSION = 2
export const DEFAULT_RING_BUFFER_BYTES = 8 * 1024 * 1024 // 8MB
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

export const SIDECAR_SOCKET_PATH = path.join(ATELI_DIR, "pty-sidecar.sock")
export const SIDECAR_PID_PATH = path.join(ATELI_DIR, "pty-sidecar.pid")
export const SESSION_SOCKET_DIR = path.join(ATELI_DIR, "pty-sessions")

export function sessionSocketPath(sessionId: string): string {
  return path.join(SESSION_SOCKET_DIR, `${sessionId}.sock`)
}

// JSON-RPC 2.0 types
export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

export interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: Record<string, unknown>
}

export function makeRequest(
  id: number,
  method: string,
  params?: Record<string, unknown>,
): string {
  const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }
  return JSON.stringify(msg) + "\n"
}

export function makeResponse(id: number, result: unknown): string {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, result }
  return JSON.stringify(msg) + "\n"
}

export function makeError(id: number, code: number, message: string): string {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } }
  return JSON.stringify(msg) + "\n"
}

export function makeNotification(
  method: string,
  params?: Record<string, unknown>,
): string {
  const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params }
  return JSON.stringify(msg) + "\n"
}

// PID file format
export interface PidFileData {
  pid: number
  token: string
  version: number
}

// session.create params/result
export interface SessionCreateParams {
  shell: string
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
}

export interface SessionCreateResult {
  sessionId: string
  socketPath: string
  pid: number
}

// session.reconnect params/result
export interface SessionReconnectParams {
  sessionId: string
  cols: number
  rows: number
}

export interface SessionReconnectResult {
  sessionId: string
  socketPath: string
}

// session.list result
export interface SessionInfo {
  sessionId: string
  shell: string
  cwd: string
  pid: number
  createdAt: string
}

// sidecar.ping result
export interface PingResult {
  pid: number
  uptime: number
  version: number
}

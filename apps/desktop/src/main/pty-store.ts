import type { IPty } from "node-pty"

export const ptys = new Map<string, IPty>()

const MAX_BUFFER = 64 * 1024 // 64KB per session
const outputBuffers = new Map<string, string>()
const readCursors = new Map<string, number>()

export function appendOutput(sessionKey: string, data: string) {
  const existing = outputBuffers.get(sessionKey) ?? ""
  let updated = existing + data
  // Trim from the front if too large
  if (updated.length > MAX_BUFFER) {
    updated = updated.slice(updated.length - MAX_BUFFER)
  }
  outputBuffers.set(sessionKey, updated)
}

export function readOutput(sessionKey: string): string {
  const buffer = outputBuffers.get(sessionKey) ?? ""
  const cursor = readCursors.get(sessionKey) ?? 0
  const newData = buffer.slice(cursor)
  readCursors.set(sessionKey, buffer.length)
  return newData
}

export function clearOutputBuffer(sessionKey: string) {
  outputBuffers.delete(sessionKey)
  readCursors.delete(sessionKey)
}

import type { CommandDefinition } from "./types"

const STORAGE_KEY = "ateli.commandPalette.recency"
const SCHEMA_VERSION = 2
const MAX_ENTRIES = 50

type RecencyFileV2 = {
  v: 2
  byScope: Record<string, string[]>
}

type RecencyFileV1 = {
  v: 1
  scope: string
  ids: string[]
}

function readStore(): { byScope: Record<string, string[]> } {
  if (typeof localStorage === "undefined") {
    return { byScope: {} }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { byScope: {} }
    }
    const data = JSON.parse(raw) as unknown
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const o = data as Record<string, unknown>
      if (o.v === SCHEMA_VERSION && o.byScope && typeof o.byScope === "object" && o.byScope !== null && !Array.isArray(o.byScope)) {
        return { byScope: { ...((o.byScope as Record<string, string[]>)) } }
      }
      if (o.v === 1) {
        const v1 = data as RecencyFileV1
        if (typeof v1.scope === "string" && Array.isArray(v1.ids)) {
          return {
            byScope: v1.scope
              ? { [v1.scope]: v1.ids.slice(0, MAX_ENTRIES) }
              : {},
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return { byScope: {} }
}

function writeStore(byScope: Record<string, string[]>) {
  if (typeof localStorage === "undefined") {
    return
  }
  const payload: RecencyFileV2 = {
    v: SCHEMA_VERSION,
    byScope,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota
  }
}

function load(scope: string): string[] {
  const { byScope } = readStore()
  const ids = byScope[scope]
  if (!Array.isArray(ids)) {
    return []
  }
  return ids.slice(0, MAX_ENTRIES)
}

function saveScope(scope: string, ids: string[]) {
  const { byScope } = readStore()
  const next: Record<string, string[]> = { ...byScope, [scope]: ids.slice(0, MAX_ENTRIES) }
  writeStore(next)
}

/**
 * Return a 0–1 recency weight for a command `id` (1 = most recent use).
 * Must be called with a stable `scope` (e.g. repo path).
 */
export function getRecencyScore(
  scope: string,
  id: string,
  order: string[],
): number {
  const idx = order.indexOf(id)
  if (idx === -1) {
    return 0
  }
  return 1 - idx / Math.max(1, order.length)
}

export function getRecencyOrder(scope: string | null): string[] {
  if (!scope) {
    return []
  }
  return load(scope)
}

export function recordCommandUse(scope: string | null, id: string) {
  if (!scope) {
    return
  }
  const prev = load(scope)
  const next = [id, ...prev.filter((x) => x !== id)].slice(0, MAX_ENTRIES)
  saveScope(scope, next)
}

/** Recent commands in execution order, intersected with known definitions. */
export function resolveRecentCommands(
  scope: string | null,
  defs: Map<string, CommandDefinition>,
  limit: number,
): CommandDefinition[] {
  if (!scope) {
    return []
  }
  const order = load(scope)
  const out: CommandDefinition[] = []
  for (const rid of order) {
    const d = defs.get(rid)
    if (d) {
      out.push(d)
      if (out.length >= limit) {
        break
      }
    }
  }
  return out
}

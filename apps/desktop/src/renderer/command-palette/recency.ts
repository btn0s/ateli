import type { CommandDefinition } from "./types"

const STORAGE_KEY = "ateli.commandPalette.recency"
const SCHEMA_VERSION = 1
const MAX_ENTRIES = 50

type RecencyFile = {
  v: number
  /** Workspace folder or repo path this list is scoped to. */
  scope: string
  /** Most recent first: command `id` strings. */
  ids: string[]
}

function load(scope: string): string[] {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as RecencyFile
    if (data.v !== SCHEMA_VERSION || data.scope !== scope) return []
    return Array.isArray(data.ids) ? data.ids.slice(0, MAX_ENTRIES) : []
  } catch {
    return []
  }
}

function save(scope: string, ids: string[]) {
  if (typeof localStorage === "undefined") return
  const payload: RecencyFile = {
    v: SCHEMA_VERSION,
    scope,
    ids: ids.slice(0, MAX_ENTRIES),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota
  }
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
  if (idx === -1) return 0
  return 1 - idx / Math.max(1, order.length)
}

export function getRecencyOrder(scope: string | null): string[] {
  if (!scope) return []
  return load(scope)
}

export function recordCommandUse(scope: string | null, id: string) {
  if (!scope) return
  const prev = load(scope)
  const next = [id, ...prev.filter((x) => x !== id)].slice(0, MAX_ENTRIES)
  save(scope, next)
}

/** Recent commands in execution order, intersected with known definitions. */
export function resolveRecentCommands(
  scope: string | null,
  defs: Map<string, CommandDefinition>,
  limit: number,
): CommandDefinition[] {
  if (!scope) return []
  const order = load(scope)
  const out: CommandDefinition[] = []
  for (const rid of order) {
    const d = defs.get(rid)
    if (d) {
      out.push(d)
      if (out.length >= limit) break
    }
  }
  return out
}

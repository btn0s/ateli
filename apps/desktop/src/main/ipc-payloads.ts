import type { ManagementPermissions } from "./management"

export function assertRecord(
  x: unknown,
  label: string
): Record<string, unknown> {
  if (x && typeof x === "object" && !Array.isArray(x)) {
    return x as Record<string, unknown>
  }
  throw new Error(`Invalid ${label}: expected object`)
}

export function expectString(
  r: Record<string, unknown>,
  key: string,
  label: string
): string {
  const v = r[key]
  if (typeof v === "string" && v.length > 0) {
    return v
  }
  throw new Error(`Invalid ${label}: ${key} is required`)
}

export function requireStringValue(
  r: Record<string, unknown>,
  key: string,
  label: string
): string {
  const v = r[key]
  if (typeof v === "string") {
    return v
  }
  throw new Error(`Invalid ${label}: ${key} must be a string`)
}

export function expectOptionalString(
  r: Record<string, unknown>,
  key: string
): string | undefined {
  const v = r[key]
  if (v === undefined) return undefined
  if (typeof v === "string") return v
  throw new Error(`Invalid param: ${key} must be a string`)
}

export function expectNumber(
  r: Record<string, unknown>,
  key: string,
  label: string
): number {
  const v = r[key]
  if (typeof v === "number" && Number.isFinite(v)) return v
  throw new Error(`Invalid ${label}: ${key} is required and must be a number`)
}

export function expectStringArray(
  r: Record<string, unknown>,
  key: string,
  label: string
): string[] {
  const v = r[key]
  if (!Array.isArray(v)) {
    throw new Error(`Invalid ${label}: ${key} must be an array`)
  }
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== "string") {
      throw new Error(`Invalid ${label}: ${key}[${i}] must be a string`)
    }
  }
  return v as string[]
}

export function expectBooleanKey(
  r: Record<string, unknown>,
  key: string
): boolean | undefined {
  const v = r[key]
  if (v === undefined) return undefined
  if (typeof v === "boolean") return v
  throw new Error(`Invalid param: ${key} must be a boolean`)
}

const PERM_KEYS = new Set(["renameTerminal", "renameBranch", "updatePolicy"])

function parsePermissionsBlock(
  value: unknown,
  role: "user" | "agent"
): Partial<ManagementPermissions> {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid management patch: ${role} must be an object`)
  }
  const rec = value as Record<string, unknown>
  const out: Record<string, boolean> = {}
  for (const k of Object.keys(rec)) {
    if (!PERM_KEYS.has(k)) {
      throw new Error(`Invalid management patch: unknown key ${k}`)
    }
    const b = rec[k]
    if (typeof b !== "boolean") {
      throw new Error(`Invalid management patch: ${role}.${k} must be boolean`)
    }
    out[k] = b
  }
  return out
}

export function parseManagementPolicyPatch(x: unknown): {
  user?: Partial<ManagementPermissions>
  agent?: Partial<ManagementPermissions>
} {
  const r = assertRecord(x, "management:update-policy")
  const out: {
    user?: Partial<ManagementPermissions>
    agent?: Partial<ManagementPermissions>
  } = {}
  if (r["user"] !== undefined) {
    out.user = parsePermissionsBlock(r["user"], "user")
  }
  if (r["agent"] !== undefined) {
    out.agent = parsePermissionsBlock(r["agent"], "agent")
  }
  return out
}

export function expectGitDiffRequest(
  x: unknown
): {
  repoPath: string
  path: string
  absPath: string
  indexStatus: string
  workTreeStatus: string
} {
  const r = assertRecord(x, "git:diff")
  return {
    repoPath: expectString(r, "repoPath", "git:diff"),
    path: expectString(r, "path", "git:diff"),
    absPath: expectString(r, "absPath", "git:diff"),
    indexStatus: expectString(r, "indexStatus", "git:diff"),
    workTreeStatus: expectString(r, "workTreeStatus", "git:diff"),
  }
}

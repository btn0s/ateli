import { RpcInvalidParamsError } from "./jsonrpc-error"
import type { ManagementPermissions } from "./management"

export function rpcObj(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) {
    return {}
  }
  if (typeof params === "object" && !Array.isArray(params)) {
    return params as Record<string, unknown>
  }
  throw new RpcInvalidParamsError("params must be an object")
}

export function rpcRequireString(
  p: Record<string, unknown>,
  k: string
): string {
  const v = p[k]
  if (typeof v === "string" && v.length > 0) {
    return v
  }
  throw new RpcInvalidParamsError(`${k} is required`)
}

/** String value (including empty). */
export function rpcRequireStringData(
  p: Record<string, unknown>,
  k: string
): string {
  const v = p[k]
  if (typeof v === "string") {
    return v
  }
  throw new RpcInvalidParamsError(`${k} must be a string`)
}

export function rpcFiniteOr(
  p: Record<string, unknown>,
  k: string,
  def: number
): number {
  const v = p[k]
  if (v === undefined) {
    return def
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return v
  }
  throw new RpcInvalidParamsError(`${k} must be a finite number`)
}

export function rpcOptionalString(
  p: Record<string, unknown>,
  k: string
): string | undefined {
  const v = p[k]
  if (v === undefined) {
    return undefined
  }
  if (typeof v === "string") {
    return v
  }
  throw new RpcInvalidParamsError(`${k} must be a string`)
}

export function rpcOptionalNumber(
  p: Record<string, unknown>,
  k: string,
  def: number
): number {
  const v = p[k]
  if (v === undefined) {
    return def
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return v
  }
  throw new RpcInvalidParamsError(`${k} must be a finite number`)
}

export function rpcRequireNumber(
  p: Record<string, unknown>,
  k: string
): number {
  const v = p[k]
  if (typeof v === "number" && Number.isFinite(v)) {
    return v
  }
  throw new RpcInvalidParamsError(`${k} must be a finite number`)
}

export function rpcOptionalBool(
  p: Record<string, unknown>,
  k: string,
  def: boolean
): boolean {
  const v = p[k]
  if (v === undefined) {
    return def
  }
  if (typeof v === "boolean") {
    return v
  }
  throw new RpcInvalidParamsError(`${k} must be a boolean`)
}

const PERM_KEYS = new Set(["renameTerminal", "renameBranch", "updatePolicy"])

function parsePermissionsBlockRpc(
  value: unknown,
  role: "user" | "agent"
): Partial<ManagementPermissions> {
  if (value === undefined) {
    return {}
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RpcInvalidParamsError(`${role} must be an object`)
  }
  const rec = value as Record<string, unknown>
  const out: Record<string, boolean> = {}
  for (const k of Object.keys(rec)) {
    if (!PERM_KEYS.has(k)) {
      throw new RpcInvalidParamsError(`unknown key in ${role}: ${k}`)
    }
    const b = rec[k]
    if (typeof b !== "boolean") {
      throw new RpcInvalidParamsError(`${role}.${k} must be a boolean`)
    }
    out[k] = b
  }
  return out
}

export function parseManagementPatchRpc(p: Record<string, unknown>): {
  user?: Partial<ManagementPermissions>
  agent?: Partial<ManagementPermissions>
} {
  const out: {
    user?: Partial<ManagementPermissions>
    agent?: Partial<ManagementPermissions>
  } = {}
  if (p["user"] !== undefined) {
    out.user = parsePermissionsBlockRpc(p["user"], "user")
  }
  if (p["agent"] !== undefined) {
    out.agent = parsePermissionsBlockRpc(p["agent"], "agent")
  }
  return out
}

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"

const ATELI_DIR = path.join(os.homedir(), ".ateli")
const MANAGEMENT_POLICY_PATH = path.join(ATELI_DIR, "management-policy.json")

export const MANAGEMENT_POLICY_VERSION = 1

export type ManagementActor = "user" | "agent"

export interface ManagementPermissions {
  renameTerminal: boolean
  renameBranch: boolean
  updatePolicy: boolean
}

export interface ManagementPolicy {
  version: typeof MANAGEMENT_POLICY_VERSION
  user: ManagementPermissions
  agent: ManagementPermissions
}

export function defaultManagementPolicy(): ManagementPolicy {
  return {
    version: MANAGEMENT_POLICY_VERSION,
    user: {
      renameTerminal: true,
      renameBranch: true,
      updatePolicy: true,
    },
    agent: {
      renameTerminal: true,
      renameBranch: true,
      updatePolicy: false,
    },
  }
}

export function loadManagementPolicy(): ManagementPolicy {
  let raw: string
  try {
    raw = fs.readFileSync(MANAGEMENT_POLICY_PATH, "utf-8")
  } catch {
    return defaultManagementPolicy()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultManagementPolicy()
  }

  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>
    if (o.version === MANAGEMENT_POLICY_VERSION) {
      const def = defaultManagementPolicy()
      const user = mergePermissions(
        (o as { user?: unknown }).user,
        def.user
      )
      const agent = mergePermissions(
        (o as { agent?: unknown }).agent,
        def.agent
      )
      if (user && agent) {
        return {
          version: MANAGEMENT_POLICY_VERSION,
          user,
          agent,
        }
      }
    }
  }

  return defaultManagementPolicy()
}

export function saveManagementPolicy(policy: ManagementPolicy): void {
  fs.mkdirSync(ATELI_DIR, { recursive: true, mode: 0o700 })
  const tmp = MANAGEMENT_POLICY_PATH + "." + crypto.randomUUID().slice(0, 8)
  fs.writeFileSync(tmp, JSON.stringify(policy, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, MANAGEMENT_POLICY_PATH)
}

export function updateManagementPolicy(
  patch: Partial<Pick<ManagementPolicy, "user" | "agent">>
): ManagementPolicy {
  const current = loadManagementPolicy()
  const next: ManagementPolicy = {
    version: MANAGEMENT_POLICY_VERSION,
    user: {
      ...current.user,
      ...(patch.user ?? {}),
    },
    agent: {
      ...current.agent,
      ...(patch.agent ?? {}),
    },
  }
  saveManagementPolicy(next)
  return next
}

export function ensureManagementAllowed(
  actor: ManagementActor,
  permission: keyof ManagementPermissions
): void {
  const policy = loadManagementPolicy()
  if (policy[actor][permission]) return
  throw new Error(`${actor} is not allowed to ${permission}`)
}

function mergePermissions(
  value: unknown,
  defaults: ManagementPermissions
): ManagementPermissions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  const o = value as Record<string, unknown>
  if (typeof o.renameTerminal !== "boolean" || typeof o.renameBranch !== "boolean") {
    return null
  }
  return {
    renameTerminal: o.renameTerminal,
    renameBranch: o.renameBranch,
    updatePolicy:
      typeof o.updatePolicy === "boolean" ? o.updatePolicy : defaults.updatePolicy,
  }
}

// apps/desktop/src/main/worktree.ts
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import os from "node:os"

const exec = promisify(execFile)

const ATELI_DIR = path.join(os.homedir(), ".ateli")
const WORKTREES_DIR = path.join(ATELI_DIR, "worktrees")
const WORKTREES_PATH = path.join(ATELI_DIR, "worktrees.json")

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  isMain: boolean
}

export const WORKTREE_METADATA_VERSION = 1

export interface WorktreeEntry {
  id: string
  branch: string
  createdAt: string
}

export interface WorktreeMetadataFile {
  version: typeof WORKTREE_METADATA_VERSION
  entries: Record<string, WorktreeEntry>
}

export interface WorktreeListItem {
  id: string
  path: string
  branch: string
  head: string
  isMain: boolean
  createdAt: string
  repoPath: string
}

function repoHash(repoPath: string): string {
  return crypto.createHash("sha256").update(repoPath).digest("hex").slice(0, 8)
}

function branchSlug(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9_-]/g, "-")
}

export function worktreePath(
  repoPath: string,
  branch: string,
): string {
  return path.join(WORKTREES_DIR, repoHash(repoPath), branchSlug(branch))
}

export async function addWorktree(opts: {
  repoPath: string
  worktreePath: string
  branch: string
  createBranch?: boolean
  startPoint?: string
}): Promise<void> {
  fs.mkdirSync(path.dirname(opts.worktreePath), { recursive: true })

  const args = ["worktree", "add"]
  if (opts.createBranch) {
    args.push("-b", opts.branch)
  }
  args.push(opts.worktreePath)
  if (!opts.createBranch) {
    args.push(opts.branch)
  }
  if (opts.startPoint && opts.createBranch) {
    args.push(opts.startPoint)
  }

  await exec("git", args, { cwd: opts.repoPath })
}

export async function listGitWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], {
    cwd: repoPath,
  })

  const worktrees: WorktreeInfo[] = []
  let current: Partial<WorktreeInfo> = {}

  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) worktrees.push(current as WorktreeInfo)
      current = { path: line.slice(9), isMain: false }
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5)
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "")
    } else if (line === "bare") {
      current.isMain = true
    } else if (line === "") {
      if (current.path) {
        // First worktree listed is the main one
        if (worktrees.length === 0 && !current.isMain) {
          current.isMain = true
        }
        worktrees.push(current as WorktreeInfo)
        current = {}
      }
    }
  }

  return worktrees
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<void> {
  await exec("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: repoPath,
  })
  // Prune any stale refs
  await exec("git", ["worktree", "prune"], { cwd: repoPath })
}

export async function renameWorktreeBranch(
  worktreePath: string,
  nextBranch: string,
): Promise<void> {
  await exec("git", ["branch", "-m", nextBranch], { cwd: worktreePath })
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await exec(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: repoPath },
  )
  return stdout.trim()
}

// --- Metadata persistence ---

function emptyMetadata(): WorktreeMetadataFile {
  return { version: WORKTREE_METADATA_VERSION, entries: {} }
}

export function loadWorktreeMetadata(): WorktreeMetadataFile {
  let raw: string
  try {
    raw = fs.readFileSync(WORKTREES_PATH, "utf-8")
  } catch {
    return emptyMetadata()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyMetadata()
  }

  if (Array.isArray(parsed)) {
    const entries: Record<string, WorktreeEntry> = {}
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).worktreePath === "string" &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).branch === "string" &&
        typeof (item as Record<string, unknown>).createdAt === "string"
      ) {
        const m = item as {
          worktreePath: string
          id: string
          branch: string
          createdAt: string
        }
        entries[m.worktreePath] = {
          id: m.id,
          branch: m.branch,
          createdAt: m.createdAt,
        }
      }
    }
    const migrated: WorktreeMetadataFile = {
      version: WORKTREE_METADATA_VERSION,
      entries,
    }
    saveWorktreeMetadata(migrated)
    return migrated
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as Record<string, unknown>).version === WORKTREE_METADATA_VERSION &&
    typeof (parsed as Record<string, unknown>).entries === "object" &&
    (parsed as Record<string, unknown>).entries !== null
  ) {
    return parsed as WorktreeMetadataFile
  }

  return emptyMetadata()
}

export function saveWorktreeMetadata(data: WorktreeMetadataFile): void {
  fs.mkdirSync(ATELI_DIR, { recursive: true, mode: 0o700 })
  const tmp = WORKTREES_PATH + "." + crypto.randomUUID().slice(0, 8)
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, WORKTREES_PATH)
}

/**
 * Canonical worktree list: git is truth. JSON enriches with our id+createdAt.
 * If a git worktree has no JSON entry, one is generated and persisted.
 * If a JSON entry's path is no longer a git worktree, it is pruned.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeListItem[]> {
  const gitList = await listGitWorktrees(repoPath)
  const metadata = loadWorktreeMetadata()
  let dirty = false

  const gitPaths = new Set(gitList.map((w) => w.path))

  // Prune JSON entries for this repo whose worktree paths no longer exist in git.
  const expectedPrefix = path.join(WORKTREES_DIR, repoHash(repoPath))
  for (const wtPath of Object.keys(metadata.entries)) {
    const belongsToRepo =
      wtPath === repoPath || wtPath.startsWith(expectedPrefix + path.sep)
    if (belongsToRepo && !gitPaths.has(wtPath)) {
      delete metadata.entries[wtPath]
      dirty = true
    }
  }

  const result: WorktreeListItem[] = []
  for (const gw of gitList) {
    let entry = metadata.entries[gw.path]
    if (!entry) {
      entry = {
        id: crypto.randomUUID().slice(0, 8),
        branch: gw.branch,
        createdAt: new Date().toISOString(),
      }
      metadata.entries[gw.path] = entry
      dirty = true
    } else if (entry.branch !== gw.branch) {
      entry.branch = gw.branch
      dirty = true
    }

    result.push({
      id: entry.id,
      path: gw.path,
      branch: gw.branch,
      head: gw.head,
      isMain: gw.isMain,
      createdAt: entry.createdAt,
      repoPath,
    })
  }

  if (dirty) saveWorktreeMetadata(metadata)

  return result
}

export async function findWorktreeById(
  repoPath: string,
  id: string,
): Promise<WorktreeListItem | null> {
  const list = await listWorktrees(repoPath)
  return list.find((w) => w.id === id) ?? null
}

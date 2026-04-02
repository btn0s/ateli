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

export interface WorktreeMetadata {
  id: string
  repoPath: string
  worktreePath: string
  branch: string
  createdAt: string
}

function repoHash(repoPath: string): string {
  return crypto.createHash("sha256").update(repoPath).digest("hex").slice(0, 8)
}

function branchSlug(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9_-]/g, "-")
}

export function worktreePath(repoPath: string, branch: string): string {
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

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await exec(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: repoPath },
  )
  return stdout.trim()
}

// --- Metadata persistence ---

export function loadWorktreeMetadata(): WorktreeMetadata[] {
  try {
    const raw = fs.readFileSync(WORKTREES_PATH, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as WorktreeMetadata[]) : []
  } catch {
    return []
  }
}

export function saveWorktreeMetadata(worktrees: WorktreeMetadata[]): void {
  fs.mkdirSync(ATELI_DIR, { recursive: true })
  const tmp = WORKTREES_PATH + "." + crypto.randomUUID().slice(0, 8)
  fs.writeFileSync(tmp, JSON.stringify(worktrees, null, 2))
  fs.renameSync(tmp, WORKTREES_PATH)
}

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs"
import path from "node:path"

const exec = promisify(execFile)

export interface GitStatusEntry {
  path: string
  absPath: string
  indexStatus: string
  workTreeStatus: string
}

export interface GitChangesEntry extends GitStatusEntry {
  added: number
  removed: number
}

export interface GitChangesOverview {
  entries: GitChangesEntry[]
  branch: string
  trunk: string | null
  error: string | null
}

export interface GitPatchRequest {
  repoPath: string
  path: string
  absPath: string
  indexStatus: string
  workTreeStatus: string
}

export interface GitPatchResult {
  patch: string | null
  error: string | null
}

function normalizeGitPath(p: string): string {
  return p.replace(/\\/g, "/")
}

function parsePorcelainLine(
  line: string,
  repoPath: string,
): GitStatusEntry | null {
  if (line.length < 4) return null
  const indexStatus = line[0] ?? " "
  const workTreeStatus = line[1] ?? " "
  if (line[2] !== " ") return null
  const rel = line.slice(3).trimEnd()
  if (!rel) return null
  const norm = normalizeGitPath(rel)
  return {
    path: norm,
    absPath: path.join(repoPath, ...norm.split("/")),
    indexStatus,
    workTreeStatus,
  }
}

/** Parse `git diff --numstat HEAD` lines into per-path added/removed. */
function parseNumstat(stdout: string): Map<string, { added: number; removed: number }> {
  const map = new Map<string, { added: number; removed: number }>()
  for (const line of stdout.split("\n")) {
    if (!line) continue
    const tab1 = line.indexOf("\t")
    if (tab1 < 0) continue
    const tab2 = line.indexOf("\t", tab1 + 1)
    if (tab2 < 0) continue
    const aStr = line.slice(0, tab1)
    const bStr = line.slice(tab1 + 1, tab2)
    const filePath = line.slice(tab2 + 1)
    const added = aStr === "-" ? 0 : Number.parseInt(aStr, 10) || 0
    const removed = bStr === "-" ? 0 : Number.parseInt(bStr, 10) || 0
    const key = normalizeGitPath(filePath)
    map.set(key, { added, removed })
    const arrow = key.indexOf(" => ")
    if (arrow >= 0) {
      const left = key.slice(0, arrow).trim()
      const right = key.slice(arrow + 4).trim()
      map.set(left, { added, removed })
      map.set(right, { added, removed })
    }
  }
  return map
}

function lineCountUntracked(absPath: string): number {
  try {
    const buf = fs.readFileSync(absPath)
    const maxScan = Math.min(buf.length, 512 * 1024)
    let n = 0
    for (let i = 0; i < maxScan; i++) {
      if (buf[i] === 0x0a) n++
    }
    if (buf.length > maxScan) {
      return n + 1
    }
    if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) {
      n++
    }
    return n
  } catch {
    return 0
  }
}

async function readBranch(repoPath: string): Promise<string> {
  const { stdout } = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoPath,
  })
  const b = stdout.trim()
  return b || "HEAD"
}

async function readTrunkName(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await exec(
      "git",
      ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"],
      { cwd: repoPath },
    )
    const s = stdout.trim()
    const slash = s.indexOf("/")
    if (slash >= 0) return s.slice(slash + 1) || null
    return s || null
  } catch {
    for (const name of ["main", "master", "trunk"]) {
      try {
        await exec("git", ["rev-parse", "--verify", `refs/heads/${name}`], {
          cwd: repoPath,
        })
        return name
      } catch {
        /* try next */
      }
    }
    return null
  }
}

async function execDiffAllowExitOne(
  args: string[],
  repoPath: string,
): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    const diffError = error as Error & {
      code?: number
      stdout?: string
    }
    if (diffError.code === 1) {
      return diffError.stdout ?? ""
    }
    throw error
  }
}

export async function getGitChangesOverview(
  repoPath: string,
): Promise<GitChangesOverview> {
  try {
    const [porcelain, numstatOut, branch, trunk] = await Promise.all([
      exec("git", ["-c", "core.quotepath=false", "status", "--porcelain"], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
      }),
      exec("git", ["-c", "core.quotepath=false", "diff", "--numstat", "HEAD"], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
      }),
      readBranch(repoPath),
      readTrunkName(repoPath),
    ])

    const stats = parseNumstat(numstatOut.stdout)
    const entries: GitChangesEntry[] = []

    for (const line of porcelain.stdout.split("\n")) {
      if (!line) continue
      const parsed = parsePorcelainLine(line, repoPath)
      if (!parsed) continue

      let added = 0
      let removed = 0
      const fromMap = stats.get(parsed.path)
      if (fromMap) {
        added = fromMap.added
        removed = fromMap.removed
      } else if (parsed.indexStatus === "?" && parsed.workTreeStatus === "?") {
        added = lineCountUntracked(parsed.absPath)
        removed = 0
      }

      entries.push({ ...parsed, added, removed })
    }

    return {
      entries,
      branch,
      trunk,
      error: null,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      entries: [],
      branch: "",
      trunk: null,
      error: message,
    }
  }
}

export async function getGitFilePatch(
  request: GitPatchRequest,
): Promise<GitPatchResult> {
  try {
    const isUntracked =
      request.indexStatus === "?" && request.workTreeStatus === "?"

    const patch = isUntracked
      ? await execDiffAllowExitOne(
          [
            "-c",
            "core.quotepath=false",
            "diff",
            "--no-index",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--",
            "/dev/null",
            request.absPath,
          ],
          request.repoPath,
        )
      : await execDiffAllowExitOne(
          [
            "-c",
            "core.quotepath=false",
            "diff",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "HEAD",
            "--",
            request.path,
          ],
          request.repoPath,
        )

    const normalizedAbsPath = normalizeGitPath(request.absPath)
    const normalizedPatch = patch
      .replaceAll(request.absPath, request.path)
      .replaceAll(normalizedAbsPath, request.path)

    return {
      patch: normalizedPatch || null,
      error: null,
    }
  } catch (error) {
    return {
      patch: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

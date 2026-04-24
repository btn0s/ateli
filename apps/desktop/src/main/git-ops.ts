import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"

const exec = promisify(execFile)

const DIFF_CONTEXT_MAX = 55_000

/** Default model when optional `ollama` CLI args are auto-filled. */
const DEFAULT_OLLAMA_MODEL = "llama3.2"

function defaultOllamaArgs(): string[] {
  const model = process.env.ATELI_OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL
  return ["run", model, "--no-stream"]
}

function looksLikeOllamaExecutable(exe: string): boolean {
  const base = path.basename(exe.replaceAll("\\", "/")).toLowerCase()
  return base === "ollama" || base === "ollama.exe"
}

/** Cursor `agent` argv + repo context can exceed OS limits — cap prompt size. */
const CURSOR_AGENT_PROMPT_MAX = 200_000

/**
 * Optional host CLI — stdin receives a text prompt; stdout = commit message.
 *
 * - By default we **try** Cursor’s `agent` CLI (`--print --mode ask`) when available.
 * - Set `ATELI_COMMIT_MSG_SKIP_CURSOR_AGENT=1` to skip that attempt.
 * - Set `ATELI_CURSOR_AGENT_BIN` to a full path to `agent` if it is not on PATH.
 * - Set `ATELI_COMMIT_MSG_CLI` + optional `ATELI_COMMIT_MSG_CLI_ARGS` to force a different generator.
 * - If the executable is `ollama`, args default to `run <ATELI_OLLAMA_MODEL|llama3.2> --no-stream`.
 */
function parseOptionalCommitMessageCli():
  | { mode: "none" }
  | { mode: "cli"; exe: string; args: string[] }
  | { mode: "error"; error: string } {
  const exe = process.env.ATELI_COMMIT_MSG_CLI?.trim()
  if (!exe) return { mode: "none" }

  const raw = process.env.ATELI_COMMIT_MSG_CLI_ARGS?.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (
        !Array.isArray(parsed) ||
        !parsed.every((x) => typeof x === "string")
      ) {
        return {
          mode: "error",
          error:
            'ATELI_COMMIT_MSG_CLI_ARGS must be a JSON array of strings, e.g. ["run","llama3.2","--no-stream"].',
        }
      }
      return { mode: "cli", exe, args: parsed as string[] }
    } catch {
      return {
        mode: "error",
        error: "ATELI_COMMIT_MSG_CLI_ARGS is not valid JSON.",
      }
    }
  }
  if (looksLikeOllamaExecutable(exe)) {
    return { mode: "cli", exe, args: defaultOllamaArgs() }
  }
  return {
    mode: "error",
    error:
      "ATELI_COMMIT_MSG_CLI is set but ATELI_COMMIT_MSG_CLI_ARGS is missing. Add a JSON argv array, or use an `ollama` binary to auto-default args.",
  }
}

function normGitPath(p: string): string {
  return p.replaceAll("\\", "/").trim()
}

async function gitDiffShortstatHead(repoPath: string): Promise<string | null> {
  return gitDiffShortstat(repoPath, [
    "-c",
    "core.quotepath=false",
    "diff",
    "--shortstat",
    "HEAD",
  ])
}

async function gitDiffShortstat(
  repoPath: string,
  args: string[]
): Promise<string | null> {
  try {
    const out = await gitStdout(repoPath, args)
    const s = out.trim()
    return s.length > 0 ? s : null
  } catch {
    return null
  }
}

async function gitChangedPathsRelative(repoPath: string): Promise<string[]> {
  const tracked = await gitStdout(repoPath, [
    "-c",
    "core.quotepath=false",
    "diff",
    "--name-only",
    "HEAD",
  ]).catch(() => "")
  const untracked = await gitStdout(repoPath, [
    "-c",
    "core.quotepath=false",
    "ls-files",
    "--others",
    "--exclude-standard",
  ]).catch(() => "")
  const set = new Set<string>()
  for (const line of tracked.split("\n")) {
    const t = normGitPath(line)
    if (t) set.add(t)
  }
  for (const line of untracked.split("\n")) {
    const t = normGitPath(line)
    if (t) set.add(t)
  }
  return [...set].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  )
}

function normalizeSelectedPaths(paths: string[] | undefined): string[] {
  const set = new Set<string>()
  for (const path of paths ?? []) {
    const normalized = normGitPath(path)
    if (normalized) set.add(normalized)
  }
  return [...set].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  )
}

function posixDirname(p: string): string {
  const n = normGitPath(p)
  const i = n.lastIndexOf("/")
  return i < 0 ? "" : n.slice(0, i)
}

/** Longest shared parent directory across changed paths (POSIX `/`). */
function longestCommonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return ""
  const norm = paths.map(normGitPath)
  const first = norm[0]!
  let end = first.length
  for (const p of norm) {
    let i = 0
    const max = Math.min(end, p.length)
    for (; i < max; i++) {
      if (p[i] !== first[i]) break
    }
    end = i
  }
  const pre = first.slice(0, end)
  const slash = pre.lastIndexOf("/")
  if (slash < 0) return ""
  return pre.slice(0, slash)
}

function extractLeadingConventionalType(subject: string): string | null {
  const m = subject.match(/^([a-z][a-z0-9]*)(?:\([^)]*\))?!?:/i)
  return m ? m[1]!.toLowerCase() : null
}

function guessConventionalType(paths: string[]): string {
  const joined = paths.join("\n").toLowerCase()
  if (paths.some((p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p))) return "test"
  if (paths.every((p) => p.endsWith(".md"))) return "docs"
  const baseNames = paths.map((p) => p.split("/").pop() ?? "")
  if (
    baseNames.some((n) =>
      /^(pnpm-lock\.yaml|yarn\.lock|package-lock\.json)$/i.test(n)
    )
  ) {
    return "chore"
  }
  if (joined.includes("changelog") || joined.includes("readme")) return "docs"
  return "chore"
}

function heuristicCommitMessage(opts: {
  paths: string[]
  shortstat: string | null
  subjects: string[]
}): string {
  const { paths, shortstat, subjects } = opts
  const statBit =
    shortstat?.replace(/^\s+/, "").replace(/\s+/g, " ") ??
    `${paths.length} file(s) changed`

  const dirPrefix = longestCommonPathPrefix(paths)
  const scopeSource = dirPrefix || posixDirname(paths[0]!) || "workspace"
  const scopeSlug =
    scopeSource
      .replaceAll("/", "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"

  const fromHistory = subjects[0]
    ? extractLeadingConventionalType(subjects[0])
    : null
  const type = fromHistory ?? guessConventionalType(paths)

  let subject = `${type}(${scopeSlug}): ${statBit}`
  const maxSubject = 72
  if (subject.length > maxSubject) {
    subject = `${subject.slice(0, maxSubject - 1)}…`
  }

  const maxList = 24
  const list = paths.slice(0, maxList)
  const more =
    paths.length > maxList ? `\n… and ${paths.length - maxList} more` : ""
  return `${subject}\n\n${list.join("\n")}${more}`
}

function normalizeCliCommitMessage(stdout: string): string {
  let s = stdout.trim()
  if (s.startsWith("```")) {
    const nl = s.indexOf("\n")
    const end = s.lastIndexOf("```")
    if (nl >= 0 && end > nl) {
      s = s.slice(nl + 1, end).trim()
    }
  }
  // Cursor agent sometimes wraps a single line in **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1")
  return s.trim()
}

function runCommitMessageCli(
  exe: string,
  args: string[],
  cwd: string,
  stdin: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGTERM")
      reject(new Error(`Commit message CLI timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const out = child.stdout
    const err = child.stderr
    const inStream = child.stdin
    if (!out || !err || !inStream) {
      clearTimeout(timer)
      reject(new Error("Could not open stdio for commit message CLI"))
      return
    }
    out.setEncoding("utf8")
    err.setEncoding("utf8")
    out.on("data", (chunk: string) => {
      stdout += chunk
    })
    err.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(e)
    })
    child.on("close", (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode })
    })
    inStream.end(stdin, "utf8")
  })
}

function buildCommitMessagePrompt(
  subjects: string[],
  diffText: string
): string {
  const styleBlock =
    subjects.length > 0
      ? subjects.map((s) => `- ${s}`).join("\n")
      : "(no prior commits on this branch)"
  let body = [
    "You are helping write a git commit message. Reply with ONLY the commit message text: optional subject line, optional blank line, optional body.",
    "Rules: imperative mood; match the tone of the recent subjects when sensible. No markdown fences, no surrounding quotes, no preamble or explanation.",
    "",
    "Recent commit subjects from this repo:",
    styleBlock,
    "",
    "Working tree changes (diff and paths):",
    diffText,
  ].join("\n")
  if (body.length > CURSOR_AGENT_PROMPT_MAX) {
    body =
      body.slice(0, CURSOR_AGENT_PROMPT_MAX) +
      "\n\n[truncated for Cursor agent argv size]"
  }
  return body
}

function resolveCursorAgentExecutable(): string | null {
  if (process.env.ATELI_COMMIT_MSG_SKIP_CURSOR_AGENT === "1") {
    return null
  }
  const envPath = process.env.ATELI_CURSOR_AGENT_BIN?.trim()
  if (envPath) {
    return existsSync(envPath) ? envPath : "agent"
  }
  const candidates =
    process.platform === "win32"
      ? [
          path.join(os.homedir(), ".local", "bin", "agent.exe"),
          path.join(
            os.homedir(),
            "AppData",
            "Local",
            "Programs",
            "cursor",
            "agent.exe"
          ),
        ]
      : [
          path.join(os.homedir(), ".local", "bin", "agent"),
          "/opt/homebrew/bin/agent",
          "/usr/local/bin/agent",
        ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return "agent"
}

async function tryCursorAgentCommitMessage(
  repoPath: string,
  prompt: string
): Promise<string | null> {
  const exe = resolveCursorAgentExecutable()
  if (!exe) return null
  const args = [
    "--print",
    "--mode",
    "ask",
    "--workspace",
    repoPath,
    "--output-format",
    "text",
    "--trust",
    prompt,
  ]
  try {
    const { stdout } = await runCommitMessageCli(
      exe,
      args,
      repoPath,
      "",
      120_000
    )
    const msg = normalizeCliCommitMessage(stdout)
    return msg.length > 0 ? msg : null
  } catch {
    return null
  }
}

async function gitStdout(
  repoPath: string,
  args: string[],
  maxBuffer = 12 * 1024 * 1024
): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd: repoPath,
    maxBuffer,
    encoding: "utf8",
  })
  return stdout
}

async function porcelainNonEmpty(repoPath: string): Promise<boolean> {
  const out = await gitStdout(repoPath, ["status", "--porcelain"])
  return out.trim().length > 0
}

/** True when `git diff --cached` is non-empty (something staged to commit). */
async function hasStagedDiff(repoPath: string): Promise<boolean> {
  try {
    await exec("git", ["diff", "--cached", "--quiet"], {
      cwd: repoPath,
      encoding: "utf8",
    })
    return false
  } catch (e) {
    return (e as { code?: number }).code === 1
  }
}

export async function gitStagePaths(
  repoPath: string,
  paths: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (paths.length === 0) return { ok: true }
  try {
    await exec("git", ["-c", "core.quotepath=false", "add", "--", ...paths], {
      cwd: repoPath,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: gitErrorMessage(e) }
  }
}

export async function gitUnstagePaths(
  repoPath: string,
  paths: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (paths.length === 0) return { ok: true }
  try {
    await exec(
      "git",
      ["-c", "core.quotepath=false", "restore", "--staged", "--", ...paths],
      { cwd: repoPath, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    )
    return { ok: true }
  } catch (e) {
    return { ok: false, error: gitErrorMessage(e) }
  }
}

async function hasHead(repoPath: string): Promise<boolean> {
  try {
    await exec("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: repoPath,
      encoding: "utf8",
    })
    return true
  } catch {
    return false
  }
}

export async function gitRecentSubjects(
  repoPath: string,
  limit: number
): Promise<{ subjects: string[]; error: string | null }> {
  try {
    const stdout = await gitStdout(repoPath, [
      "log",
      `-n`,
      String(Math.max(1, Math.min(limit, 40))),
      "--pretty=%s",
    ])
    const subjects = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
    return { subjects, error: null }
  } catch (e) {
    return {
      subjects: [],
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Staged + unstaged diff plus untracked paths for AI / review (no staging). */
export async function gitWorkingTreeDiffContext(
  repoPath: string
): Promise<{ text: string; error: string | null }> {
  try {
    const [porcelain, staged, unstaged] = await Promise.all([
      gitStdout(repoPath, [
        "-c",
        "core.quotepath=false",
        "status",
        "--porcelain",
      ]),
      gitStdout(
        repoPath,
        ["-c", "core.quotepath=false", "diff", "--cached"],
        DIFF_CONTEXT_MAX
      ).catch(() => ""),
      gitStdout(
        repoPath,
        ["-c", "core.quotepath=false", "diff"],
        DIFF_CONTEXT_MAX
      ).catch(() => ""),
    ])

    const untracked = porcelain
      .split("\n")
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.slice(3).trim())
      .filter(Boolean)

    let text = ""
    if (staged.trim()) {
      text += "### Staged\n"
      text += staged
      if (!text.endsWith("\n")) text += "\n"
    }
    if (unstaged.trim()) {
      text += "### Unstaged\n"
      text += unstaged
      if (!text.endsWith("\n")) text += "\n"
    }
    if (untracked.length > 0) {
      text += "### Untracked paths\n"
      text += untracked.join("\n")
      text += "\n"
    }

    const trimmed = text.trim()
    if (!trimmed) {
      return { text: "", error: null }
    }
    if (trimmed.length > DIFF_CONTEXT_MAX) {
      return {
        text: `${trimmed.slice(0, DIFF_CONTEXT_MAX)}\n\n[diff truncated]`,
        error: null,
      }
    }
    return { text: trimmed, error: null }
  } catch (e) {
    return {
      text: "",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

async function gitStagedDiffContext(
  repoPath: string,
  paths: string[]
): Promise<{ text: string; error: string | null }> {
  if (paths.length === 0) {
    return { text: "", error: null }
  }

  try {
    const staged = await gitStdout(
      repoPath,
      ["-c", "core.quotepath=false", "diff", "--cached", "--", ...paths],
      DIFF_CONTEXT_MAX
    ).catch(() => "")

    if (!staged.trim()) {
      return { text: "", error: null }
    }

    let text = "### Staged\n"
    text += staged
    if (!text.endsWith("\n")) text += "\n"

    const trimmed = text.trim()
    if (trimmed.length > DIFF_CONTEXT_MAX) {
      return {
        text: `${trimmed.slice(0, DIFF_CONTEXT_MAX)}\n\n[diff truncated]`,
        error: null,
      }
    }

    return { text: trimmed, error: null }
  } catch (e) {
    return {
      text: "",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function gitGenerateCommitMessage(
  repoPath: string,
  options?: { stagedPaths?: string[] }
): Promise<{ message: string | null; error: string | null }> {
  const cliOpt = parseOptionalCommitMessageCli()
  if (cliOpt.mode === "error") {
    return { message: null, error: cliOpt.error }
  }

  const stagedPaths = normalizeSelectedPaths(options?.stagedPaths)
  const usingStagedScope = stagedPaths.length > 0
  const [recentRes, diffCtx, relPaths, shortstat] = await Promise.all([
    gitRecentSubjects(repoPath, 18),
    usingStagedScope
      ? gitStagedDiffContext(repoPath, stagedPaths)
      : gitWorkingTreeDiffContext(repoPath),
    usingStagedScope
      ? Promise.resolve(stagedPaths)
      : gitChangedPathsRelative(repoPath),
    usingStagedScope
      ? gitDiffShortstat(repoPath, [
          "-c",
          "core.quotepath=false",
          "diff",
          "--cached",
          "--shortstat",
          "--",
          ...stagedPaths,
        ])
      : gitDiffShortstatHead(repoPath),
  ])

  if (recentRes.error) {
    return { message: null, error: recentRes.error }
  }
  if (diffCtx.error) {
    return { message: null, error: diffCtx.error }
  }
  if (!diffCtx.text.trim()) {
    return {
      message: null,
      error: "No staged, unstaged, or untracked changes to summarize.",
    }
  }
  if (relPaths.length === 0) {
    return {
      message: null,
      error: "No changed paths found.",
    }
  }

  const subjects = recentRes.subjects
  const promptBody = buildCommitMessagePrompt(subjects, diffCtx.text)

  if (cliOpt.mode !== "cli") {
    const fromAgent = await tryCursorAgentCommitMessage(repoPath, promptBody)
    if (fromAgent) {
      return { message: fromAgent, error: null }
    }
  }

  if (cliOpt.mode === "cli") {
    try {
      const { stdout, stderr, exitCode } = await runCommitMessageCli(
        cliOpt.exe,
        cliOpt.args,
        repoPath,
        promptBody,
        180_000
      )

      const message = normalizeCliCommitMessage(stdout)
      if (message) {
        return { message, error: null }
      }

      const parts = [
        exitCode !== 0 && exitCode !== null ? `exit ${exitCode}` : "",
        stderr.trim(),
      ].filter(Boolean)
      const errHint = parts.join(" — ") || "(no stderr)"
      return {
        message: null,
        error: `Empty message from ${cliOpt.exe}. ${errHint.slice(0, 600)}`,
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { stderr?: string }
      if (err.code === "ENOENT") {
        return {
          message: null,
          error: `Could not run "${cliOpt.exe}". Fix ATELI_COMMIT_MSG_CLI or install that binary.`,
        }
      }
      const combined = [err.stderr, err.message].filter(Boolean).join("\n")
      return {
        message: null,
        error: combined.trim().slice(0, 800) || String(e),
      }
    }
  }

  return {
    message: heuristicCommitMessage({
      paths: relPaths,
      shortstat,
      subjects,
    }),
    error: null,
  }
}

function gitErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "stderr" in e) {
    const s = (e as { stderr?: Buffer | string }).stderr
    const t = typeof s === "string" ? s : s?.toString("utf8")
    if (t?.trim()) return t.trim()
  }
  return e instanceof Error ? e.message : String(e)
}

export async function gitStageAllCommit(
  repoPath: string,
  message: string,
  options: { amend?: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = message.trim()
  if (!trimmed) {
    return { ok: false, error: "Commit message is empty." }
  }

  const amend = Boolean(options.amend)
  const wtDirty = await porcelainNonEmpty(repoPath)

  try {
    if (amend && !(await hasHead(repoPath))) {
      return {
        ok: false,
        error: "Cannot amend: repository has no commits yet.",
      }
    }

    const staged = await hasStagedDiff(repoPath)

    if (!amend) {
      if (!staged) {
        return {
          ok: false,
          error: "No staged changes. Stage files before committing.",
        }
      }
    } else if (!staged && wtDirty) {
      return {
        ok: false,
        error:
          "Stage the changes to include in the amended commit, or discard unstaged edits first.",
      }
    }

    const msgPath = path.join(
      os.tmpdir(),
      `ateli-commit-${crypto.randomUUID()}.txt`
    )
    await fs.writeFile(msgPath, trimmed, "utf8")
    try {
      const args = amend
        ? ["commit", "--amend", "-F", msgPath]
        : ["commit", "-F", msgPath]
      await exec("git", args, { cwd: repoPath, encoding: "utf8" })
    } finally {
      await fs.unlink(msgPath).catch(() => {})
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: gitErrorMessage(e) }
  }
}

export async function gitPush(
  repoPath: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await exec("git", ["push"], {
      cwd: repoPath,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: gitErrorMessage(e) }
  }
}

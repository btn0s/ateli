import fs from "node:fs"
import path from "node:path"
import ignore from "ignore"

const ALWAYS_IGNORE = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "out",
  ".turbo",
  ".DS_Store",
])

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

export function findGitRoot(startPath: string): string | null {
  let dir = path.resolve(startPath)
  for (;;) {
    try {
      if (fs.existsSync(path.join(dir, ".git"))) return dir
    } catch {
      /* ignore */
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/")
}

type IgnoreLayer = { baseDir: string; ig: ReturnType<typeof ignore> }

/** Directories from repo root down to and including `targetDir` (must be inside repo). */
function dirsFromRepoTo(repoRoot: string, targetDir: string): string[] {
  const root = path.resolve(repoRoot)
  const target = path.resolve(targetDir)
  const out: string[] = [root]
  if (target === root) return out
  const rel = path.relative(root, target)
  if (rel.startsWith("..")) return [target]
  let cur = root
  for (const seg of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, seg)
    out.push(cur)
  }
  return out
}

function buildIgnoreLayers(repoRoot: string, listingDir: string): IgnoreLayer[] {
  const root = path.resolve(repoRoot)
  const dirs = dirsFromRepoTo(root, listingDir)
  const layers: IgnoreLayer[] = []
  let excludeContent: string | null = null
  try {
    const ex = path.join(root, ".git", "info", "exclude")
    if (fs.existsSync(ex)) {
      excludeContent = fs.readFileSync(ex, "utf8")
    }
  } catch {
    excludeContent = null
  }

  for (const d of dirs) {
    const gi = path.join(d, ".gitignore")
    const hasGi = fs.existsSync(gi)
    if (d === root) {
      if (!hasGi && !excludeContent) continue
      const ig = ignore()
      if (hasGi) ig.add(fs.readFileSync(gi, "utf8"))
      if (excludeContent) ig.add(excludeContent)
      layers.push({ baseDir: d, ig })
      continue
    }
    if (!hasGi) continue
    const ig = ignore()
    ig.add(fs.readFileSync(gi, "utf8"))
    layers.push({ baseDir: d, ig })
  }
  return layers
}

function entryIgnoredByLayers(
  layers: IgnoreLayer[],
  absPath: string,
  isDir: boolean,
): boolean {
  let ignored = false
  for (const { baseDir, ig } of layers) {
    const rel = toPosix(path.relative(baseDir, absPath))
    if (rel.startsWith("..")) continue

    const candidates = isDir ? [`${rel}/`, rel] : [rel]
    for (const p of candidates) {
      const tr = ig.test(p)
      if (tr.unignored) ignored = false
      else if (tr.ignored) ignored = true
    }
  }
  return ignored
}

export async function readProjectDirectory(
  dirPath: string,
): Promise<{ entries: DirEntry[]; repoRoot: string | null }> {
  const resolvedDir = path.resolve(dirPath)
  const repoRoot = findGitRoot(resolvedDir)
  const layers =
    repoRoot ? buildIgnoreLayers(repoRoot, resolvedDir) : []

  const ents = await fs.promises.readdir(resolvedDir, { withFileTypes: true })
  const out: DirEntry[] = []

  for (const e of ents) {
    if (ALWAYS_IGNORE.has(e.name)) continue
    const full = path.join(resolvedDir, e.name)
    const isDir = e.isDirectory()
    if (layers.length > 0 && entryIgnoredByLayers(layers, full, isDir)) {
      continue
    }
    out.push({
      name: e.name,
      path: full,
      isDirectory: isDir,
    })
  }

  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })

  return { entries: out, repoRoot }
}

type WatchState = {
  watcher: fs.FSWatcher
  timer: ReturnType<typeof setTimeout> | null
}

const watchStates = new Map<string, WatchState>()

export function startFsWatch(
  key: string,
  rootPath: string,
  onChange: () => void,
): () => void {
  stopFsWatch(key)
  const root = path.resolve(rootPath)
  const state: WatchState = {
    watcher: undefined as unknown as fs.FSWatcher,
    timer: null,
  }

  const schedule = () => {
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = null
      onChange()
    }, 250)
  }

  try {
    state.watcher = fs.watch(root, { recursive: true }, schedule)
  } catch {
    state.watcher = fs.watch(root, schedule)
  }

  state.watcher.on("error", () => {})

  watchStates.set(key, state)

  return () => {
    stopFsWatch(key)
  }
}

export function stopFsWatch(key: string): void {
  const state = watchStates.get(key)
  if (!state) return
  watchStates.delete(key)
  if (state.timer) clearTimeout(state.timer)
  state.watcher.close()
}

export function fsWatchKey(windowId: number, rootPath: string): string {
  return `${windowId}\0${path.resolve(rootPath)}`
}

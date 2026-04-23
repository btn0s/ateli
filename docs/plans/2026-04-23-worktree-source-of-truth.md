# Plan: Unify Worktree Source of Truth

> Finding #3 from `docs/architecture-review-2026-04-22.md`.
> Status: **locked — ready for Codex.**

**Goal:** Stop having two disagreeing lists of worktrees. Make `git worktree list` the source of physical truth; demote `~/.ateli/worktrees.json` to a keyed side-index for app-specific metadata (our UUID, createdAt). Both IPC `worktree:list` and RPC `worktree.list` return the merged shape.

**Why this first after #2:** finding #4 (renderer state) gets cleaner once worktree reads have a single answer; current divergence (renderer uses git, RPC uses JSON) means UI and agents can legitimately see different worktrees.

**Decisions baked in:**
- **Git is physical truth.** If git doesn't know a worktree, it doesn't exist; JSON entry gets pruned silently.
- **JSON is keyed by worktree path.** Shape: `{ version: 1, entries: Record<path, { id, branch, createdAt }> }`. Old array shape migrates on load.
- **Auto-generate metadata for git-only worktrees.** CLI-created worktrees appear in the list with a freshly-minted `id` and `createdAt`, written back to JSON.
- **No advisory file locking.** Within main process, synchronous reads/writes are effectively atomic (Node single thread). Cross-process contention (external CLI via RPC running at the same time as the UI handler) still runs in the same main process via the RPC socket, so it's the same lock. Revisit only if this assumption breaks.
- **Add IPC `worktree:remove`.** Currently RPC-only. Renderer can't remove worktrees from the UI today; trivial to fix alongside this.

---

## Tasks

### 1. New JSON schema + migration

**File:** `apps/desktop/src/main/worktree.ts`

Replace the array-based load/save with a keyed index. Migrate old shape.

```ts
export const WORKTREE_METADATA_VERSION = 1

export interface WorktreeEntry {
  id: string
  branch: string
  createdAt: string
}

export interface WorktreeMetadataFile {
  version: typeof WORKTREE_METADATA_VERSION
  entries: Record<string, WorktreeEntry>  // keyed by worktree path
}

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

  // Migrate old array shape.
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
        const m = item as { worktreePath: string; id: string; branch: string; createdAt: string }
        entries[m.worktreePath] = { id: m.id, branch: m.branch, createdAt: m.createdAt }
      }
    }
    const migrated: WorktreeMetadataFile = { version: WORKTREE_METADATA_VERSION, entries }
    saveWorktreeMetadata(migrated)
    return migrated
  }

  // Validate versioned shape.
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
```

Remove the old `WorktreeMetadata` interface and any external references. Callers move to the new `WorktreeEntry` + path-keyed shape.

Commit: `refactor(desktop): worktree metadata schema v1 (path-keyed, versioned)`.

---

### 2. Unified `listWorktrees`: git-as-truth, JSON as side-index

**File:** `apps/desktop/src/main/worktree.ts`

Add a new exported function that's the single read path for both IPC and RPC:

```ts
/**
 * Canonical worktree list: git is truth. JSON enriches with our id+createdAt.
 * If a git worktree has no JSON entry, one is generated and persisted.
 * If a JSON entry's path is no longer a git worktree, it is pruned.
 */
export interface WorktreeListItem {
  id: string
  path: string
  branch: string
  head: string
  isMain: boolean
  createdAt: string
  repoPath: string
}

export async function listWorktrees(repoPath: string): Promise<WorktreeListItem[]> {
  const gitList = await listGitWorktrees(repoPath)
  const metadata = loadWorktreeMetadata()
  let dirty = false

  const gitPaths = new Set(gitList.map((w) => w.path))

  // Prune JSON entries for this repo whose worktree paths no longer exist in git.
  // Only prune entries that look like they belong to this repo (path under repoPath or under the shared WORKTREES_DIR/<hash>/).
  const expectedPrefix = path.join(WORKTREES_DIR, repoHash(repoPath))
  for (const wtPath of Object.keys(metadata.entries)) {
    const belongsToRepo = wtPath === repoPath || wtPath.startsWith(expectedPrefix + path.sep)
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
      // Git reports the current branch; update our record.
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
```

Also add a helper for finding one by id (RPC `worktree.remove` takes an id):

```ts
export async function findWorktreeById(
  repoPath: string,
  id: string,
): Promise<WorktreeListItem | null> {
  const list = await listWorktrees(repoPath)
  return list.find((w) => w.id === id) ?? null
}
```

Commit: `feat(desktop): unified listWorktrees with git as source of truth`.

---

### 3. Update IPC handlers in `main/index.ts`

**File:** `apps/desktop/src/main/index.ts`

Swap `worktree:list` to use `listWorktrees`:

```ts
ipcMain.handle(
  "worktree:list",
  async (_event, { repoPath }: { repoPath: string }) => {
    return listWorktrees(repoPath)
  },
)
```

Update `worktree:create` to save into the new schema (path-keyed) and to hand back the canonical list item. The unified `listWorktrees` will observe the new entry on the next read, but the create handler still needs to persist the id+createdAt itself (since it picks the id):

```ts
ipcMain.handle(
  "worktree:create",
  async (_event, { repoPath, branch }: { repoPath: string; branch: string }) => {
    const wtPath = worktreePath(repoPath, branch)
    await addWorktree({
      repoPath,
      worktreePath: wtPath,
      branch,
      createBranch: true,
    })

    const id = crypto.randomUUID().slice(0, 8)
    const createdAt = new Date().toISOString()

    const metadata = loadWorktreeMetadata()
    metadata.entries[wtPath] = { id, branch, createdAt }
    saveWorktreeMetadata(metadata)

    broadcast("worktree.created", { id, path: wtPath, branch })
    return { id, path: wtPath, branch }
  },
)
```

**Add a new `worktree:remove` IPC handler** mirroring the RPC behavior (kill terminals rooted in that worktree, `git worktree remove`, drop JSON entry):

```ts
ipcMain.handle(
  "worktree:remove",
  async (_event, { repoPath, id }: { repoPath: string; id: string }) => {
    const entry = await findWorktreeById(repoPath, id)
    if (!entry) throw new Error(`Worktree not found: ${id}`)

    // Kill terminals whose cwd is inside this worktree.
    for (const session of ptyManager.listSessions()) {
      if (session.cwd.startsWith(entry.path)) {
        await ptyManager.killSession(session.id)
      }
    }

    try {
      await removeGitWorktree(repoPath, entry.path)
    } catch {
      // Already removed on disk.
    }

    const metadata = loadWorktreeMetadata()
    delete metadata.entries[entry.path]
    saveWorktreeMetadata(metadata)

    broadcast("worktree.removed", { id, path: entry.path, branch: entry.branch })
    return { ok: true }
  },
)
```

Imports: add `listWorktrees`, `findWorktreeById` from `./worktree` at the top.

Commit: `feat(desktop): IPC worktree:remove; worktree:list reads git`.

---

### 4. Update RPC handlers in `main/rpc.ts`

**File:** `apps/desktop/src/main/rpc.ts`

Swap `worktree.list` to use `listWorktrees`. This requires a `repoPath` param; if the caller omits it, fall back to walking all repos known to the JSON (by unique prefixes), or require it. Simplest: require `repoPath` in the RPC.

```ts
methods.set("worktree.list", async (params) => {
  const repoPath = params.repoPath as string | undefined
  if (!repoPath) throw new Error("repoPath is required")
  const worktrees = await listWorktrees(repoPath)
  return { worktrees }
})
```

Update `worktree.create` to use new metadata shape:

```ts
methods.set("worktree.create", async (params) => {
  const repoPath = params.repoPath as string
  if (!repoPath) throw new Error("repoPath is required")
  const branch = params.branch as string
  if (!branch) throw new Error("branch is required")
  const createBranch = params.createBranch as boolean ?? true
  const startPoint = params.startPoint as string | undefined

  const wtPath = worktreePath(repoPath, branch)
  await addWorktree({
    repoPath,
    worktreePath: wtPath,
    branch,
    createBranch,
    startPoint,
  })

  const id = crypto.randomUUID().slice(0, 8)
  const createdAt = new Date().toISOString()
  const metadata = loadWorktreeMetadata()
  metadata.entries[wtPath] = { id, branch, createdAt }
  saveWorktreeMetadata(metadata)

  broadcast("worktree.created", { id, path: wtPath, branch })
  return { id, path: wtPath, branch }
})
```

Update `worktree.remove` to use `findWorktreeById` and new schema:

```ts
methods.set("worktree.remove", async (params) => {
  const repoPath = params.repoPath as string
  if (!repoPath) throw new Error("repoPath is required")
  const id = params.id as string
  if (!id) throw new Error("id is required")

  const entry = await findWorktreeById(repoPath, id)
  if (!entry) throw new Error(`Worktree not found: ${id}`)

  for (const session of ptyManager.listSessions()) {
    if (session.cwd.startsWith(entry.path)) {
      await ptyManager.killSession(session.id)
    }
  }

  try {
    await removeWorktree(entry.repoPath, entry.path)
  } catch {
    // Already removed
  }

  const metadata = loadWorktreeMetadata()
  delete metadata.entries[entry.path]
  saveWorktreeMetadata(metadata)

  broadcast("worktree.removed", { id, path: entry.path, branch: entry.branch })
  return { ok: true }
})
```

Note: `worktree.remove` now also requires `repoPath`. That's a breaking change for any external CLI consumer. Given no known external consumers yet, this is acceptable; document it in the commit message.

Update imports at the top of `rpc.ts`: replace `loadWorktreeMetadata, saveWorktreeMetadata, type WorktreeMetadata` with `listWorktrees, findWorktreeById, loadWorktreeMetadata, saveWorktreeMetadata` (the metadata fns still used for the create path).

Commit: `refactor(desktop): RPC worktree.list/remove use unified list; require repoPath on remove`.

---

### 5. Expose `worktree.remove` in preload

**File:** `apps/desktop/src/preload/index.ts`

```ts
worktree: {
  list: (repoPath: string) =>
    ipcRenderer.invoke("worktree:list", { repoPath }) as Promise<
      {
        id: string
        path: string
        branch: string
        head: string
        isMain: boolean
        createdAt: string
        repoPath: string
      }[]
    >,
  create: (repoPath: string, branch: string) =>
    ipcRenderer.invoke("worktree:create", { repoPath, branch }) as Promise<{
      id: string
      path: string
      branch: string
    }>,
  remove: (repoPath: string, id: string) =>
    ipcRenderer.invoke("worktree:remove", { repoPath, id }) as Promise<{ ok: true }>,
},
```

The `list` return shape is now wider (was `{ path, branch, head, isMain }`, now includes `id, createdAt, repoPath`). Existing renderer consumers of `useWorktrees()` work unchanged because they destructure by name; the wider shape is additive.

Commit: `feat(desktop): expose worktree.remove over preload`.

---

## Acceptance criteria

1. `pnpm --filter desktop build` — green.
2. Canvas and sidebar worktree lists display correctly (same as before — renderer was already reading git via IPC).
3. `worktree.list` RPC returns the same shape as before, enriched with `createdAt`, `repoPath`, canonical `id`. No dangling JSON-only entries.
4. Open `~/.ateli/worktrees.json` after first run: top-level has `{ "version": 1, "entries": { ... } }`. Entries are keyed by worktree absolute path.
5. Create a worktree via the UI → appears in git, JSON has a new entry at the right path, broadcast fires.
6. Manually `git worktree remove` a worktree, then open the app → that path no longer appears in the list, JSON entry silently pruned.
7. Manually edit `~/.ateli/worktrees.json` to add an entry whose path doesn't exist in git → on next list, entry is pruned.
8. `grep -r "worktreePath.*repoPath" apps/desktop/src/main/worktree.ts` returns no lines (old `WorktreeMetadata` shape gone).

## Guardrails for Codex

- **Do not** introduce new dependencies (no `proper-lockfile`, no `zod`, validate inline).
- **Do not** change sidecar code.
- **Do not** touch renderer files beyond what preload typing requires. `worktree-index-context.tsx` does not need to change — the wider list shape is additive.
- **Do not** change `worktree.created` / `worktree.removed` broadcast payloads.
- **Preserve** the `removeWorktree` / `addWorktree` exec-git helpers as-is.
- **Preserve** the custom delete bypass path… wait, no, that was removed in #6. Just preserve the behavior where removing a worktree also kills its terminals.
- **Commit** in the 5 logical chunks above.

## Handoff command

```bash
node "/Users/btn0s/.claude/plugins/cache/openai-codex/codex/1.0.2/scripts/codex-companion.mjs" \
  task --background --write --effort high \
  "$(cat docs/plans/2026-04-23-worktree-source-of-truth.md)"
```

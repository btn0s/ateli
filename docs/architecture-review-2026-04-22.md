# Architecture Review — 2026-04-22

Adversarial review of the ateli desktop architecture, run by Codex at `effort=high`. This doc is the durable tracker: findings, ranked priority, status, and pointers to per-finding plans.

**Codex session:** `019db842-7c4a-7133-b547-6af44ac10ea9`
Resume: `codex resume 019db842-7c4a-7133-b547-6af44ac10ea9`

---

## Status tracker

| # | Finding                                       | Severity             | Priority | Status      | Plan |
| - | --------------------------------------------- | -------------------- | -------- | ----------- | ---- |
| 6 | Terminals as tldraw shapes (session-as-object)| change-required      | **1**    | **review pending user** — 4 commits on main, build green | [plans/2026-04-22-session-as-domain-object.md](./plans/2026-04-22-session-as-domain-object.md) |
| 2 | RPC / sidecar auth bugs                       | block-ship (bug)     | **2**    | **review pending user** — 5 commits, build green | [plans/2026-04-23-security-hardening.md](./plans/2026-04-23-security-hardening.md) |
| 3 | Two sources of truth for worktrees            | change-required      | **3**    | **review pending user** — 5 commits, build green | [plans/2026-04-23-worktree-source-of-truth.md](./plans/2026-04-23-worktree-source-of-truth.md) |
| 1 | Sidecar supervision + multi-window routing    | change-required      | later    | not started | —    |
| 5 | PTY ring buffer / session eviction            | change-required      | later    | not started | —    |
| 8 | Product thesis: canvas vs sidebar roles       | design               | ongoing  | open Q      | —    |
| 4 | Centralized renderer state                    | change-required      | downstream of #6 | not started | — |
| 7 | Side-effect tool registry                     | acceptable w/ caveat | defer    | —           | —    |
| 9 | Packaging / distribution                      | block-ship (if shipping) | when shipping | — | — |
| 10| Renderer sandbox, CSP, unwired `rpc:get-context` | block-ship / bug  | **2**    | **review pending user** — sandbox restored via CJS preload | [plans/2026-04-23-security-hardening.md](./plans/2026-04-23-security-hardening.md) · [plans/2026-04-23-restore-sandbox-via-cjs-preload.md](./plans/2026-04-23-restore-sandbox-via-cjs-preload.md) |

---

## Top 3 — start here

### 1. Session-as-domain-object (finding #6)
**Why first:** every other finding's complexity depends on this. Canvas/sidebar duplication (#6), renderer state shape (#4), persistence split between tldraw shape props and `sessions.json` (#6), and the `terminalDeleteBypassIds` global Set workaround ([terminal-shape.tsx:22](../apps/desktop/src/renderer/shapes/terminal-shape.tsx)) all dissolve once a terminal session is a domain object with pluggable views.

**Shape of the change:** sessions live in a single store (main process + renderer mirror); tldraw shape and sidebar tab are *views* that reference a session by id. Deleting a view ≠ killing the process. Killing a session is an explicit action.

### 2. Security bugs (findings #2 + #10)
Not the full "RPC trust model" argument — just the real bugs:
- `sidecar.ping` returns the token ([sidecar/server.ts:218](../apps/desktop/src/main/sidecar/server.ts))
- Sidecar control socket is unauthenticated ([sidecar/server.ts:142](../apps/desktop/src/main/sidecar/server.ts))
- Token file + socket dir need `0600` / `0700`
- `rpc:get-context` is sent by main but has no renderer receiver ([preload/index.ts:76](../apps/desktop/src/preload/index.ts))
- `sandbox: false` + no CSP ([main/index.ts:37](../apps/desktop/src/main/index.ts), [index.html:3](../apps/desktop/src/renderer/index.html))

**Why:** these are bugs, not threat-model debates. Cheap to fix, high signal.

### 3. Worktree source-of-truth (finding #3)
Renderer `worktree:list` uses `git worktree list`; RPC `worktree.list` returns the JSON metadata. They'll diverge. Pick git as the read path, demote the JSON to recoverable app-state metadata with schema version + validation.

---

## Deferred / context-dependent

- **#1 sidecar supervision + multi-window:** locking + crash recovery + routing. Do after #6, when session ownership is clean.
- **#5 ring buffer:** the real fix is session eviction, not the 8MB constant. Comes for free-ish with #6.
- **#4 renderer state:** answers itself after #6. If contexts still hurt then, revisit.
- **#7 tool registry:** Codex called it "acceptable with caveat." Revisit when/if extensions land.
- **#8 product thesis:** not a refactor — a design question. My read: canvas = arranging sessions into workspaces, sidebar = operating on the active one. Two views, one domain. Keep in mind while doing #6.
- **#9 packaging:** only matters if shipping to users.

---

## My take (Brendan) vs Codex

Codex overweighted the RPC trust model as a *model* issue — any tool with shell access in `$HOME` is ambient-authority by definition. The bugs are real; the framing isn't. Same with "no centralized state management": Codex called it accidental, but React + contexts is fine *until* we need session-as-object, at which point the store question answers itself.

The most load-bearing finding is **#6**. Everything else is either a discrete fix (security bugs, worktree truth) or a future-you problem (packaging, multi-window).

---

## Workflow: plan → Codex → review

For each finding:

1. **Plan** (via `superpowers:writing-plans`, written into `docs/plans/YYYY-MM-DD-<slug>.md`):
   - Context + problem
   - Files to touch (exact paths)
   - Concrete steps with acceptance criteria (tests pass, typecheck clean, observable behaviors)
   - Guardrails (what *not* to touch, invariants to preserve)

2. **Hand off to Codex:**
   ```bash
   node "/Users/btn0s/.claude/plugins/cache/openai-codex/codex/1.0.2/scripts/codex-companion.mjs" \
     task --background --write --effort high "$(cat docs/plans/<slug>.md)"
   ```
   Check with `/codex:status <job-id>`, fetch with `/codex:result <job-id>`.

3. **Review:**
   - Inspect the diff directly first
   - `/ultrareview` for a multi-agent review before merge
   - Run typecheck + tests locally

4. **Merge, update this tracker's Status column, move on.**

Don't trust Codex's "I'm done" — always verify the diff.

---

## Raw Codex output

Full adversarial review verbatim below. Keep for context; the tracker above is the working surface.

---

**1. Three-Process Model: change-required.**
The sidecar split is defensible only if the sidecar is treated as a real supervised service. Right now it is an orphaned subprocess with weak discovery. Main spawns it detached and unref'd in `apps/desktop/src/main/sidecar/client.ts:82`, the sidecar writes a PID file before listening in `apps/desktop/src/main/sidecar/server.ts:92`, and the client trusts `process.kill(pid, 0)` plus a token comparison in `apps/desktop/src/main/sidecar/client.ts:64`. There is no lock. Two app instances can race, unlink the same fixed socket, overwrite `pty-sidecar.pid`, and leave one sidecar alive but undiscoverable. Main crash leaves PTYs alive, but RPC and renderer delivery die. Sidecar crash leaves stale `PtyManager.sessions` until later calls fail; there is no renderer-wide "backend died" state. Multi-window is not supported: terminal data, exits, and broadcasts all pick `BrowserWindow.getAllWindows()[0]` in `apps/desktop/src/main/pty.ts:177`, `apps/desktop/src/main/pty.ts:205`, and `apps/desktop/src/main/index.ts:230`.

**2. RPC Socket Trust Model: block-ship.**
I would not ship this trust model. The public RPC token is written to `~/.ateli/server.token` with default file permissions in `apps/desktop/src/main/rpc.ts:57`, auth is "first line equals token" in `apps/desktop/src/main/rpc.ts:295`, and there is no `chmod`, owner check, peer credential check, or directory hardening. Worse: the sidecar control socket is unauthenticated. `handleControlClient` accepts any local socket client in `apps/desktop/src/main/sidecar/server.ts:142`, dispatches methods immediately in `apps/desktop/src/main/sidecar/server.ts:167`, and `sidecar.ping` returns the token in `apps/desktop/src/main/sidecar/server.ts:218`. Any process that can reach `~/.ateli/pty-sidecar.sock` can create PTYs, read buffers, kill sessions, and potentially recover the sidecar token. Compared with stdio MCP, this creates ambient authority. Compared with DBus or a LaunchAgent-style helper, it lacks OS identity and single-instance semantics. Compared with localhost HTTP plus OAuth, it lacks user consent. The threat is not "remote internet attacker" first; it is malicious same-user tools, compromised renderer, PATH hijack around `execFile("git", ...)` in `apps/desktop/src/main/worktree.ts:63`, and local socket/file access becoming full shell access.

**3. Worktree Metadata JSON: change-required.**
Atomic rename prevents torn writes, not lost updates. Both UI and RPC do `load -> push -> save` without locking in `apps/desktop/src/main/index.ts:168` and `apps/desktop/src/main/rpc.ts:230`. Concurrent creates can drop one metadata entry. The persistence has no schema version or validation: arbitrary parsed arrays become `WorktreeMetadata[]` in `apps/desktop/src/main/worktree.ts:121`. There are also two truths: renderer `worktree:list` uses `git worktree list` in `apps/desktop/src/main/index.ts:134`, while RPC `worktree.list` returns JSON metadata in `apps/desktop/src/main/rpc.ts:238`. Correct primitive: SQLite with transactions if this becomes queryable shared app state, or one file per worktree plus an advisory lock if you want simple filesystem persistence. Git should be reconciled as source of physical truth; metadata should be recoverable, versioned app state.

**4. Renderer State: change-required.**
This is accidental state management, not a principled "small app" choice. Folder path lives in localStorage in `apps/desktop/src/renderer/app.tsx:10`, canvas state lives in tldraw localStorage via `persistenceKey` in `apps/desktop/src/renderer/components/canvas.tsx:524`, worktrees are a Context that refetches on notification in `apps/desktop/src/renderer/contexts/worktree-index-context.tsx:40`, and sidebar terminals are component-local state in `apps/desktop/src/renderer/components/file-tree.tsx:281`. The first feature request that breaks this is multi-window. The second is undo, because tldraw shape history is not transactionally coupled to PTY lifecycle. The third is offline/replay, because broadcasts only trigger refetches and there is no durable event log.

**5. 8MB PTY Ring Buffer: change-required.**
The buffer is sized like scrollback, but the product treats it as durable session memory. It is fixed at 8MB in `apps/desktop/src/main/sidecar/protocol.ts:7`, allocated per session in `apps/desktop/src/main/sidecar/server.ts:276`, and old data is silently overwritten in `apps/desktop/src/main/sidecar/ring-buffer.ts:3`. With no session eviction, 50 sessions is 400MB before xterm, PTYs, and reconnect queues. Reconnect is worse: `session.reconnectQueue = []` in `apps/desktop/src/main/sidecar/server.ts:390` can grow unbounded if a reconnecting renderer never attaches. A chatty build will wrap; if it wraps mid-UTF-8 or mid-ANSI escape, `snapshot.toString("utf-8")` in `apps/desktop/src/main/sidecar/server.ts:457` can produce broken terminal state. Use disk-backed bounded logs plus terminal-state serialization, or admit this is lossy scrollback and design UX around loss.

**6. Terminals As Tldraw Shapes: change-required.**
The shape currently owns too much lifecycle. Deleting a shape kills the session after a custom confirmation path in `apps/desktop/src/renderer/components/canvas.tsx:138`, and programmatic deletes bypass that with a global Set in `apps/desktop/src/renderer/shapes/terminal-shape.tsx:22`. That is a smell because "view deleted" and "process killed" are different domain actions. Durability is split: terminal IDs are persisted inside tldraw shape props in `apps/desktop/src/renderer/shapes/terminal-shape.tsx:301`, while PTY metadata is persisted in `sessions.json` in `apps/desktop/src/main/pty.ts:250`. The sidebar then implements another terminal lifecycle: create on mount, dispose on unmount in `apps/desktop/src/renderer/components/sidebar-embedded-terminal.tsx:108`. The abstraction should be "terminal session as domain object, multiple views attach." Canvas shapes should reference sessions, not be sessions.

**7. Side-Effect Tool Registry: acceptable-with-caveat.**
Fine for two built-in buttons, not a plugin architecture. `registerAction` just pushes into a module array in `apps/desktop/src/renderer/lib/tool-registry.ts:17`, and actions are registered by importing `default-actions` for side effects in `apps/desktop/src/renderer/components/canvas.tsx:26`. There is no duplicate guard, capability declaration, ordering contract, unload, versioning, or dependency model. This becomes a bug magnet the moment actions come from extensions, HMR, or conditionally loaded modules.

**8. Product Thesis: change-required.**
The canvas is not yet proving itself as the primary UI for agent development. RPC terminal creation broadcasts `terminal.created`, and the renderer blindly drops a terminal shape at the viewport center in `apps/desktop/src/renderer/components/canvas.tsx:484`. Worktree creation also auto-adds a terminal shape at center in `apps/desktop/src/renderer/components/canvas.tsx:487`. With 12 terminals across 4 worktrees, this becomes spatial clutter, not orchestration. The sidebar is already the more operational UI: worktrees, files, changes, and tabbed terminals are in `apps/desktop/src/renderer/components/file-tree.tsx:502`. My read: canvas is valuable for context, diagrams, and task grouping, but the real primary UI for active agent work should be a dense worktree/session/task surface. Otherwise the canvas is an attractive demo that fights the workflow.

**9. Packaging And Deploy: block-ship.**
There is no credible desktop shipping story on disk. Root scripts only run Turbo build/dev/typecheck in `package.json:5`, desktop build is only `electron-vite build` in `apps/desktop/package.json:10`, and the only native-module story is `electron-rebuild -f -w node-pty` on postinstall in `apps/desktop/package.json:15`. I found no Forge, Builder, signing, notarization, auto-update, entitlements, `asarUnpack`, or native prebuild configuration. `node-pty` plus a sidecar entrypoint requires explicit packaging treatment; relying on user-machine rebuilds is not a product distribution plan.

**10. Missing Flags: block-ship / change-required.**
The renderer security boundary is too broad for an IDE-like app. The BrowserWindow disables sandbox in `apps/desktop/src/main/index.ts:37`, there is no CSP in `apps/desktop/src/renderer/index.html:3`, and preload exposes arbitrary filesystem/git/open-path operations to renderer code in `apps/desktop/src/preload/index.ts:61`. Also, the flagship "spatial context" method is not wired: RPC sends `rpc:get-context` in `apps/desktop/src/main/rpc.ts:179`, but preload only exposes create-terminal/get-shapes/notifications in `apps/desktop/src/preload/index.ts:76`. The architecture claims "agents read spatial context," but the implementation currently has no renderer receiver for that request.

**Codex's own Top 3**
1. Security and trust boundary first.
2. Unify ownership and persistence.
3. Make process/window topology explicit.

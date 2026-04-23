# Plan: Terminal Session as Domain Object

> Finding #6 from `docs/architecture-review-2026-04-22.md`.
> Status: **locked — handed to Codex.**
>
> Decisions baked in:
> - **Delete-view semantics:** refcount views. Detach on view unmount; when refcount hits 0, session is killed. Today's single-view UX is unchanged; enables multi-view later without changes here.
> - **Tests:** no new test tooling for this plan. Acceptance is manual (see bottom). `vitest` can be added later when a finding actually benefits from it.

**Goal:** Stop conflating "terminal shape / sidebar tab" (a UI view) with "PTY session" (a backend process). Introduce an in-renderer session store that owns attach/detach lifecycle so views become thin consumers and the `terminalDeleteBypassIds` smell disappears.

**Why this first:** findings #4 (renderer state), #5 (ring buffer / eviction), and the canvas/sidebar duplication all simplify downstream of this. Every later plan assumes "a session is a first-class thing the renderer can refer to by id."

**Tech:** existing stack — React 19, tldraw 4.5, xterm, Electron IPC via `contextBridge`. No new deps.

---

## Current state (from a fresh read)

- `apps/desktop/src/renderer/shapes/terminal-shape.tsx`:
  - Shape props hold `sidecarSessionId` ([304](../../apps/desktop/src/renderer/shapes/terminal-shape.tsx)).
  - Shape's `useEffect` creates a PTY on mount ([192](../../apps/desktop/src/renderer/shapes/terminal-shape.tsx)), reconnects if session id exists ([172](../../apps/desktop/src/renderer/shapes/terminal-shape.tsx)), disposes on exit ([140](../../apps/desktop/src/renderer/shapes/terminal-shape.tsx)), detaches on unmount ([227](../../apps/desktop/src/renderer/shapes/terminal-shape.tsx)).
  - `terminalDeleteBypassIds` module-level `Set` ([23](../../apps/desktop/src/renderer/shapes/terminal-shape.tsx)) + `deleteTerminalShapesSilently` helper ([35](../../apps/desktop/src/renderer/shapes/terminal-shape.tsx)) — programmatic deletes skip the confirm dialog *and* call `dispose`.
- `apps/desktop/src/renderer/components/sidebar-embedded-terminal.tsx`:
  - Mirrors the same lifecycle for sidebar tabs ([29–148](../../apps/desktop/src/renderer/components/sidebar-embedded-terminal.tsx)) — creates on mount, disposes on unmount, prefixes `instanceKey` with `sidebar:`.
- `apps/desktop/src/renderer/components/sidebar-terminal-stack.tsx`:
  - Tab bar; mounts one `SidebarEmbeddedTerminal` per tab id. Inactive tabs stay mounted so sessions survive tab switches.
- `apps/desktop/src/main/pty.ts`:
  - `PtyManager` already distinguishes `id` (renderer-facing, 8-char UUID) from `sidecarSessionId`. IPC signatures in `preload/index.ts` use `sessionKey` interchangeably with the sidecar id. The two-id scheme is already there — it's just leaking through.
- Preload API (`apps/desktop/src/preload/index.ts:12`): `terminal.create/reconnect/write/resize/dispose/detach/onData/onExit`. Views call these directly.
- `worktree-index-context.tsx` is the existing pattern for a notification-driven renderer store. Use it as a template.

---

## Proposed shape of the refactor

### Phase A — Introduce `TerminalSessionStore` in renderer

New file: `apps/desktop/src/renderer/contexts/terminal-session-store.tsx`

```ts
// Conceptual API — exact shape confirmed once Q1/Q2 are answered.
type SessionAttachment = {
  sessionId: string        // the 8-char renderer-facing id
  sidecarSessionId: string // for IPC routing (onData/onExit etc.)
  refs: number             // how many views have this attached
  cwd: string
}

type TerminalSessionStore = {
  // Create a new session OR attach to an existing one. Returns both ids.
  // attach() increments refcount if session already exists.
  attach(opts: { existingSessionId?: string; cwd: string }): Promise<{ sessionId: string; sidecarSessionId: string }>

  // Decrement refcount. When it hits 0, kills the session via IPC.
  detach(sessionId: string): void

  // Subscribe to data/exit (wraps preload onData/onExit).
  subscribe(sessionId: string, handlers: { onData: (d: string) => void; onExit: () => void }): () => void

  // Snapshot of known sessions.
  list(): SessionAttachment[]
}
```

Provided via a `TerminalSessionProvider` wrapping the app (or canvas + sidebar subtree). Mirrors `WorktreeIndexProvider` pattern.

### Phase A tasks

1. Create `apps/desktop/src/renderer/contexts/terminal-session-store.tsx`. Implement the store + `TerminalSessionProvider` per the API above. Refcount: `attach` creates or increments; `detach` decrements, and when it hits 0 calls `window.electron.terminal.dispose(sidecarSessionId)`. `subscribe` wraps `window.electron.terminal.onData/onExit` and deduplicates if multiple views subscribe to the same session (each view gets its own callback, store fans out internally). Commit.
2. Mount `TerminalSessionProvider` inside `app.tsx` (above the canvas and sidebar). Commit.
3. Refactor `SidebarEmbeddedTerminal` (`apps/desktop/src/renderer/components/sidebar-embedded-terminal.tsx`) to consume the store. No direct `window.electron.terminal.*` calls remain in that file — attach/detach/subscribe go through the store. Lifecycle: on mount call `store.attach({ cwd })`, save returned `sessionId` locally, subscribe, wire xterm input/resize; on unmount call `store.detach(sessionId)`. Commit.
4. Refactor `TerminalComponent` inside `terminal-shape.tsx` to consume the store. Rename shape prop `sidecarSessionId` → `sessionId` (renderer-facing id). Add a tldraw shape migration: on an old record with `sidecarSessionId`, move it to `sessionId` (acceptable because the old value was the sidecar id; the store will recognize existing sessions on first `attach`). Migration goes on the `TerminalShapeUtil` via tldraw's `migrations` static. The lifecycle mirrors the sidebar: `store.attach({ existingSessionId: shape.props.sessionId, cwd })` on mount, persist the returned `sessionId` back to the shape if it was newly created, `store.detach` on unmount. Commit.
5. Remove `terminalDeleteBypassIds`, `consumeTerminalDeleteBypass`, `markTerminalDeleteBypass`, `deleteTerminalShapesSilently` from `terminal-shape.tsx`. Update callers in `canvas.tsx` (search for `consumeTerminalDeleteBypass` and `deleteTerminalShapesSilently`) to use plain `editor.deleteShapes(...)` — the store handles session lifecycle via refcount; no bypass flag needed. Commit.
6. Verify the custom delete confirmation in `canvas.tsx:138` still fires on user-initiated shape delete (it should — it's in `onBeforeShapeChange`, independent of the bypass set).
7. Run the manual acceptance walkthrough (see "Acceptance criteria" below). If all pass, done.

### Phase B — Kill behavior cleanup (separate plan, after Phase A merges)

- Explicit "Kill session" menu item on terminal shape + tab
- Confirm dialog moves from "delete shape" to "kill session"
- Deleting a shape with non-zero remaining refs doesn't kill the session (single-view today: behavior unchanged)

### Phase C — Multi-view (stretch, only if product wants it)

- "Sessions" list in sidebar
- "Attach to existing session" action on shape create
- Multiple xterm instances receiving the same data stream

Phase C is out of scope for now. Phase B may be folded into Phase A if trivial.

---

## Acceptance criteria (manual, for Phase A)

Before declaring done, run each of these and confirm:

1. `pnpm --filter desktop typecheck` — clean.
2. `pnpm --filter desktop build` — clean.
3. `pnpm --filter desktop dev` — app launches without errors in main or renderer console.
4. **Canvas flow:** create a terminal shape on canvas → xterm paints, prompt appears, type a command → output shows.
5. **Canvas delete:** delete the shape → session dies in main (confirm via `PtyManager` log or `~/.ateli/sessions.json`).
6. **Sidebar flow:** open sidebar terminal tab → xterm paints, prompt appears.
7. **Sidebar close:** click X on tab → session dies.
8. **Worktree removal:** remove a worktree → associated terminals silently removed (no confirm dialog) → sessions die.
9. **Persistence:** create a canvas terminal, reload the renderer (Cmd-R), terminal reconnects to the same session (scrollback preserved).
10. Code audit: `grep -r "terminalDeleteBypassIds\|deleteTerminalShapesSilently\|sidecarSessionId" apps/desktop/src/renderer` returns nothing in renderer code (except the migration from old→new shape prop).

---

## Guardrails for Codex

- **Do not** touch `apps/desktop/src/main/` beyond what's necessary for the shape-prop migration. Main-process session ownership is out of scope.
- **Do not** change IPC signatures in `preload/index.ts` beyond renaming `sessionKey` → `sessionId` if it helps consistency. Adding/removing IPC methods is out of scope.
- **Do not** touch the sidecar code (`apps/desktop/src/main/sidecar/`).
- **Preserve** the existing scrollback-reconnect behavior in `terminal-shape.tsx:172`.
- **Preserve** the custom delete confirmation in `canvas.tsx:138`.
- **Preserve** the shape's input-event capturing (`stopBubble` on keydown/pointerdown in `terminal-shape.tsx:245`).
- **Add** a tldraw shape migration for `sidecarSessionId → sessionId` so existing persisted canvases don't break.
- **Commit** in logical chunks: (a) add store + tests, (b) refactor sidebar, (c) refactor canvas shape + migration, (d) delete dead code.

---

## Handoff command

```bash
node "/Users/btn0s/.claude/plugins/cache/openai-codex/codex/1.0.2/scripts/codex-companion.mjs" \
  task --background --write --effort high \
  "$(cat docs/plans/2026-04-22-session-as-domain-object.md)"
```

Then `/codex:status <job-id>`, `/codex:result <job-id>`, inspect diff, `/ultrareview` before merge.

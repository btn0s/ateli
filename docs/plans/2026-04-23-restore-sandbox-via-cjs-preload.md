# Plan: Restore Renderer Sandbox via CJS Preload

> Follow-up to the partial rollback in finding #10 (`docs/architecture-review-2026-04-22.md`).
> Status: **locked — queue after `task-moayyrra-kbe3u5` (#3) lands.**

**Goal:** Re-enable `sandbox: true` on the renderer `BrowserWindow`, which was reverted because the preload was built as an ES module (`.mjs`). Sandboxed preload requires CommonJS. Switch electron-vite's preload output to CJS, update the main-process preload path, flip sandbox back on.

**Why now:** this is a discrete, isolated fix. The other security hardening from `2026-04-23-security-hardening.md` is still in effect; this closes the one gap we had to reopen.

---

## Tasks

### 1. Force CJS output for the preload target

**File:** `apps/desktop/electron.vite.config.ts`

Add a rollupOptions block to the `preload` section to force a CommonJS output and a predictable filename. electron-vite's default output is `.mjs`; override to `.cjs`:

```ts
preload: {
  plugins: [externalizeDepsPlugin()],
  build: {
    rollupOptions: {
      output: {
        format: "cjs",
        entryFileNames: "[name].cjs",
      },
    },
  },
},
```

Rationale: Electron's sandboxed preload runtime only runs CommonJS. ESM `import` syntax fails with "Cannot use import statement outside a module" under sandbox. Setting `format: "cjs"` tells rollup to emit `require()` / `module.exports` instead of `import` / `export`.

Commit: `build(desktop): emit preload as CommonJS for sandbox compatibility`.

---

### 2. Update the main-process preload path reference

**File:** `apps/desktop/src/main/index.ts`

Line ~38 currently says:

```ts
preload: path.join(__dirname, "../preload/index.mjs"),
```

Change to match the new output filename:

```ts
preload: path.join(__dirname, "../preload/index.cjs"),
```

Commit: `fix(desktop): point BrowserWindow preload at the .cjs output`.

---

### 3. Re-enable renderer sandbox

**File:** `apps/desktop/src/main/index.ts`

Line ~40, flip `sandbox` back on:

```ts
webPreferences: {
  preload: path.join(__dirname, "../preload/index.cjs"),
  sandbox: true,
},
```

This is the change that was reverted in commit `7377941`. The previous rollback was correct given the ESM preload; CJS preload makes this safe again.

Commit: `fix(desktop): enable renderer sandbox (preload now CJS)`.

---

## Acceptance criteria

1. `pnpm --filter desktop build` — green, and `out/preload/` contains `index.cjs` (not `index.mjs`).
2. `pnpm --filter desktop dev` — app launches, no "Unable to load preload script" error in DevTools console, no "Cannot use import statement outside a module" SyntaxError.
3. `window.electron` is defined in the renderer console (i.e. preload ran and `contextBridge` worked).
4. Basic flows still work: open folder, create a terminal on canvas, create a terminal in sidebar, worktree list populates.
5. No `Electron Security Warning (Insecure Content-Security-Policy)` about unsafe-eval (that warning is orthogonal; it'll still appear in dev because we allow `unsafe-eval` for Vite HMR — **that's expected**, don't try to "fix" it here).

## Guardrails for Codex

- **Do not** change the preload source (`apps/desktop/src/preload/index.ts`). It already uses only sandbox-safe APIs (`contextBridge`, `ipcRenderer`, `process.platform`). Rollup handles the ESM→CJS transpile.
- **Do not** touch CSP. It's already configured to allow what's needed.
- **Do not** modify the renderer or any other file outside the three listed above.
- **Do not** introduce new deps.
- **Commit** in the 3 chunks above.

## Handoff command

```bash
node "/Users/btn0s/.claude/plugins/cache/openai-codex/codex/1.0.2/scripts/codex-companion.mjs" \
  task --background --write --effort high \
  "$(cat docs/plans/2026-04-23-restore-sandbox-via-cjs-preload.md)"
```

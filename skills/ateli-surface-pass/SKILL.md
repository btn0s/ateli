---
name: ateli-surface-pass
description: Audits and tightens Ateli UI after code changes to match the project luminous and skeuo-lite surface system. Run when finishing UI work, before merge, or when the user asks to check chrome, surfaces, globals.css, or desktop renderer styling.
---

# Ateli surface pass (post-change UI audit)

Use this after an agent (or a human) changes **desktop renderer** or **@workspace/ui** styling, or touches **`packages/ui/src/styles/globals.css`**. Goal: new UI stays on the **Ateli “luminous + skeuo-lite”** system instead of ad-hoc shadows and one-off classes.

## Before you start

Read **`AGENTS.md` → “UI: Luminous floating surfaces”** and skim **`packages/ui/src/styles/globals.css`** for the `ateli-*` block (variables and `@utility` names). Do not invent parallel naming; extend `globals.css` and `AGENTS.md` if you truly need a new pattern.

**Reference implementations (copy composition, not arbitrary CSS):**

| Use case | File |
|----------|------|
| Modal / palette shell | `apps/desktop/src/renderer/command-palette/CommandPalette.tsx` |
| Shared `Command` strip, list, items | `packages/ui/src/components/command.tsx` |
| Left/right columns | `apps/desktop/src/renderer/components/sidebar-shell.tsx` |
| Center diff chrome | `apps/desktop/src/renderer/components/diff-preview-tabs.tsx` |
| Bottom tool strip | `apps/desktop/src/renderer/components/canvas.tsx` → `CustomToolbar` |

## 1) Gather scope

From the diff or the user, list **changed** paths under:

- `apps/desktop/src/renderer/**/*.tsx` (or `.css`)
- `packages/ui/src/**/*.tsx` and `packages/ui/src/styles/globals.css`

If the change set is empty for those roots, the pass may be a no-op.

## 2) Grep for red flags (fix or justify)

In the **changed** files, search for these patterns. Each hit should either map to a documented `ateli-*` utility, use **semantic tokens** (`--ateli-surface-*`), or be explicitly justified in your report (e.g. one-off illustration).

| Pattern | Why |
|--------|-----|
| `shadow-\[` (long arbitrary shadow) | Prefer `ateli-surface-luminous`, `ateli-surface-luminous-floater`, `ateli-surface-slab`, or a variable in `globals.css` |
| `from-black/`, `via-black/`, `bg-gradient` on **overlays** without `ateli-overlay-scrim` | Overlays should use the scrim utility or extend `--ateli-overlay-scrim` |
| `transition-all` or `transition: all` | Use explicit properties, e.g. `transition-[color,background-color,transform]` (see `make-interfaces-feel-better` user rule) |
| `backdrop-blur` **without** an `ateli-surface-*` on the same “glass” control | Luminous/floater utilities already include blur where intended |

**Do not** remove shadows that are **not** in this family if they belong to a third-party component you do not own (e.g. raw tldraw classNames), unless the task is to wrap/override with our shell.

## 3) Conformance checklist (changed surfaces only)

For any **new** floating, docked, or chrome UI:

- [ ] **Modal / popover / command box:** `ateli-surface-luminous` (or floater for small bottom chips) + `border border-border/35` + `bg-popover/95` pattern from references
- [ ] **Full-viewport / portal dimmer:** `ateli-overlay-scrim`, not a raw black div
- [ ] **Top wash under a control row:** `ateli-surface-input-stripe` (or the documented gradient equivalent)
- [ ] **Docked center / diff / shape inlays:** `ateli-surface-slab` and/or `ateli-chrome-ledger` as in `diff-preview-tabs` / `shape-chrome`
- [ ] **Sidebars:** `ateli-surface-luminous` + `ateli-skeuo-dock` on the shell column
- [ ] **Search fields in command UI:** `ateli-skeuo-input-dish` on the input group when applicable
- [ ] **List section rules:** `ateli-skeuo-divider` instead of bare `h-px bg-border`
- [ ] **Error / key notice strips:** `ateli-skeuo-well` + semantic color
- [ ] **Selected tab chips (shared pattern):** `ateli-skeuo-pill-inset` for pressed-in read where `SidebarTabButton` applies

Tweak **globally** in `globals.css` (CSS variables), not by scattering new magic numbers in TSX.

## 4) Verification (always run for touched TS/CSS)

From repo root:

```bash
pnpm --filter @workspace/ui typecheck
pnpm --filter desktop typecheck
```

If the change was large in `apps/desktop` or `packages/ui` styles, also run:

```bash
pnpm --filter desktop build
```

**Do not** start dev servers; see `AGENTS.md` rules. If a check fails, fix before reporting the pass as complete.

## 5) Report to the user

Output a **short** markdown report:

1. **Scope** — which files you reviewed
2. **Result** — Pass, or **Pass with fixes** (list what you changed) or **Blocked** (failing typecheck/build with the error summary)
3. **Optional** — 1–3 follow-ups (e.g. “legacy tldraw class left alone”) only if important

## Cursor setup (optional)

The repo’s `.cursor/` directory may be gitignored. To register this skill in **Cursor** so it is discoverable by name, symlink or copy this folder to your skills directory from the **repo root**:

```bash
ln -sf "$PWD/skills/ateli-surface-pass" "$HOME/.cursor/skills/ateli-surface-pass"
```

Alternatively, paste the key sections into a one-off agent instruction or a project rule. The **committed** source of truth is **`skills/ateli-surface-pass/SKILL.md`**.

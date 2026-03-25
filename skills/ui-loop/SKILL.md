---
name: ui-loop
description: Use for manually testing, critiquing, and improving the Ateli desktop UI. This combines Electron app automation, visible Agentation-based annotation, and Emil Kowalski-style design engineering judgment. Use when iterating on shell layout, panel density, spacing, hierarchy, interaction polish, or any renderer UI in this repo.
---

# UI Loop

Use this skill when you need to manually test and improve the Ateli desktop UI.

This skill combines three modes:

- **Electron control**: drive the actual desktop app, not just the local web renderer
- **Agentation critique**: annotate the visible UI in a headed session
- **Design-engineering review**: apply Emil Kowalski-style polish and judgment to what should change

## Core rule

Ateli is an Electron app. Prefer interacting with the running desktop app via Electron/CDP. Do not treat the renderer URL as the primary product surface unless you explicitly need to debug the raw web view.

## When to use this

- shell layout iteration
- canvas/sidebar interaction bugs
- UI density / hierarchy / spacing critiques
- input, toolbar, or panel polish
- validating that a visual change actually improved the desktop experience

## Repo-specific constraints

- Run the app only inside tmux session `ateli-dev`
- The shell is workspace-first, not agent-first
- The canvas remains the primary surface
- For tldraw/editor composition rules, also read `skills/tldraw/SKILL.md`

## Important files

- `apps/desktop/src/renderer/app.tsx`
- `apps/desktop/src/renderer/components/canvas.tsx`
- `apps/desktop/src/renderer/components/workspace-shell.tsx`
- `apps/desktop/src/renderer/shapes/terminal-shape.tsx`

## Workflow

### 1. Launch the app

Use tmux:

```bash
tmux new-session -d -s ateli-dev 'cd /Users/btn0s/dev/2026/projects/ateli/ateli-02 && pnpm --filter desktop dev'
sleep 2
tmux capture-pane -pt ateli-dev:0.0 | tail -n 120
```

Confirm the renderer URL and that Electron started.

### 2. Prefer Electron automation first

Use the Electron automation pattern to drive the desktop app itself.

Typical flow:

```bash
open -a "Ateli" --args --remote-debugging-port=9222
agent-browser connect 9222
agent-browser snapshot -i
```

If the local dev app is already running and exposing a renderer URL, you may use the renderer page only as a fallback or to verify Agentation wiring.

### 3. Verify Agentation

Agentation should be installed in the renderer root and visible on the page.

Check:

```bash
agent-browser eval "document.querySelector('[data-feedback-toolbar]') ? 'toolbar found' : 'NOT FOUND'"
```

Expand only if collapsed:

```bash
agent-browser eval "document.querySelector('[data-feedback-toolbar][class*=expanded]') ? 'already expanded' : (document.querySelector('[class*=toggleContent]')?.click(), 'expanding')"
```

### 4. Critique visibly

Use Agentation-style visible critique when you want to mark specific UI problems on the live app:

- target the real desktop UI
- move top-to-bottom
- annotate only concrete issues
- keep each annotation short and actionable

Good annotation categories in Ateli:

- too much shell chrome
- repeated information
- weak hierarchy
- canvas squeezed by shell
- bad safe-zone handling
- spacing rhythm problems
- overly soft styling
- poor terminal/chat/file-tree relationships

### 5. Apply Emil-style judgment

When deciding what to change, prefer:

- fewer UI words
- stronger hierarchy
- less repeated metadata
- simpler surfaces
- invisible correctness over decorative styling
- fast feedback and clean interaction over ornament

Ask:

- does this UI explain itself with less text?
- is anything repeated in multiple places?
- is the canvas still the hero?
- does the shell feel like infrastructure rather than noise?
- are there invisible rough edges around spacing, density, alignment, safe zones, and motion?

### 6. Convert critique into edits

After annotation/review:

- patch the smallest relevant file
- validate visually again
- keep the loop tight

### 7. Verify after changes

Always re-check the live app after edits:

- confirm the issue is actually fixed
- confirm you did not make the shell noisier
- confirm Electron behavior still matches the intended product surface

## Output style for review notes

Use a markdown table when summarizing UI review findings:

| Before | After | Why |
| --- | --- | --- |
| repeated workspace path in multiple panels | one top-level workspace path | reduces chrome and improves hierarchy |

## Heuristics for Ateli specifically

- one fact should usually appear in one place
- file tree belongs on the left
- chat and terminal can share the execution column
- shell panels should support the canvas, not compete with it
- if a surface feels “AI product” instead of “workspace,” simplify it

## References

- `references/source-skills.md`

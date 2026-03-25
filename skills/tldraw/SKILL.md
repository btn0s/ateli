---
name: tldraw
description: Use for any tldraw work in this repo: shell composition, custom UI, editor event handling, custom shapes, or persistence/layout work that touches the editor tree. Read this before modifying canvas.tsx, shape utils, or any UI that needs useEditor/useValue.
---

# tldraw

Use this skill for tldraw work in Ateli.

## Goals

- Keep the canvas as the primary workspace surface.
- Build shell UI in a tldraw-native way.
- Avoid fighting the editor's event system.
- Reuse the repo's current integration points instead of adding parallel patterns.

## Repo-specific rules

- If UI needs `useEditor`, `useValue`, or editor context, build it inside the tldraw tree.
- Prefer `InFrontOfTheCanvas` for larger shell overlays instead of wrapping the canvas outside React/tldraw.
- Treat shapes as views over durable artifacts or processes where possible.
- Do not introduce heavy supervisor / specialist / multi-agent shell metaphors unless the task explicitly calls for them.

## Current file map

- `apps/desktop/src/renderer/components/canvas.tsx`
  Main `Tldraw` mount, custom `TLComponents`, grid override, shell injection point.
- `apps/desktop/src/renderer/shapes/terminal-shape.tsx`
  Terminal custom shape and worktree/cwd integration.

Search helpers:

```bash
rg "InFrontOfTheCanvas|TLComponents|useEditor|useValue|markEventAsHandled" apps/desktop/src
rg "ShapeUtil|TerminalShapeUtil|getDefaultProps|component\\(" apps/desktop/src
```

## Working rules

### 1. Shell composition

- Use the `components` prop on `Tldraw` and override named slots through `TLComponents`.
- For sidebars or app-shell overlays that still need editor context, prefer `InFrontOfTheCanvas`.
- Only use `TopPanel` / `SharePanel` for small zone inserts. They are not a substitute for a full left/right shell.

### 2. Editor-aware React code

- Use `useEditor()` for imperative editor access.
- Use `useValue()` for reactive editor-derived state.
- Keep editor reads close to the component that needs them.
- Avoid pushing editor state through unrelated props if the component can live inside the tldraw tree.

### 3. Event handling

- Prefer `editor.markEventAsHandled(event)` when a custom UI element inside the editor should block tldraw from also handling the same event.
- If you also need DOM propagation stopped, do both deliberately.
- Do not use deprecated `stopEventPropagation`.

### 4. Custom UI look and feel

- If custom UI should feel native to tldraw, prefer tldraw UI primitives.
- If the product direction is workspace-first shell UI, use the repo's shared UI primitives where that makes more sense, but keep the composition pattern tldraw-native.
- Do not add shell UI outside the editor just to avoid learning the slot model.

### 5. Shape work

- Keep custom shapes narrowly scoped.
- Prefer durable external state for real processes/artifacts; shape props should point to them rather than duplicating them.
- When changing shape props, think about reload/restart durability and snapshot compatibility.

## Ateli-specific heuristics

- Left/right sidebars are shell concerns, not canvas content.
- File tree, chat, and terminal belong to the shell.
- Spatial groupings, labels, and cards belong to the canvas.
- When in doubt, protect the center canvas and avoid letting sidebars drive the product metaphor.

## References

Read only what you need:

- `references/official-docs.md`

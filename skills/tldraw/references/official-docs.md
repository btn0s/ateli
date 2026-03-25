# Official tldraw docs used for this skill

These are the current official docs/pages this skill is based on.

## UI composition

- UI components: https://tldraw.dev/sdk-features/ui-components
  - `Tldraw` exposes named UI component slots.
  - UI components are expected to use `useEditor`, `useValue`, and related hooks.

- UI zones example: https://tldraw.dev/examples/zones
  - `TopPanel` and `SharePanel` are useful for small inserts.
  - They are limited zones, not a general shell layout system.

- Layer panel example: https://tldraw.dev/examples/layer-panel
  - Demonstrates overriding `InFrontOfTheCanvas` with a custom component.
  - This is the right pattern when the shell needs to live inside the tldraw tree.

## Event handling

- Editor reference: `markEventAsHandled`
  https://tldraw.dev/reference/editor/Editor
  - Use `markEventAsHandled` to stop other parts of tldraw from handling an event without interfering with unrelated non-tldraw handlers.

- Deprecated helper:
  https://tldraw.dev/reference/editor/stopEventPropagation
  - `stopEventPropagation` is deprecated.
  - Prefer `Editor.markEventAsHandled(...)`, or manually call `event.stopPropagation()` only when you actually need DOM propagation blocked.

## UI primitives

- UI primitives: https://tldraw.dev/sdk-features/ui-primitives
  - Use these if you want custom UI to feel like native tldraw UI.

## Focus / scroll behavior

- Editor focus example: https://tldraw.dev/examples/editor-focus
  - Focus determines when canvas shortcuts and wheel interactions should affect the editor.
  - Important when embedding scrollable or interactive UI inside the editor.

# Sidebars — Design Spec

## Overview

Add two collapsible sidebars flanking the canvas: a canvas tree on the left
showing all shapes, and a file tree on the right showing the project directory.
Both are single-panel, no tabs, no switcher. Minimal chrome.

## Layout

```
┌──────────┬─────────────────────────┬──────────┐
│          │                         │          │
│ Canvas   │                         │ File     │
│ Tree     │        Canvas           │ Tree     │
│          │                         │          │
│          │                         │          │
│          │                         │          │
└──────────┴─────────────────────────┴──────────┘
```

## Left Sidebar — Canvas Tree

Lists all shapes on the current canvas page in a flat/nested list.

**Shape display:**
- Terminal shapes → icon + session name or cwd folder name
- Frame shapes → icon + frame label, children nested underneath
- Other shapes (draw, text, arrow, etc.) → type icon + truncated id

**Interactions:**
- Click an item → `editor.select(shapeId)` + `editor.zoomToSelection()`
- List updates reactively as shapes are added/removed/renamed
- Uses `editor.getCurrentPageShapes()` via tldraw's reactive `track()` wrapper

**Sorting:** Frames first (with children), then other shapes by type, then by
creation order.

## Right Sidebar — File Tree

Shows the project directory as an expandable folder tree.

**Root:** The `folderPath` selected by the user on app launch.

**Interactions:**
- Click a directory → expand/collapse
- Click a file → `shell.openPath(filePath)` opens in default editor (Cursor)
- Tree starts collapsed, root expanded

**Filtering:** Ignores `.git`, `node_modules`, `.next`, `dist`, `out`,
`.turbo`, `.DS_Store`. Reads `.gitignore` if feasible, otherwise hardcoded
ignore list.

**Data flow:**
- Renderer calls `fs:readdir` IPC to get directory listing from main process
- Returns `{ name, path, isDirectory }[]` sorted (directories first, then
  alphabetical)
- Directories are lazy-loaded (only read when expanded)

## Sidebar Shell

Reusable container component for both sidebars.

**Props:**
- `side: "left" | "right"` — which edge
- `defaultWidth: number` — initial width in pixels
- `minWidth: number` — minimum resize width
- `children: ReactNode` — panel content

**Behavior:**
- Resizable via drag handle on the inner edge
- Width persisted to localStorage (`ateli:sidebar:{side}:width`)
- Collapsible — drag below minWidth snaps to collapsed (width 0)
- Styled: `bg-card`, `border-border` on inner edge, full height

**Implementation note:** This is a plain div with a drag handle, not a
shadcn Sheet or Dialog. No overlay, no animation. Just a resizable column.

## IPC Addition

**`fs:readdir`** — new IPC handler in main process:

```typescript
ipcMain.handle("fs:readdir", async (_event, { dirPath }: { dirPath: string }) => {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  return entries
    .filter(e => !IGNORED.has(e.name))
    .map(e => ({ name: e.name, path: path.join(dirPath, e.name), isDirectory: e.isDirectory() }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
})
```

Also add to preload bridge:
```typescript
fs: {
  readdir: (dirPath: string) => ipcRenderer.invoke("fs:readdir", { dirPath })
}
```

## File Changes

**New files:**
- `src/renderer/components/sidebar-shell.tsx` — resizable sidebar container
- `src/renderer/components/canvas-tree.tsx` — shape list panel
- `src/renderer/components/file-tree.tsx` — directory tree panel

**Modified files:**
- `src/renderer/app.tsx` — layout with sidebars flanking canvas
- `src/main/index.ts` — add `fs:readdir` IPC handler
- `src/preload/index.ts` — add `fs.readdir` to bridge
- `src/renderer/env.d.ts` — add `fs` types

## Deferred

- File watching (auto-refresh on changes)
- File search
- Drag files onto canvas
- Worktree-specific file tree
- Bottom-right panel (terminal list, diff, inspector)
- Sidebar tabs/switcher
- Collapsible toggle buttons in titlebar

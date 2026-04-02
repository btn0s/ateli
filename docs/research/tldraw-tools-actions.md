# tldraw Tools & Actions Reference

Dumped from tldraw v4.5.3 runtime via `useTools()` and `useActions()`.

## Tools (33 total)

These are the toolbar items — drawing tools that the user selects.

### Primary tools (with keyboard shortcuts)
| id | icon | kbd |
|---|---|---|
| select | tool-pointer | v |
| hand | tool-hand | h |
| eraser | tool-eraser | e |
| draw | tool-pencil | d,b,x |
| arrow | tool-arrow | a |
| line | tool-line | l |
| frame | tool-frame | f |
| text | tool-text | t |
| note | tool-note | n |
| laser | tool-laser | k |
| highlight | tool-highlight | shift+d |
| asset | tool-media | cmd+u |

### Geo shapes (no shortcuts — accessed via geo tool submenu)
| id | icon |
|---|---|
| rectangle | geo-rectangle (kbd: r) |
| ellipse | geo-ellipse (kbd: o) |
| cloud | geo-cloud |
| triangle | geo-triangle |
| diamond | geo-diamond |
| pentagon | geo-pentagon |
| hexagon | geo-hexagon |
| octagon | geo-octagon |
| star | geo-star |
| rhombus | geo-rhombus |
| rhombus-2 | geo-rhombus-2 |
| oval | geo-oval |
| trapezoid | geo-trapezoid |
| arrow-right/left/up/down | geo-arrow-* |
| x-box | geo-x-box |
| check-box | geo-check-box |
| heart | geo-heart |

### Other
| id | icon |
|---|---|
| embed | dot |

## Actions (93 total)

These are invokable actions — used in context menus, keyboard shortcuts, and menus.

### Commonly useful for our UI
| id | icon | kbd | notes |
|---|---|---|---|
| undo | undo | cmd+z | |
| redo | redo | cmd+shift+z | |
| duplicate | duplicate | cmd+d | |
| delete | trash | ⌫,del | |
| group | group | cmd+g | |
| ungroup | ungroup | cmd+shift+g | |
| cut | — | cmd+x | |
| copy | — | cmd+c | |
| paste | — | cmd+v | |
| select-all | — | cmd+a | |
| zoom-in | — | cmd+= | |
| zoom-out | — | cmd+- | |
| zoom-to-100 | reset-zoom | shift+0 | |
| zoom-to-fit | — | shift+1 | |
| zoom-to-selection | — | shift+2 | |
| bring-to-front | bring-to-front | ] | |
| bring-forward | bring-forward | alt+] | |
| send-backward | send-backward | alt+[ | |
| send-to-back | send-to-back | [ | |
| toggle-grid | — | cmd+' | |
| toggle-dark-mode | — | cmd+/ | |

### Alignment (shown when multiple shapes selected)
align-left, align-right, align-top, align-bottom,
align-center-horizontal, align-center-vertical,
distribute-horizontal, distribute-vertical,
stretch-horizontal, stretch-vertical

### Export
export-as-svg, export-as-png, export-all-as-svg, export-all-as-png,
copy-as-svg, copy-as-png

### Other toggles
toggle-snap-mode, toggle-wrap-mode, toggle-dynamic-size-mode,
toggle-paste-at-cursor, toggle-reduce-motion, toggle-focus-mode,
toggle-tool-lock, toggle-edge-scrolling, toggle-invert-zoom

## How to use at runtime

```tsx
import { useTools, useActions } from "tldraw"

// Inside a tldraw child component:
const tools = useTools()   // Record<string, TLUiToolItem>
const actions = useActions() // Record<string, TLUiActionItem>

// Call a tool:
tools.select.onSelect("toolbar")

// Call an action:
actions.undo.onSelect("context-menu")
```

## Key insight

- `useTools()` returns the full tool registry — each has `onSelect(source)` to activate it
- `useActions()` returns the full action registry — each has `onSelect(source)` to invoke it
- Both can be called from custom UI components rendered inside `<Tldraw>`
- The `source` parameter is just for analytics ("toolbar", "context-menu", "kbd", etc.)

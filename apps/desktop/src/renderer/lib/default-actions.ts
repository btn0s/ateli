import type { Editor } from "tldraw"
import {
  MousePointer2,
  Pencil,
  Eraser,
  MoveRight,
  Type,
  TerminalSquare,
  ZoomIn,
  ZoomOut,
  Maximize,
  SquareDashedMousePointer,
  RotateCcw,
} from "lucide-react"
import { registerAction } from "./tool-registry"

const ANIM = { animation: { duration: 200 } }

function addTerminalAtCenter(editor: Editor) {
  const center = editor.getViewportPageBounds().center
  editor.createShape({
    type: "terminal",
    x: center.x - 300,
    y: center.y - 200,
  })
}

// --- Drawing tools ---
registerAction({
  id: "tool-select",
  label: "Select",
  icon: MousePointer2,
  shortcut: "V",
  group: "Tools",
  isToolToggle: true,
  showInToolbar: true,
  showInCommandMenu: true,
  execute: (editor) => editor.setCurrentTool("select"),
})

registerAction({
  id: "tool-draw",
  label: "Draw",
  icon: Pencil,
  shortcut: "D",
  group: "Tools",
  isToolToggle: true,
  showInToolbar: true,
  showInCommandMenu: true,
  execute: (editor) => editor.setCurrentTool("draw"),
})

registerAction({
  id: "tool-eraser",
  label: "Eraser",
  icon: Eraser,
  shortcut: "E",
  group: "Tools",
  isToolToggle: true,
  showInToolbar: true,
  showInCommandMenu: true,
  execute: (editor) => editor.setCurrentTool("eraser"),
})

registerAction({
  id: "tool-arrow",
  label: "Arrow",
  icon: MoveRight,
  shortcut: "A",
  group: "Tools",
  isToolToggle: true,
  showInToolbar: true,
  showInCommandMenu: true,
  execute: (editor) => editor.setCurrentTool("arrow"),
})

registerAction({
  id: "tool-text",
  label: "Text",
  icon: Type,
  shortcut: "T",
  group: "Tools",
  isToolToggle: true,
  showInToolbar: true,
  showInCommandMenu: true,
  execute: (editor) => editor.setCurrentTool("text"),
})

// --- Create actions ---
registerAction({
  id: "add-terminal",
  label: "Add Terminal",
  icon: TerminalSquare,
  group: "Create",
  showInToolbar: true,
  showInCommandMenu: true,
  showInContextMenu: true,
  execute: addTerminalAtCenter,
})

// --- Zoom actions ---
registerAction({
  id: "zoom-in",
  label: "Zoom In",
  icon: ZoomIn,
  shortcut: "⌘+",
  group: "Zoom",
  showInCommandMenu: true,
  execute: (editor) => editor.zoomIn(editor.getViewportScreenCenter(), ANIM),
})

registerAction({
  id: "zoom-out",
  label: "Zoom Out",
  icon: ZoomOut,
  shortcut: "⌘-",
  group: "Zoom",
  showInCommandMenu: true,
  execute: (editor) => editor.zoomOut(editor.getViewportScreenCenter(), ANIM),
})

registerAction({
  id: "zoom-to-fit",
  label: "Zoom to Fit",
  icon: Maximize,
  shortcut: "⇧1",
  group: "Zoom",
  showInCommandMenu: true,
  execute: (editor) => editor.zoomToFit(ANIM),
})

registerAction({
  id: "zoom-to-selection",
  label: "Zoom to Selection",
  icon: SquareDashedMousePointer,
  shortcut: "⇧2",
  group: "Zoom",
  showInCommandMenu: true,
  execute: (editor) => editor.zoomToSelection(ANIM),
})

registerAction({
  id: "zoom-reset",
  label: "Reset Zoom (100%)",
  icon: RotateCcw,
  shortcut: "⇧0",
  group: "Zoom",
  showInCommandMenu: true,
  execute: (editor) =>
    editor.resetZoom(editor.getViewportScreenCenter(), ANIM),
})

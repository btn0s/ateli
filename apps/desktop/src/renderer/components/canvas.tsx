import {
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useState,
} from "react"
import {
  DefaultContextMenu,
  DefaultContextMenuContent,
  Tldraw,
  TldrawUiIcon,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  track,
  useEditor,
  useTools,
  useValue,
} from "tldraw"
import type {
  TLComponents,
  TLShapeId,
  TLUiContextMenuProps,
  TLUiIconType,
} from "tldraw"
import "tldraw/tldraw.css"
import { DiffPreviewTabsProvider } from "@/contexts/diff-preview-tabs-context"
import {
  WorktreeIndexProvider,
  useRepoPath,
} from "@/contexts/worktree-index-context"
import { TerminalShapeUtil, setTerminalCwd } from "@/shapes/terminal-shape"
import { cwdUnderRemovedWorktree } from "@/lib/terminal-worktree-title"
import {
  getToolbarActions,
  getContextMenuActions,
  type ToolAction,
} from "@/lib/tool-registry"
import { addTerminalAtCenter } from "@/lib/default-actions"
import "@/lib/default-actions"
import { CommandPalette } from "../command-palette/CommandPalette"
import {
  PaletteControllerProvider,
  usePaletteController,
  type PaletteController,
} from "../command-palette/palette-controller"
import { DiffPreviewTabs } from "./diff-preview-tabs"
import { SidebarHud } from "./sidebar-hud"
import { FileTree } from "./file-tree"
import { LeftSidebarTabs } from "./left-sidebar-tabs"
import { useTerminalKillConfirmation } from "./terminal-kill-dialog"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { deleteCanvasShapesAsSync } from "@/lib/canvas-delete-shapes"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

const customShapeUtils = [TerminalShapeUtil]

// Dot grid rendering
const DOT_OUTER_ALPHA = 0.14
const DOT_INNER_ALPHA = 0.3
const DOT_MIN_RADIUS = 0.8
const DOT_MAX_RADIUS = 1.25
const BASE_DOT_COLOR = [255, 255, 255] as const
const GRID_TARGET_PX = 20
const GRID_LOD_MIN_PX = 14
const GRID_LOD_MAX_PX = 28

// tldraw tools to show in our toolbar, in order
const TOOLBAR_TOOL_IDS = [
  "select",
  "hand",
  "draw",
  "eraser",
  "arrow",
  "text",
  "frame",
  "note",
]

/** Glassy skeuo-lite bar (see `ateli-surface-luminous-floater` in globals.css). */
const TOOLBAR_FLOATER =
  "ateli-surface-luminous-floater inline-flex items-center gap-0.5 rounded-xl border border-border/35 bg-popover/95 p-1.5 text-popover-foreground antialiased"

const toolButtonClass =
  "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"

const toolButtonActiveClass =
  "flex size-8 items-center justify-center rounded-md bg-accent text-accent-foreground transition-[color,background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.96]"

function runToolAction(
  action: ToolAction,
  editor: ReturnType<typeof useEditor>,
  palette: PaletteController,
) {
  if (action.openPaletteRoute) {
    palette.openRoute(action.openPaletteRoute)
    return
  }
  action.execute?.(editor)
}

const CustomToolbar = track(() => {
  const editor = useEditor()
  const palette = usePaletteController()
  const tools = useTools()
  const currentToolId = editor.getCurrentToolId()
  const customActions = getToolbarActions()

  return (
    <div className="pointer-events-none absolute inset-0 z-[300] font-sans antialiased">
      <div className="pointer-events-none absolute bottom-0 left-0 flex w-full items-center justify-center p-3">
        <div className="pointer-events-auto flex items-center justify-center">
          <div className={cn(TOOLBAR_FLOATER)}>
            {TOOLBAR_TOOL_IDS.map((id) => {
              const tool = tools[id]
              if (!tool) return null
              const isActive = currentToolId === id
              return (
                <button
                  key={id}
                  className={cn(
                    isActive ? toolButtonActiveClass : toolButtonClass
                  )}
                  onClick={() => tool.onSelect("toolbar")}
                  title={`${id}${tool.kbd ? ` (${tool.kbd.split(",")[0]})` : ""}`}
                >
                  <TldrawUiIcon
                    icon={tool.icon as TLUiIconType}
                    small
                    label={id}
                  />
                </button>
              )
            })}
            <div
              className="mx-0.5 h-5 w-px shrink-0 bg-gradient-to-b from-border/20 via-border/50 to-border/20"
              aria-hidden
            />
            {customActions.map((action) => (
              <button
                key={action.id}
                className={toolButtonClass}
                onClick={() => runToolAction(action, editor, palette)}
                title={action.label}
              >
                <action.icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})

function CustomContextMenu(props: TLUiContextMenuProps) {
  const editor = useEditor()
  const palette = usePaletteController()
  const customActions = getContextMenuActions()
  const { requestKill, dialog } = useTerminalKillConfirmation()
  const selectedTerminal = useValue(
    "terminal-context-menu-kill-action",
    () => {
      const shape = editor.getOnlySelectedShape()
      if (shape?.type !== "terminal") return null
      return {
        sessionId: (shape.props as { sessionId?: string }).sessionId,
      }
    },
    [editor]
  )

  return (
    <>
      <DefaultContextMenu {...props}>
        {selectedTerminal ? (
          <TldrawUiMenuGroup id="terminal-session-actions">
            <TldrawUiMenuItem
              id="kill-terminal-session"
              label={"Kill session" as any}
              kbd="$!k"
              readonlyOk
              disabled={!selectedTerminal.sessionId}
              onSelect={() => {
                if (!selectedTerminal.sessionId) return
                requestKill({ sessionId: selectedTerminal.sessionId })
              }}
            />
          </TldrawUiMenuGroup>
        ) : null}
        {customActions.length > 0 && (
          <TldrawUiMenuGroup id="ateli-actions">
            {customActions.map((action) => (
              <TldrawUiMenuItem
                key={action.id}
                id={action.id}
                label={action.label as any}
                icon={action.tldrawIcon as any}
                readonlyOk
                onSelect={() => runToolAction(action, editor, palette)}
              />
            ))}
          </TldrawUiMenuGroup>
        )}
        <DefaultContextMenuContent />
      </DefaultContextMenu>
      {dialog}
    </>
  )
}

function TerminalDeleteDialog() {
  const editor = useEditor()
  const [pendingTerminalIds, setPendingTerminalIds] = useState<TLShapeId[]>([])

  useEffect(() => {
    return editor.sideEffects.registerBeforeDeleteHandler(
      "shape",
      (shape, source) => {
        if (shape.type !== "terminal") return
        if (source !== "user") return
        if (!shape.props.sessionId) return
        const shapeId = shape.id as TLShapeId

        setPendingTerminalIds((prev) =>
          prev.includes(shapeId) ? prev : [...prev, shapeId]
        )
        return false
      }
    )
  }, [editor])

  const open = pendingTerminalIds.length > 0

  function onCancel() {
    setPendingTerminalIds([])
  }

  function onConfirmDelete() {
    const ids = pendingTerminalIds
    if (ids.length === 0) return

    deleteCanvasShapesAsSync(editor, ids)
    setPendingTerminalIds([])
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader className="gap-1">
          <DialogTitle>Delete Terminal?</DialogTitle>
          <DialogDescription>
            {pendingTerminalIds.length > 1
              ? `This will delete ${pendingTerminalIds.length} terminal shapes and end their running sessions.`
              : "This will delete the terminal shape and end its running session."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
            <span className="ml-1 text-[11px] opacity-60 tabular-nums">Esc</span>
          </Button>
          <Button variant="destructive" onClick={onConfirmDelete}>
            Delete
            <span className="ml-1 text-[11px] opacity-60 tabular-nums">⌘ ↩</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CanvasSidebarHud() {
  const repoPath = useRepoPath()
  return (
    <SidebarHud
      left={<LeftSidebarTabs repoPath={repoPath} />}
      center={<DiffPreviewTabs />}
      right={<FileTree />}
    />
  )
}

function CanvasOverlay() {
  return (
    <>
      <CanvasSidebarHud />
      <CommandPalette />
      <TerminalDeleteDialog />
    </>
  )
}

const components: TLComponents = {
  // Our custom context menu: our items at top + tldraw defaults below
  ContextMenu: CustomContextMenu,
  // Keep our custom grid + command menu
  Grid: ({ size, ...camera }) => {
    const editor = useEditor()
    const screenBounds = useValue(
      "screenBounds",
      () => editor.getViewportScreenBounds(),
      []
    )
    const devicePixelRatio = useValue(
      "dpr",
      () => editor.getInstanceState().devicePixelRatio,
      []
    )
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
    const lodStepRef = useRef(1)

    const draw = useCallback(() => {
      const el = canvasRef.current
      if (!el) return

      if (!ctxRef.current) {
        ctxRef.current = el.getContext("2d")
      }
      const ctx = ctxRef.current
      if (!ctx) return

      const dpr = devicePixelRatio
      const canvasW = screenBounds.w * dpr
      const canvasH = screenBounds.h * dpr

      if (el.width !== canvasW || el.height !== canvasH) {
        el.width = canvasW
        el.height = canvasH
      }

      ctx.clearRect(0, 0, canvasW, canvasH)

      // LOD quantization keeps dot spacing perceptually consistent across zoom levels.
      const idealStep = GRID_TARGET_PX / Math.max(camera.z, 0.0001)
      const lodStep = Math.max(1, 2 ** Math.round(Math.log2(idealStep / size)))
      const stepSize = size * lodStep
      const lodStepPx = stepSize * camera.z

      if (lodStepPx < GRID_LOD_MIN_PX) {
        lodStepRef.current = lodStepRef.current * 2
      } else if (lodStepPx > GRID_LOD_MAX_PX && lodStepRef.current > 1) {
        lodStepRef.current = lodStepRef.current / 2
      } else {
        lodStepRef.current = lodStep
      }

      const quantizedStepSize = size * lodStepRef.current

      const pageViewportBounds = editor.getViewportPageBounds()
      const startPageX =
        Math.ceil(pageViewportBounds.minX / quantizedStepSize) *
        quantizedStepSize
      const startPageY =
        Math.ceil(pageViewportBounds.minY / quantizedStepSize) *
        quantizedStepSize
      const endPageX =
        Math.floor(pageViewportBounds.maxX / quantizedStepSize) *
        quantizedStepSize
      const endPageY =
        Math.floor(pageViewportBounds.maxY / quantizedStepSize) *
        quantizedStepSize
      const numRows = Math.round((endPageY - startPageY) / quantizedStepSize)
      const numCols = Math.round((endPageX - startPageX) / quantizedStepSize)

      const stepPx = quantizedStepSize * camera.z
      const dotRadiusPx = Math.max(
        DOT_MIN_RADIUS,
        Math.min(DOT_MAX_RADIUS, stepPx * 0.05)
      )
      const outerR = dotRadiusPx * dpr
      const innerR = outerR * 0.52
      const [br, bg, bb] = BASE_DOT_COLOR
      const outerFill = `rgba(${br},${bg},${bb},${DOT_OUTER_ALPHA})`
      const innerFill = `rgba(${br},${bg},${bb},${DOT_INNER_ALPHA})`

      ctx.fillStyle = outerFill
      ctx.shadowColor = "transparent"
      ctx.shadowBlur = 0
      ctx.beginPath()

      for (let row = 0; row <= numRows; row++) {
        for (let col = 0; col <= numCols; col++) {
          const pageX = startPageX + col * quantizedStepSize
          const pageY = startPageY + row * quantizedStepSize
          const cx = (pageX + camera.x) * camera.z * dpr
          const cy = (pageY + camera.y) * camera.z * dpr
          ctx.moveTo(cx + outerR, cy)
          ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
        }
      }

      ctx.fill()

      ctx.fillStyle = innerFill
      ctx.beginPath()
      for (let row = 0; row <= numRows; row++) {
        for (let col = 0; col <= numCols; col++) {
          const pageX = startPageX + col * quantizedStepSize
          const pageY = startPageY + row * quantizedStepSize
          const cx = (pageX + camera.x) * camera.z * dpr
          const cy = (pageY + camera.y) * camera.z * dpr
          ctx.moveTo(cx + innerR, cy)
          ctx.arc(cx, cy, innerR, 0, Math.PI * 2)
        }
      }
      ctx.fill()

      ctx.shadowColor = "transparent"
      ctx.shadowBlur = 0
    }, [screenBounds, camera, size, devicePixelRatio, editor])

    useLayoutEffect(() => {
      draw()
    }, [draw])

    return <canvas className="tl-grid" ref={canvasRef} />
  },
  InFrontOfTheCanvas: CanvasOverlay,
  Toolbar: CustomToolbar,
  MainMenu: null,
  PageMenu: null,
  NavigationPanel: null,
  StylePanel: null,
  ActionsMenu: null,
  HelpMenu: null,
  ZoomMenu: null,
  Minimap: null,
  DebugPanel: null,
  MenuPanel: null,
  TopPanel: null,
  SharePanel: null,
}

function RpcBridge() {
  const editor = useEditor()

  useEffect(() => {
    if (!window.electron?.rpc) return

    const removeCreateTerminal = window.electron.rpc.onCreateTerminal(
      ({ shapeId, x, y, w, h }) => {
        editor.createShape({
          id: shapeId as TLShapeId,
          type: "terminal",
          x,
          y,
          props: { w, h },
        })
      }
    )

    const removeGetShapes = window.electron.rpc.onGetShapes(
      ({ responseChannel }) => {
        const shapes = editor.getCurrentPageShapes().map((s) => ({
          id: s.id,
          type: s.type,
          x: s.x,
          y: s.y,
          props: s.props,
        }))
        window.electron.rpc.respondShapes(responseChannel, shapes)
      }
    )

    const removeNotifications = window.electron.rpc.onNotification(
      ({ method, params }) => {
        if (method === "terminal.created") {
          addTerminalAtCenter(editor, {
            sessionId: params.sessionKey as string,
          })
        } else if (method === "worktree.created") {
          addTerminalAtCenter(editor, { cwd: params.path as string })
        } else if (method === "worktree.removed") {
          const removedPath = params.path as string
          const terminals = editor
            .getCurrentPageShapes()
            .filter((s) => s.type === "terminal")
          const toRemove = terminals
            .filter((s) =>
              cwdUnderRemovedWorktree(
                (s.props as { cwd?: string }).cwd,
                removedPath
              )
            )
            .map((s) => s.id as TLShapeId)
          deleteCanvasShapesAsSync(editor, toRemove)
        }
      }
    )

    return () => {
      removeCreateTerminal()
      removeGetShapes()
      removeNotifications()
    }
  }, [editor])

  return null
}

export function Canvas({ folderPath }: { folderPath: string }) {
  setTerminalCwd(folderPath)

  return (
    <div className="h-screen w-screen">
      <WorktreeIndexProvider repoPath={folderPath}>
        <DiffPreviewTabsProvider>
          <PaletteControllerProvider>
            <Tldraw
              persistenceKey={`ateli:canvas:${folderPath}`}
              components={components}
              shapeUtils={customShapeUtils}
              options={{ gridSteps: [{ min: 1, mid: 1, step: 20 }] }}
              onMount={(editor) => {
                editor.user.updateUserPreferences({ colorScheme: "dark" })
                editor.updateInstanceState({ isGridMode: true })
              }}
            >
              <RpcBridge />
            </Tldraw>
          </PaletteControllerProvider>
        </DiffPreviewTabsProvider>
      </WorktreeIndexProvider>
    </div>
  )
}

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
import { WorktreeIndexProvider } from "@/contexts/worktree-index-context"
import { TerminalShapeUtil, setTerminalCwd } from "@/shapes/terminal-shape"
import { cwdUnderRemovedWorktree } from "@/lib/terminal-worktree-title"
import { getToolbarActions, getContextMenuActions } from "@/lib/tool-registry"
import {
  setRepoPath,
  getRepoPath,
  addTerminalAtCenter,
} from "@/lib/default-actions"
import "@/lib/default-actions"
import { CommandPalette } from "../command-palette/CommandPalette"
import { DiffPreviewTabs } from "./diff-preview-tabs"
import { SidebarHud } from "./sidebar-hud"
import { FileTree } from "./file-tree"
import { LeftSidebarTabs } from "./left-sidebar-tabs"
import { useTerminalKillConfirmation } from "./terminal-kill-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  ZOOM_ANIMATION,
  fitPageBoundsInViewport,
} from "@/lib/canvas-camera"
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

const ZoomControls = track(() => {
  const editor = useEditor()
  const zoom = useValue("canvas-zoom-level", () => editor.getZoomLevel(), [editor])
  const hasSelection = useValue(
    "canvas-has-selection",
    () => editor.getSelectedShapeIds().length > 0,
    [editor]
  )

  const zoomSteps = editor.getCameraOptions().zoomSteps
  const minZoom = zoomSteps[0] ?? 0.1
  const maxZoom = zoomSteps[zoomSteps.length - 1] ?? 8
  const clampedZoom = Math.min(maxZoom, Math.max(minZoom, zoom))
  const zoomPercent = Math.round(clampedZoom * 100)
  const isAtMinZoom = clampedZoom <= minZoom + 0.001
  const isAtMaxZoom = clampedZoom >= maxZoom - 0.001
  const laneRef = useRef<HTMLDivElement>(null)

  function getLaneScreenRect() {
    const rect = laneRef.current?.getBoundingClientRect()
    if (rect && rect.width > 0 && rect.height > 0) return rect

    const viewport = editor.getViewportScreenBounds()
    return {
      left: viewport.x,
      top: viewport.y,
      width: viewport.w,
      height: viewport.h,
    }
  }

  function getLaneScreenCenter() {
    const rect = getLaneScreenRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  }

  function getLaneScreenPoint() {
    const center = getLaneScreenCenter()
    const point = editor.getViewportScreenCenter().clone()
    point.x = center.x
    point.y = center.y
    return point
  }

  function fitBoundsToLane(
    bounds: { x: number; y: number; w: number; h: number },
    fitOpts?: { maxTargetZoom?: number; zoomOutFactor?: number },
  ) {
    const r = getLaneScreenRect()
    const screenRect = { x: r.left, y: r.top, w: r.width, h: r.height }
    fitPageBoundsInViewport(editor, bounds, { ...fitOpts, screenRect })
  }

  return (
    <div className="pointer-events-none absolute inset-0" ref={laneRef}>
      <div className="absolute bottom-0 left-0 m-3 flex items-center gap-2">
        <div className="pointer-events-auto inline-flex items-center gap-0.5 rounded-lg border border-border bg-popover/90 p-1 shadow-lg backdrop-blur-md">
          <button
            className="flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isAtMinZoom}
            onClick={() =>
              editor.zoomOut(getLaneScreenPoint(), {
                animation: ZOOM_ANIMATION,
              })
            }
            title="Zoom out"
          >
            -
          </button>
          <button
            className="min-w-12 rounded-sm px-2 py-1 text-center text-xs font-medium tabular-nums text-foreground/90 transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() =>
              editor.resetZoom(getLaneScreenPoint(), {
                animation: ZOOM_ANIMATION,
              })
            }
            title="Reset zoom to 100%"
          >
            {zoomPercent}%
          </button>
          <button
            className="flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isAtMaxZoom}
            onClick={() =>
              editor.zoomIn(getLaneScreenPoint(), {
                animation: ZOOM_ANIMATION,
              })
            }
            title="Zoom in"
          >
            +
          </button>
        </div>

        <div className="pointer-events-auto inline-flex items-center gap-0.5 rounded-lg border border-border bg-popover/90 p-1 shadow-lg backdrop-blur-md">
          <button
            className="rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              const bounds = editor.getCurrentPageBounds()
              if (!bounds) return
              fitBoundsToLane(bounds)
            }}
            title="Zoom to fit"
          >
            Fit
          </button>
          <button
            className="rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!hasSelection}
            onClick={() => {
              const bounds = editor.getSelectionPageBounds()
              if (!bounds) return
              fitBoundsToLane(bounds, { maxTargetZoom: 1, zoomOutFactor: 0.9 })
            }}
            title={
              hasSelection
                ? "Zoom to selection"
                : "Select shapes to zoom to selection"
            }
          >
            Sel
          </button>
        </div>
      </div>
    </div>
  )
})

const CustomToolbar = track(() => {
  const editor = useEditor()
  const tools = useTools()
  const currentToolId = editor.getCurrentToolId()
  const customActions = getToolbarActions()

  return (
    <div className="pointer-events-none absolute inset-0 z-[300] font-sans">
      <div className="pointer-events-none absolute bottom-0 left-0 flex w-full items-center justify-center p-3">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border bg-popover/90 p-1 shadow-lg backdrop-blur-md">
          {TOOLBAR_TOOL_IDS.map((id) => {
            const tool = tools[id]
            if (!tool) return null
            const isActive = currentToolId === id
            return (
              <button
                key={id}
                className={`flex size-8 items-center justify-center rounded-sm transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
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
          <div className="mx-0.5 h-5 w-px bg-border" />
          {customActions.map((action) => (
            <button
              key={action.id}
              className="flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => action.execute(editor)}
              title={action.label}
            >
              <action.icon className="size-4" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
})

function CustomContextMenu(props: TLUiContextMenuProps) {
  const editor = useEditor()
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
                onSelect={() => action.execute(editor)}
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
  const allowDeleteRef = useRef<Set<TLShapeId>>(new Set())

  useEffect(() => {
    return editor.sideEffects.registerBeforeDeleteHandler(
      "shape",
      (shape, source) => {
        if (shape.type !== "terminal") return
        if (source !== "user") return
        if (!shape.props.sessionId) return
        const shapeId = shape.id as TLShapeId
        if (allowDeleteRef.current.has(shapeId)) {
          allowDeleteRef.current.delete(shapeId)
          return
        }

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

    for (const id of ids) {
      allowDeleteRef.current.add(id)
    }

    editor.deleteShapes(ids)
    setPendingTerminalIds([])
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
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
          </Button>
          <Button variant="destructive" onClick={onConfirmDelete}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const SidebarHudWithSelection = track(function SidebarHudWithSelection() {
  const editor = useEditor()
  const hasCanvasSelection = useValue(
    "right-sidebar-selection",
    () => editor.getSelectedShapeIds().length > 0,
    [editor]
  )

  return (
    <SidebarHud
      left={<LeftSidebarTabs repoPath={getRepoPath()} />}
      center={<DiffPreviewTabs />}
      centerOverlay={<ZoomControls />}
      right={hasCanvasSelection ? <FileTree /> : undefined}
    />
  )
})

function CanvasOverlay() {
  return (
    <>
      <SidebarHudWithSelection />
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
          editor.store.mergeRemoteChanges(() => {
            editor.deleteShapes(toRemove)
          })
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
  setRepoPath(folderPath)

  return (
    <div className="h-screen w-screen">
      <WorktreeIndexProvider repoPath={folderPath}>
        <DiffPreviewTabsProvider>
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
        </DiffPreviewTabsProvider>
      </WorktreeIndexProvider>
    </div>
  )
}

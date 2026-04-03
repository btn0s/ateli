import { useEffect, useLayoutEffect, useRef, useCallback } from "react"
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
import type { TLComponents, TLShapeId, TLUiContextMenuProps, TLUiIconType } from "tldraw"
import "tldraw/tldraw.css"
import { TerminalShapeUtil, setTerminalCwd } from "@/shapes/terminal-shape"
import { getToolbarActions, getContextMenuActions } from "@/lib/tool-registry"
import { setRepoPath } from "@/lib/default-actions"
import "@/lib/default-actions"
import { CommandMenu } from "./command-menu"

const customShapeUtils = [TerminalShapeUtil]

// Spotlight config
const GLOW_RADIUS = 80
const DOT_BASE_ALPHA = 0.12
const DOT_BASE_RADIUS = 1
const DOT_MAX_RADIUS = 1.8
const DOT_REPEL = 4
const GLOW_COLOR = [210, 210, 220] as const
const BASE_DOT_COLOR = [255, 255, 255] as const
const SMOOTHING = 0.07
const FADE_SPEED = 0.03
const GRID_TARGET_PX = 20
const GRID_LOD_MIN_PX = 14
const GRID_LOD_MAX_PX = 28

// tldraw tools to show in our toolbar, in order
const TOOLBAR_TOOL_IDS = [
  "select", "hand", "draw", "eraser", "arrow", "text", "frame", "note",
]

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
                <TldrawUiIcon icon={tool.icon as TLUiIconType} small />
              </button>
            )
          })}
          <div className="bg-border mx-0.5 h-5 w-px" />
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

  return (
    <DefaultContextMenu {...props}>
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
      [],
    )
    const devicePixelRatio = useValue(
      "dpr",
      () => editor.getInstanceState().devicePixelRatio,
      [],
    )
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
    const mouseRef = useRef<{ x: number; y: number } | null>(null)
    const smoothMouseRef = useRef<{ x: number; y: number } | null>(null)
    const fadeRef = useRef(0)
    const pointerInsideRef = useRef(false)
    const rafRef = useRef<number>(0)
    const runningRef = useRef(true)
    const drawRef = useRef<() => void>()
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

      const tm = mouseRef.current
      const hasPointer = tm !== null

      if (hasPointer) {
        if (!smoothMouseRef.current) {
          smoothMouseRef.current = { x: tm.x, y: tm.y }
        } else {
          smoothMouseRef.current.x += (tm.x - smoothMouseRef.current.x) * SMOOTHING
          smoothMouseRef.current.y += (tm.y - smoothMouseRef.current.y) * SMOOTHING
        }
      }

      if (pointerInsideRef.current) {
        fadeRef.current = Math.min(1, fadeRef.current + FADE_SPEED)
      } else {
        fadeRef.current = Math.max(0, fadeRef.current - FADE_SPEED)
      }

      const sm = smoothMouseRef.current

      // LOD quantization keeps dot spacing perceptually consistent across zoom levels.
      const idealStep = GRID_TARGET_PX / Math.max(camera.z, 0.0001)
      const lodStep = Math.max(1, 2 ** Math.round(Math.log2(idealStep / size)))
      const stepSize = size * lodStep
      const stepPx = stepSize * camera.z

      if (stepPx < GRID_LOD_MIN_PX) {
        lodStepRef.current = lodStepRef.current * 2
      } else if (stepPx > GRID_LOD_MAX_PX && lodStepRef.current > 1) {
        lodStepRef.current = lodStepRef.current / 2
      } else {
        lodStepRef.current = lodStep
      }

      const quantizedStepSize = size * lodStepRef.current

      const pageViewportBounds = editor.getViewportPageBounds()
      const startPageX = Math.ceil(pageViewportBounds.minX / quantizedStepSize) * quantizedStepSize
      const startPageY = Math.ceil(pageViewportBounds.minY / quantizedStepSize) * quantizedStepSize
      const endPageX = Math.floor(pageViewportBounds.maxX / quantizedStepSize) * quantizedStepSize
      const endPageY = Math.floor(pageViewportBounds.maxY / quantizedStepSize) * quantizedStepSize
      const numRows = Math.round((endPageY - startPageY) / quantizedStepSize)
      const numCols = Math.round((endPageX - startPageX) / quantizedStepSize)

      const mx = sm ? sm.x * dpr : 0
      const my = sm ? sm.y * dpr : 0
      const fade = fadeRef.current
      const glowR = GLOW_RADIUS * dpr
      const glowR2 = glowR * glowR
      const baseR = DOT_BASE_RADIUS * dpr
      const maxR = DOT_MAX_RADIUS * dpr
      const [gr, gg, gb] = GLOW_COLOR
      const [br, bg, bb] = BASE_DOT_COLOR
      const baseFill = `rgba(${br},${bg},${bb},${DOT_BASE_ALPHA})`

      const glowDots: { x: number; y: number; r: number; alpha: number; glow: number }[] = []

      ctx.fillStyle = baseFill
      ctx.shadowColor = "transparent"
      ctx.shadowBlur = 0
      ctx.beginPath()

      for (let row = 0; row <= numRows; row++) {
        for (let col = 0; col <= numCols; col++) {
          const pageX = startPageX + col * quantizedStepSize
          const pageY = startPageY + row * quantizedStepSize
          const cx = (pageX + camera.x) * camera.z * dpr
          const cy = (pageY + camera.y) * camera.z * dpr

          const dx = cx - mx
          const dy = cy - my
          const dist2 = dx * dx + dy * dy
          const t = hasPointer ? Math.max(0, 1 - dist2 / glowR2) : 0
          const glow = t * t * t * fade

          if (glow > 0.01) {
            const dist = Math.sqrt(dist2) || 1
            const push = DOT_REPEL * glow * dpr
            glowDots.push({
              x: cx + (dx / dist) * push,
              y: cy + (dy / dist) * push,
              r: baseR + (maxR - baseR) * glow,
              alpha: DOT_BASE_ALPHA + (1 - DOT_BASE_ALPHA) * glow * 0.35,
              glow,
            })
          } else {
            ctx.moveTo(cx + baseR, cy)
            ctx.arc(cx, cy, baseR, 0, Math.PI * 2)
          }
        }
      }

      ctx.fill()

      for (const dot of glowDots) {
        ctx.fillStyle = `rgba(${gr},${gg},${gb},${dot.alpha})`
        ctx.shadowColor = `rgba(${gr},${gg},${gb},${dot.glow * 0.07})`
        ctx.shadowBlur = 2.5 * dot.glow * dpr
        ctx.beginPath()
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.shadowColor = "transparent"
      ctx.shadowBlur = 0

      const delta = sm && tm ? Math.abs(sm.x - tm.x) + Math.abs(sm.y - tm.y) : 0
      const fading = fadeRef.current > 0 && fadeRef.current < 1
      if ((delta > 0.5 || fading) && runningRef.current) {
        rafRef.current = requestAnimationFrame(draw)
      }
    }, [screenBounds, camera, size, devicePixelRatio, editor])

    drawRef.current = draw

    useLayoutEffect(() => {
      draw()
    }, [draw])

    useEffect(() => {
      runningRef.current = true

      function scheduleFrame() {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => drawRef.current?.())
      }

      function onMouseMove(e: MouseEvent) {
        pointerInsideRef.current = true
        if (!mouseRef.current) {
          mouseRef.current = { x: e.clientX, y: e.clientY }
        } else {
          mouseRef.current.x = e.clientX
          mouseRef.current.y = e.clientY
        }
        scheduleFrame()
      }

      function onMouseLeave() {
        pointerInsideRef.current = false
        scheduleFrame()
      }

      window.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseleave", onMouseLeave)
      return () => {
        runningRef.current = false
        window.removeEventListener("mousemove", onMouseMove)
        document.removeEventListener("mouseleave", onMouseLeave)
        cancelAnimationFrame(rafRef.current)
      }
    }, [])

    return <canvas className="tl-grid" ref={canvasRef} />
  },
  InFrontOfTheCanvas: CommandMenu,
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

    const removeCreateTerminal = window.electron.rpc.onCreateTerminal(({ shapeId, x, y, w, h }) => {
      editor.createShape({
        id: shapeId as TLShapeId,
        type: "terminal",
        x,
        y,
        props: { w, h },
      })
    })

    const removeGetShapes = window.electron.rpc.onGetShapes(({ responseChannel }) => {
      const shapes = editor.getCurrentPageShapes().map((s) => ({
        id: s.id,
        type: s.type,
        x: s.x,
        y: s.y,
        props: s.props,
      }))
      window.electron.rpc.respondShapes(responseChannel, shapes)
    })

    const removeNotifications = window.electron.rpc.onNotification(({ method, params }) => {
      if (method === "worktree.created") {
        const center = editor.getViewportPageBounds().center
        editor.createShape({
          type: "terminal",
          x: center.x - 300,
          y: center.y - 200,
          props: {
            cwd: params.path as string,
          },
        })
      }
    })

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
      <Tldraw
        persistenceKey={`ateli:canvas:${folderPath}`}
        components={components}
        shapeUtils={customShapeUtils}
        options={{ gridSteps: [{ min: 1, step: 20 }] }}
        onMount={(editor) => {
          editor.user.updateUserPreferences({ colorScheme: "dark" })
          editor.updateInstanceState({ isGridMode: true })
        }}
      >
        <RpcBridge />
      </Tldraw>
    </div>
  )
}

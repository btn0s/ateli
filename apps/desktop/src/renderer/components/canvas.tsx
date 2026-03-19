import { useEffect, useLayoutEffect, useRef, useCallback } from "react"
import {
  Tldraw,
  track,
  useEditor,
  useValue,
  useIsDarkMode,
} from "tldraw"
import type { TLComponents } from "tldraw"
import "tldraw/tldraw.css"
import {
  MousePointer2,
  Pencil,
  Eraser,
  MoveRight,
  Type,
} from "lucide-react"
import { Toggle } from "@workspace/ui/components/toggle"

// Spotlight config
const GLOW_RADIUS = 80
const DOT_BASE_ALPHA = 0.12
const DOT_BASE_RADIUS = 1
const DOT_MAX_RADIUS = 1.8
const GLOW_COLOR = [210, 210, 220] as const
const SMOOTHING = 0.07
const FADE_SPEED = 0.03

const components: TLComponents = {
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
    const isDarkMode = useIsDarkMode()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const mouseRef = useRef<{ x: number; y: number } | null>(null)
    const smoothMouseRef = useRef<{ x: number; y: number } | null>(null)
    const fadeRef = useRef(0)
    const pointerInsideRef = useRef(false)
    const rafRef = useRef<number>(0)
    const runningRef = useRef(true)

    const draw = useCallback(() => {
      const el = canvasRef.current
      if (!el) return
      const dpr = devicePixelRatio
      const canvasW = screenBounds.w * dpr
      const canvasH = screenBounds.h * dpr

      if (el.width !== canvasW || el.height !== canvasH) {
        el.width = canvasW
        el.height = canvasH
      }

      const ctx = el.getContext("2d")
      if (!ctx) return

      ctx.clearRect(0, 0, canvasW, canvasH)

      const tm = mouseRef.current
      const hasPointer = tm !== null

      // Snap smooth position on first contact, then lerp
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

      const pageViewportBounds = editor.getViewportPageBounds()
      const startPageX = Math.ceil(pageViewportBounds.minX / size) * size
      const startPageY = Math.ceil(pageViewportBounds.minY / size) * size
      const endPageX = Math.floor(pageViewportBounds.maxX / size) * size
      const endPageY = Math.floor(pageViewportBounds.maxY / size) * size
      const numRows = Math.round((endPageY - startPageY) / size)
      const numCols = Math.round((endPageX - startPageX) / size)

      const mx = sm ? sm.x * dpr : 0
      const my = sm ? sm.y * dpr : 0
      const fade = fadeRef.current
      const glowR = GLOW_RADIUS * dpr
      const glowR2 = glowR * glowR
      const baseR = DOT_BASE_RADIUS * dpr
      const maxR = DOT_MAX_RADIUS * dpr
      const [gr, gg, gb] = GLOW_COLOR
      const baseDotColor = isDarkMode ? "255,255,255" : "0,0,0"

      for (let row = 0; row <= numRows; row++) {
        for (let col = 0; col <= numCols; col++) {
          const pageX = startPageX + col * size
          const pageY = startPageY + row * size
          const cx = (pageX + camera.x) * camera.z * dpr
          const cy = (pageY + camera.y) * camera.z * dpr

          const dx = cx - mx
          const dy = cy - my
          const dist2 = dx * dx + dy * dy
          const t = hasPointer ? Math.max(0, 1 - dist2 / glowR2) : 0

          // Cubic falloff, scaled by fade-in
          const glow = t * t * t * fade

          const r = baseR + (maxR - baseR) * glow
          const alpha = DOT_BASE_ALPHA + (1 - DOT_BASE_ALPHA) * glow * 0.35

          if (glow > 0.01) {
            ctx.fillStyle = `rgba(${gr},${gg},${gb},${alpha})`
            ctx.shadowColor = `rgba(${gr},${gg},${gb},${glow * 0.07})`
            ctx.shadowBlur = 2.5 * glow * dpr
          } else {
            ctx.fillStyle = `rgba(${baseDotColor},${alpha})`
            ctx.shadowColor = "transparent"
            ctx.shadowBlur = 0
          }

          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      ctx.shadowColor = "transparent"
      ctx.shadowBlur = 0

      // Keep animating for smooth interpolation + fade-in
      const delta = sm && tm ? Math.abs(sm.x - tm.x) + Math.abs(sm.y - tm.y) : 0
      const fading = fadeRef.current > 0 && fadeRef.current < 1
      if ((delta > 0.5 || fading) && runningRef.current) {
        rafRef.current = requestAnimationFrame(draw)
      }
    }, [screenBounds, camera, size, devicePixelRatio, editor, isDarkMode])

    useLayoutEffect(() => {
      draw()
    }, [draw])

    useEffect(() => {
      runningRef.current = true
      function onMouseMove(e: MouseEvent) {
        pointerInsideRef.current = true
        mouseRef.current = { x: e.clientX, y: e.clientY }
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(draw)
      }
      function onMouseLeave() {
        pointerInsideRef.current = false
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(draw)
      }
      window.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseleave", onMouseLeave)
      return () => {
        runningRef.current = false
        window.removeEventListener("mousemove", onMouseMove)
        document.removeEventListener("mouseleave", onMouseLeave)
        cancelAnimationFrame(rafRef.current)
      }
    }, [draw])

    return <canvas className="tl-grid" ref={canvasRef} />
  },
}

const tools = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "draw", label: "Draw", icon: Pencil },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "arrow", label: "Arrow", icon: MoveRight },
  { id: "text", label: "Text", icon: Type },
] as const

const CustomUi = track(() => {
  const editor = useEditor()
  const currentTool = editor.getCurrentToolId()

  return (
    <div className="pointer-events-none absolute inset-0 z-[300] font-sans">
      <div className="pointer-events-none absolute bottom-0 left-0 flex w-full items-center justify-center p-3">
        <div className="pointer-events-auto flex items-center gap-0.5 border border-border bg-background/80 p-1 backdrop-blur-sm">
          {tools.map((tool) => (
            <Toggle
              key={tool.id}
              size="sm"
              pressed={currentTool === tool.id}
              onPressedChange={() => editor.setCurrentTool(tool.id)}
              aria-label={tool.label}
            >
              <tool.icon className="size-4" />
            </Toggle>
          ))}
        </div>
      </div>
    </div>
  )
})

export function Canvas({ folderPath: _ }: { folderPath: string }) {
  return (
    <div className="h-screen w-screen">
      <Tldraw
        hideUi
        components={components}
        options={{ gridSteps: [{ min: 1, step: 20 }] }}
        onMount={(editor) => {
          editor.user.updateUserPreferences({ colorScheme: "dark" })
          editor.updateInstanceState({ isGridMode: true })
        }}
      >
        <CustomUi />
      </Tldraw>
    </div>
  )
}

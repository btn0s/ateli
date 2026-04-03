import { useEffect, useRef, useMemo } from "react"
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
  useEditor,
} from "tldraw"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { X, TerminalSquare } from "lucide-react"
import "@xterm/xterm/css/xterm.css"
import { ShapeChrome } from "@/components/shape-chrome"
import type { ShapeChromeAction } from "@/components/shape-chrome"

const TERMINAL_SHAPE_TYPE = "terminal" as const

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [TERMINAL_SHAPE_TYPE]: { w: number; h: number; sidecarSessionId?: string; cwd?: string }
  }
}

type TerminalShape = TLShape<typeof TERMINAL_SHAPE_TYPE>

function getTerminalSize(term: Terminal): { cols: number; rows: number } {
  return {
    cols: Math.max(1, term.cols || 80),
    rows: Math.max(1, term.rows || 24),
  }
}

function TerminalComponent({
  shape,
  isInteractive,
  cwd,
}: {
  shape: TerminalShape
  isInteractive: boolean
  cwd: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionKeyRef = useRef<string | null>(shape.props.sidecarSessionId ?? null)
  const editor = useEditor()

  useEffect(() => {
    if (!containerRef.current) return

    const shapeId = shape.id
    const existingSessionId = shape.props.sidecarSessionId
    const state = {
      disposed: false,
      sessionKey: existingSessionId ?? (null as string | null),
      removeData: null as null | (() => void),
      removeExit: null as null | (() => void),
      disposeTermData: null as null | (() => void),
      disposeTermResize: null as null | (() => void),
    }

    const term = new Terminal({
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      theme: {
        background: "#1a1a1a",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        selectionBackground: "#ffffff30",
        black: "#1a1a1a",
        brightBlack: "#555555",
        white: "#e0e0e0",
        brightWhite: "#ffffff",
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    function attachSession(sessionKey: string) {
      state.sessionKey = sessionKey
      sessionKeyRef.current = sessionKey
      state.removeData?.()
      state.removeExit?.()
      state.disposeTermData?.()
      state.disposeTermResize?.()

      state.removeData = window.electron.terminal.onData(sessionKey, (data) => {
        term.write(data)
      })

      state.removeExit = window.electron.terminal.onExit(sessionKey, () => {
        state.disposed = true
        editor.deleteShape(shapeId)
      })

      const onResizeDisposable = term.onResize(({ cols, rows }) => {
        if (!state.disposed && state.sessionKey) {
          window.electron.terminal.resize(state.sessionKey, cols, rows)
        }
      })
      state.disposeTermResize = () => onResizeDisposable.dispose()

      const onDataDisposable = term.onData((data) => {
        if (!state.disposed && state.sessionKey) {
          window.electron.terminal.write(state.sessionKey, data)
        }
      })
      state.disposeTermData = () => onDataDisposable.dispose()

      fitAddon.fit()
      const { cols, rows } = getTerminalSize(term)
      window.electron.terminal.resize(sessionKey, cols, rows)
    }

    ;(async () => {
      try {
        if (existingSessionId) {
          try {
            const { cols, rows } = getTerminalSize(term)
            await window.electron.terminal.reconnect(
              existingSessionId,
              cols,
              rows,
            )
            if (state.disposed) return
            attachSession(existingSessionId)
            return
          } catch {
            editor.updateShape<TerminalShape>({
              id: shapeId,
              type: TERMINAL_SHAPE_TYPE,
              props: { sidecarSessionId: undefined },
            })
          }
        }

        const { sessionKey } = await window.electron.terminal.create(shapeId, cwd)
        if (state.disposed) {
          window.electron.terminal.dispose(sessionKey)
          return
        }

        editor.updateShape<TerminalShape>({
          id: shapeId,
          type: TERMINAL_SHAPE_TYPE,
          props: { sidecarSessionId: sessionKey },
        })

        attachSession(sessionKey)
      } catch (err: unknown) {
        term.write(`\r\nFailed to create terminal: ${err}\r\n`)
      }
    })()

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      if (!state.disposed && state.sessionKey) {
        const { cols, rows } = getTerminalSize(term)
        window.electron.terminal.resize(state.sessionKey, cols, rows)
      }
    })
    observer.observe(containerRef.current)

    return () => {
      state.disposed = true
      observer.disconnect()
      state.removeData?.()
      state.removeExit?.()
      state.disposeTermData?.()
      state.disposeTermResize?.()
      if (state.sessionKey) {
        window.electron.terminal.detach(state.sessionKey)
      }
      term.dispose()
    }
  }, [cwd, shape.id])

  useEffect(() => {
    fitRef.current?.fit()
  }, [shape.props.w, shape.props.h])

  useEffect(() => {
    if (isInteractive) {
      termRef.current?.focus()
    } else {
      termRef.current?.blur()
    }
  }, [isInteractive, shape.id])

  useEffect(() => {
    if (!isInteractive) return
    const el = containerRef.current
    if (!el) return

    const stopBubble = (e: Event) => {
      e.stopPropagation()
    }

    el.addEventListener("keydown", stopBubble)
    el.addEventListener("keyup", stopBubble)
    el.addEventListener("keypress", stopBubble)
    el.addEventListener("pointerdown", stopBubble)
    el.addEventListener("touchstart", stopBubble)
    el.addEventListener("touchend", stopBubble)

    return () => {
      el.removeEventListener("keydown", stopBubble)
      el.removeEventListener("keyup", stopBubble)
      el.removeEventListener("keypress", stopBubble)
      el.removeEventListener("pointerdown", stopBubble)
      el.removeEventListener("touchstart", stopBubble)
      el.removeEventListener("touchend", stopBubble)
    }
  }, [isInteractive])

  const titleText = shape.props.cwd
    ? shape.props.cwd.split("/").pop() || "Terminal"
    : "Terminal"

  const actions: ShapeChromeAction[] = useMemo(() => [
    {
      id: "close",
      icon: X,
      label: "Close terminal",
      onClick: () => {
        if (sessionKeyRef.current) {
          window.electron.terminal.dispose(sessionKeyRef.current)
        }
      },
    },
  ], [])

  return (
    <ShapeChrome
      title={titleText}
      icon={TerminalSquare}
      actions={actions}
      isInteractive={isInteractive}
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          padding: 8,
          background: "#1a1a1a",
          overflow: "hidden",
        }}
      />
    </ShapeChrome>
  )
}

let _cwd = ""

export function setTerminalCwd(cwd: string) {
  _cwd = cwd
}

export class TerminalShapeUtil extends BaseBoxShapeUtil<TerminalShape> {
  static override type = TERMINAL_SHAPE_TYPE
  static override props: RecordProps<TerminalShape> = {
    w: T.number,
    h: T.number,
    sidecarSessionId: T.string.optional(),
    cwd: T.string.optional(),
  }

  override canEdit() {
    return true
  }

  override canResize() {
    return true
  }

  getDefaultProps(): TerminalShape["props"] {
    return { w: 600, h: 400 }
  }

  component(shape: TerminalShape) {
    const selectedIds = this.editor.getSelectedShapeIds()
    const isSoleSelected =
      selectedIds.length === 1 && selectedIds[0] === shape.id
    const isEditing = this.editor.getEditingShapeId() === shape.id
    const isInteractive = isEditing || isSoleSelected

    return (
      <HTMLContainer
        id={shape.id}
        style={{ pointerEvents: isInteractive ? "all" : "none" }}
      >
        <TerminalComponent shape={shape} isInteractive={isInteractive} cwd={shape.props.cwd || _cwd} />
      </HTMLContainer>
    )
  }

  indicator(shape: TerminalShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}

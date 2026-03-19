import { useEffect, useRef } from "react"
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
} from "tldraw"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"

const TERMINAL_SHAPE_TYPE = "terminal" as const

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [TERMINAL_SHAPE_TYPE]: { w: number; h: number }
  }
}

type TerminalShape = TLShape<typeof TERMINAL_SHAPE_TYPE>

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

  useEffect(() => {
    if (!containerRef.current) return

    const shapeId = shape.id
    const state = {
      disposed: false,
      sessionKey: null as string | null,
      removeData: null as null | (() => void),
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

    term.onResize(({ cols, rows }) => {
      const sk = state.sessionKey
      if (!state.disposed && sk) {
        window.electron.terminal.resize(sk, cols, rows)
      }
    })

    ;(async () => {
      try {
        const { sessionKey } = await window.electron.terminal.create(shapeId, cwd)
        if (state.disposed) {
          window.electron.terminal.dispose(sessionKey)
          return
        }
        state.sessionKey = sessionKey
        state.removeData = window.electron.terminal.onData(sessionKey, (data) => {
          term.write(data)
        })

        fitAddon.fit()
        const dim = term.dimensions
        if (dim) {
          window.electron.terminal.resize(sessionKey, dim.cols, dim.rows)
        }
        term.onData((data) => {
          if (!state.disposed) {
            window.electron.terminal.write(sessionKey, data)
          }
        })
      } catch (err: unknown) {
        term.write(`\r\nFailed to create terminal: ${err}\r\n`)
      }
    })()

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
    })
    observer.observe(containerRef.current)

    return () => {
      state.disposed = true
      observer.disconnect()
      state.removeData?.()
      if (state.sessionKey) {
        window.electron.terminal.dispose(state.sessionKey)
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

  // tldraw registers key handlers on the editor container in the bubble phase.
  // Stop bubbling here only after xterm's textarea has handled the event (do
  // not use capture phase stop—it blocks keys from reaching the textarea).
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

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        padding: 8,
        background: "#1a1a1a",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border)",
        boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      }}
    />
  )
}

// Store cwd at module level so the shape util can access it
let _cwd = ""

export function setTerminalCwd(cwd: string) {
  _cwd = cwd
}

export class TerminalShapeUtil extends BaseBoxShapeUtil<TerminalShape> {
  static override type = TERMINAL_SHAPE_TYPE
  static override props: RecordProps<TerminalShape> = {
    w: T.number,
    h: T.number,
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
        <TerminalComponent shape={shape} isInteractive={isInteractive} cwd={_cwd} />
      </HTMLContainer>
    )
  }

  indicator(shape: TerminalShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />
  }
}

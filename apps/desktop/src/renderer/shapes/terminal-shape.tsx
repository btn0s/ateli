import { useEffect, useRef } from "react"
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  useEditor,
} from "tldraw"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { TerminalSquare } from "lucide-react"
import "@xterm/xterm/css/xterm.css"
import { ShapeChrome } from "@/components/shape-chrome"
import { buildXtermTheme } from "@/lib/xterm-theme"
import {
  isTerminalKillShortcut,
  useTerminalKillConfirmation,
} from "@/components/terminal-kill-dialog"
import { useTerminalSessionStore } from "@/contexts/terminal-session-store"
import { useWorktrees } from "@/contexts/worktree-index-context"
import { deleteCanvasShapesAsSync } from "@/lib/canvas-delete-shapes"
import { terminalTitleFromCwd } from "@/lib/terminal-worktree-title"

const TERMINAL_SHAPE_TYPE = "terminal" as const

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [TERMINAL_SHAPE_TYPE]: {
      w: number
      h: number
      sessionId?: string
      cwd?: string
      initialCommand?: string
    }
  }
}

type TerminalShape = TLShape<typeof TERMINAL_SHAPE_TYPE>

const terminalShapeVersions = createShapePropsMigrationIds(
  TERMINAL_SHAPE_TYPE,
  {
    RenameSidecarSessionId: 1,
    AddInitialCommand: 2,
  }
)

const terminalShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: terminalShapeVersions.RenameSidecarSessionId,
      up: (props: { sessionId?: string; sidecarSessionId?: string }) => {
        if (!props.sessionId && props.sidecarSessionId) {
          props.sessionId = props.sidecarSessionId
        }
        delete props.sidecarSessionId
      },
      down: (props: { sessionId?: string; sidecarSessionId?: string }) => {
        if (!props.sidecarSessionId && props.sessionId) {
          props.sidecarSessionId = props.sessionId
        }
        delete props.sessionId
      },
    },
    {
      id: terminalShapeVersions.AddInitialCommand,
      up: (_props: { initialCommand?: string }) => {},
      down: (props: { initialCommand?: string }) => {
        delete props.initialCommand
      },
    },
  ],
})

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
  const worktrees = useWorktrees()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeSessionIdRef = useRef<string | null>(
    shape.props.sessionId ?? null
  )
  const editor = useEditor()
  const sessions = useTerminalSessionStore()
  const { requestKill, dialog } = useTerminalKillConfirmation()

  useEffect(() => {
    if (!containerRef.current) return

    const shapeId = shape.id
    const existingSessionId = shape.props.sessionId
    const state = {
      disposed: false,
      sessionId: existingSessionId ?? (null as string | null),
      unsubscribeSession: null as null | (() => void),
      disposeTermData: null as null | (() => void),
      disposeTermResize: null as null | (() => void),
      closeTimer: null as number | null,
    }

    const term = new Terminal({
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      theme: buildXtermTheme("card"),
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    function attachSession(sessionId: string) {
      state.sessionId = sessionId
      activeSessionIdRef.current = sessionId
      state.unsubscribeSession?.()
      state.disposeTermData?.()
      state.disposeTermResize?.()

      state.unsubscribeSession = sessions.subscribe(sessionId, {
        onData: (data: string) => {
          term.write(data)
        },
        onExit: ({ killed }) => {
          state.disposed = true
          state.sessionId = null
          activeSessionIdRef.current = null

          const closeShape = () => {
            deleteCanvasShapesAsSync(editor, [shapeId])
          }

          if (killed) {
            state.closeTimer = window.setTimeout(closeShape, 450)
          } else {
            closeShape()
          }
        },
      })

      const onResizeDisposable = term.onResize(({ cols, rows }) => {
        if (!state.disposed && state.sessionId) {
          sessions.resize(state.sessionId, cols, rows)
        }
      })
      state.disposeTermResize = () => onResizeDisposable.dispose()

      const onDataDisposable = term.onData((data) => {
        if (!state.disposed && state.sessionId) {
          sessions.write(state.sessionId, data)
        }
      })
      state.disposeTermData = () => onDataDisposable.dispose()

      fitAddon.fit()
      const { cols, rows } = getTerminalSize(term)
      sessions.resize(sessionId, cols, rows)
    }

    const initialCommand = shape.props.initialCommand

    ;(async () => {
      try {
        let sessionId: string | null = null
        let sessionIsBrandNew = false
        if (existingSessionId) {
          try {
            const { cols, rows } = getTerminalSize(term)
            const session = await sessions.attach({
              existingSessionId,
              ownerId: shapeId,
              cwd,
              cols,
              rows,
            })
            sessionId = session.sessionId
          } catch {
            if (!state.disposed) {
              editor.updateShape<TerminalShape>({
                id: shapeId,
                type: TERMINAL_SHAPE_TYPE,
                props: { sessionId: undefined },
              })
            }
          }
        }

        if (state.disposed) return

        if (!sessionId) {
          const { cols, rows } = getTerminalSize(term)
          const session = await sessions.attach({
            ownerId: shapeId,
            cwd,
            cols,
            rows,
          })
          sessionId = session.sessionId
          sessionIsBrandNew = true
        }

        if (!sessionId) return

        if (state.disposed) {
          sessions.detach(sessionId)
          return
        }

        const shouldRunInitialCommand = Boolean(
          sessionIsBrandNew && initialCommand
        )
        const nextSessionId =
          shape.props.sessionId !== sessionId ? sessionId : undefined
        if (nextSessionId !== undefined || shouldRunInitialCommand) {
          editor.updateShape<TerminalShape>({
            id: shapeId,
            type: TERMINAL_SHAPE_TYPE,
            props: {
              ...(nextSessionId !== undefined
                ? { sessionId: nextSessionId }
                : {}),
              ...(shouldRunInitialCommand
                ? { initialCommand: undefined }
                : {}),
            },
          })
        }

        attachSession(sessionId)

        if (shouldRunInitialCommand) {
          sessions.write(sessionId, `${initialCommand}\n`)
        }
      } catch (err: unknown) {
        term.write(`\r\nFailed to create terminal: ${err}\r\n`)
      }
    })()

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      if (!state.disposed && state.sessionId) {
        const { cols, rows } = getTerminalSize(term)
        sessions.resize(state.sessionId, cols, rows)
      }
    })
    observer.observe(containerRef.current)

    return () => {
      state.disposed = true
      observer.disconnect()
      state.unsubscribeSession?.()
      state.disposeTermData?.()
      state.disposeTermResize?.()
      if (state.closeTimer !== null) {
        window.clearTimeout(state.closeTimer)
      }
      if (state.sessionId) {
        sessions.detach(state.sessionId)
      }
      activeSessionIdRef.current = null
      term.dispose()
    }
  }, [cwd, shape.id, sessions])

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

  useEffect(() => {
    if (!isInteractive) return

    function onKeyDown(event: KeyboardEvent) {
      if (!isTerminalKillShortcut(event)) return

      const el = containerRef.current
      if (!el) return

      const target = event.target
      if (target instanceof Node && !el.contains(target)) return

      const sessionId = activeSessionIdRef.current
      if (!sessionId) return

      event.preventDefault()
      event.stopPropagation()
      requestKill({ sessionId })
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    }
  }, [isInteractive, requestKill])

  const titleText = terminalTitleFromCwd(shape.props.cwd, cwd, worktrees)

  return (
    <>
      <ShapeChrome
        title={titleText}
        icon={TerminalSquare}
        isInteractive={isInteractive}
      >
        <div
          ref={containerRef}
          style={{
            width: "100%",
            height: "100%",
            padding: 8,
            background: "var(--card)",
            overflow: "hidden",
          }}
        />
      </ShapeChrome>
      {dialog}
    </>
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
    sessionId: T.string.optional(),
    cwd: T.string.optional(),
    initialCommand: T.string.optional(),
  }
  static override migrations = terminalShapeMigrations

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
        <TerminalComponent
          shape={shape}
          isInteractive={isInteractive}
          cwd={shape.props.cwd || _cwd}
        />
      </HTMLContainer>
    )
  }

  indicator(shape: TerminalShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}

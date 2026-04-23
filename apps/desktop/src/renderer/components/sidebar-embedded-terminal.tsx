import { useEffect, useRef } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import {
  isTerminalKillShortcut,
  useTerminalKillConfirmation,
} from "@/components/terminal-kill-dialog"
import { useTerminalSessionStore } from "@/contexts/terminal-session-store"

function getTerminalSize(term: Terminal): { cols: number; rows: number } {
  return {
    cols: Math.max(1, term.cols || 80),
    rows: Math.max(1, term.rows || 24),
  }
}

/**
 * PTY + xterm for the sidebar (not tied to a canvas shape). Each mount is one session.
 */
export function SidebarEmbeddedTerminal({
  instanceKey,
  cwd,
  onSessionAttached,
  onSessionEnded,
}: {
  instanceKey: string
  cwd: string
  onSessionAttached?: (sessionId: string | null) => void
  onSessionEnded?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const onAttachedRef = useRef(onSessionAttached)
  const onEndedRef = useRef(onSessionEnded)
  const sessions = useTerminalSessionStore()
  const { requestKill, dialog } = useTerminalKillConfirmation()
  onAttachedRef.current = onSessionAttached
  onEndedRef.current = onSessionEnded

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const state = {
      disposed: false,
      sessionId: null as string | null,
      unsubscribeSession: null as null | (() => void),
      disposeTermData: null as null | (() => void),
      disposeTermResize: null as null | (() => void),
      closeTimer: null as number | null,
    }

    const term = new Terminal({
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.35,
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
    term.open(el)
    fitAddon.fit()

    const stopBubble = (e: Event) => {
      e.stopPropagation()
    }
    el.addEventListener("keydown", stopBubble)
    el.addEventListener("keyup", stopBubble)
    el.addEventListener("pointerdown", stopBubble)

    function attachSession(sessionId: string) {
      state.sessionId = sessionId
      activeSessionIdRef.current = sessionId
      onAttachedRef.current?.(sessionId)
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
          onAttachedRef.current?.(null)

          const finish = () => onEndedRef.current?.()
          if (killed) {
            state.closeTimer = window.setTimeout(finish, 450)
          } else {
            term.write("\r\n[Session ended]\r\n")
            finish()
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

    void (async () => {
      try {
        const { cols, rows } = getTerminalSize(term)
        const { sessionId } = await sessions.attach({
          ownerId: `sidebar:${instanceKey}`,
          cwd,
          cols,
          rows,
        })
        if (state.disposed) {
          sessions.detach(sessionId)
          return
        }
        attachSession(sessionId)
      } catch (err: unknown) {
        term.write(`\r\nFailed to start terminal: ${err}\r\n`)
      }
    })()

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      if (!state.disposed && state.sessionId) {
        const { cols, rows } = getTerminalSize(term)
        sessions.resize(state.sessionId, cols, rows)
      }
    })
    observer.observe(el)

    return () => {
      state.disposed = true
      el.removeEventListener("keydown", stopBubble)
      el.removeEventListener("keyup", stopBubble)
      el.removeEventListener("pointerdown", stopBubble)
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
      onAttachedRef.current?.(null)
      term.dispose()
    }
  }, [cwd, instanceKey, sessions])

  useEffect(() => {
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
  }, [requestKill])

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-[#1a1a1a] p-2">
        <div
          ref={containerRef}
          className="min-h-0 w-full flex-1 overflow-hidden"
        />
      </div>
      {dialog}
    </>
  )
}

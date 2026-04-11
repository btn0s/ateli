import { useEffect, useRef } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"

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
  onSessionEnded,
}: {
  instanceKey: string
  cwd: string
  onSessionEnded?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onEndedRef = useRef(onSessionEnded)
  onEndedRef.current = onSessionEnded

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const state = {
      disposed: false,
      sessionKey: null as string | null,
      removeData: null as null | (() => void),
      removeExit: null as null | (() => void),
      disposeTermData: null as null | (() => void),
      disposeTermResize: null as null | (() => void),
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

    function attachSession(sessionKey: string) {
      state.sessionKey = sessionKey
      state.removeData?.()
      state.removeExit?.()
      state.disposeTermData?.()
      state.disposeTermResize?.()

      state.removeData = window.electron.terminal.onData(sessionKey, (data) => {
        term.write(data)
      })

      state.removeExit = window.electron.terminal.onExit(sessionKey, () => {
        state.disposed = true
        state.sessionKey = null
        term.write("\r\n[Session ended]\r\n")
        onEndedRef.current?.()
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

    void (async () => {
      try {
        const { sessionKey } = await window.electron.terminal.create(
          `sidebar:${instanceKey}`,
          cwd,
        )
        if (state.disposed) {
          window.electron.terminal.dispose(sessionKey)
          return
        }
        attachSession(sessionKey)
      } catch (err: unknown) {
        term.write(`\r\nFailed to start terminal: ${err}\r\n`)
      }
    })()

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      if (!state.disposed && state.sessionKey) {
        const { cols, rows } = getTerminalSize(term)
        window.electron.terminal.resize(state.sessionKey, cols, rows)
      }
    })
    observer.observe(el)

    return () => {
      state.disposed = true
      el.removeEventListener("keydown", stopBubble)
      el.removeEventListener("keyup", stopBubble)
      el.removeEventListener("pointerdown", stopBubble)
      observer.disconnect()
      state.removeData?.()
      state.removeExit?.()
      state.disposeTermData?.()
      state.disposeTermResize?.()
      if (state.sessionKey) {
        window.electron.terminal.dispose(state.sessionKey)
      }
      term.dispose()
    }
  }, [cwd, instanceKey])

  return (
    <div
      ref={containerRef}
      className="min-h-32 w-full overflow-hidden border border-border bg-[#1a1a1a]"
      style={{ minHeight: "8rem" }}
    />
  )
}

import { useEffect, useRef, useState } from "react"
import "@xterm/xterm/css/xterm.css"
import { track, useEditor } from "tldraw"
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  MessageSquareText,
  MousePointer2,
  Pencil,
  Eraser,
  MoveRight,
  Send,
  TerminalSquare,
  Type,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { Separator } from "@workspace/ui/components/separator"
import { Textarea } from "@workspace/ui/components/textarea"
import { Toggle } from "@workspace/ui/components/toggle"
import { cn } from "@workspace/ui/lib/utils"
import { setTerminalCwd } from "../shapes/terminal-shape.js"

type WorkspaceTreeNode = {
  name: string
  path: string
  kind: "file" | "directory"
  children?: WorkspaceTreeNode[]
}

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: number
}

const OPEN_BY_DEFAULT = new Set(["src", "apps", "packages", "lib"])

const GITIGNORED_NAMES = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo",
  "coverage", ".cache", ".output", "out", ".idea", ".cursor",
  ".vscode", ".DS_Store", ".env", ".env.local",
])

const TOOLBAR_ITEMS = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "draw", label: "Draw", icon: Pencil },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "arrow", label: "Arrow", icon: MoveRight },
  { id: "text", label: "Text", icon: Type },
] as const

let workspaceRoot = ""

export function setWorkspaceRoot(root: string) {
  workspaceRoot = root
}

function getWorkspaceStorageKey(kind: string) {
  return `ateli:${kind}:${workspaceRoot || "workspace"}`
}

function WorkspaceFileTree({
  root,
  filterRef,
}: {
  root: string
  filterRef: React.RefObject<HTMLInputElement | null>
}) {
  const [tree, setTree] = useState<WorkspaceTreeNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState("")

  useEffect(() => {
    let cancelled = false

    async function loadTree() {
      setTree(null)
      setError(null)

      if (!root) {
        setTree([])
        return
      }

      try {
        const nextTree = await window.electron.workspace.listTree(root, 3)
        if (!cancelled) {
          setTree(nextTree)
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err))
        }
      }
    }

    void loadTree()

    return () => {
      cancelled = true
    }
  }, [root])

  function matchesFilter(node: WorkspaceTreeNode, query: string): boolean {
    if (!query) return true
    const needle = query.toLowerCase()
    if (node.name.toLowerCase().includes(needle)) return true
    if (node.path.toLowerCase().includes(needle)) return true
    return node.children?.some((child) => matchesFilter(child, needle)) ?? false
  }

  function TreeGuides({ depth }: { depth: number }) {
    if (depth === 0) return null
    return (
      <span className="inline-flex shrink-0" style={{ width: depth * 12 }} aria-hidden>
        {Array.from({ length: depth }, (_, i) => (
          <span
            key={i}
            className="absolute top-0 bottom-0 w-px bg-foreground/10"
            style={{ left: i * 12 + 6 }}
          />
        ))}
      </span>
    )
  }

  function renderNode(node: WorkspaceTreeNode, depth: number, query: string) {
    if (!matchesFilter(node, query)) return null

    if (node.kind === "directory") {
      return (
        <details key={node.path} open={OPEN_BY_DEFAULT.has(node.name)} className="group">
          <summary className={cn(
            "relative flex cursor-default list-none items-center gap-1.5 py-1 text-xs",
            GITIGNORED_NAMES.has(node.name) ? "text-foreground/40" : "text-foreground/80",
          )}>
            <TreeGuides depth={depth} />
            <ChevronRight className="size-3.5 group-open:hidden" />
            <ChevronDown className="hidden size-3.5 group-open:block" />
            <Folder className="size-3.5 text-muted-foreground" />
            <span className="truncate">{node.name}</span>
          </summary>
          {node.children?.length
            ? node.children.map((child) => renderNode(child, depth + 1, query))
            : (
              <div className="relative flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
                <TreeGuides depth={depth + 1} />
                <span className="ml-5">Empty folder</span>
              </div>
            )}
        </details>
      )
    }

    return (
      <div
        key={node.path}
        className={cn(
          "relative flex items-center gap-1.5 py-1 text-xs",
          GITIGNORED_NAMES.has(node.name) ? "text-foreground/40" : "text-foreground/75",
        )}
        title={node.path}
      >
        <TreeGuides depth={depth} />
        <FileText className="size-3.5 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border/70 bg-background pt-[var(--titlebar-h)]">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          File Tree
        </div>
      </div>
      <div className="border-b border-border/70 px-3 py-2">
        <div className="relative">
          <Input
            ref={filterRef}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter files"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none text-[10px] text-muted-foreground/40">
            ⌘F
          </kbd>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 py-2">
        {!root ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            Open a workspace to inspect files.
          </div>
        ) : error ? (
          <div className="px-2 py-3 text-xs text-destructive">{error}</div>
        ) : tree === null ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">Loading...</div>
        ) : tree.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">No files found.</div>
        ) : (
          tree.map((node) => renderNode(node, 0, filter.trim()))
        )}
      </div>
    </div>
  )
}

function WorkspaceChat({ root }: { root: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (!root) return []
    const raw = localStorage.getItem(getWorkspaceStorageKey("chat"))
    if (!raw) return []
    try {
      return JSON.parse(raw) as ChatMessage[]
    } catch {
      return []
    }
  })
  const [draft, setDraft] = useState("")
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!root) return
    localStorage.setItem(getWorkspaceStorageKey("chat"), JSON.stringify(messages))
  }, [messages, root])

  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    setDraft("")
    if (!root) {
      setMessages([])
      return
    }

    const raw = localStorage.getItem(getWorkspaceStorageKey("chat"))
    if (!raw) {
      setMessages([
        {
          id: "workspace-welcome",
          role: "assistant",
          content: "Workspace chat is ready.",
          createdAt: Date.now(),
        },
      ])
      return
    }

    try {
      setMessages(JSON.parse(raw) as ChatMessage[])
    } catch {
      setMessages([])
    }
  }, [root])

  function sendMessage() {
    const content = draft.trim()
    if (!content) return

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content,
        createdAt: Date.now(),
      },
    ])
    setDraft("")
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <MessageSquareText className="size-3.5 text-muted-foreground" />
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Workspace Chat
        </div>
      </div>
      <div ref={transcriptRef} className="min-h-0 flex-1 overflow-auto px-3 py-3">
        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex",
                message.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap text-xs leading-relaxed",
                  message.role === "user"
                    ? "rounded-none border border-blue-500/30 bg-blue-500/10 px-2.5 py-2 text-blue-100"
                    : "rounded-none border border-border/70 bg-muted/40 px-2.5 py-2 text-foreground/85",
                )}
              >
                {message.content}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-border/70 p-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              sendMessage()
            }
          }}
          placeholder="Write to the workspace..."
          className="min-h-20 resize-none"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button
            size="sm"
            onClick={sendMessage}
            disabled={!draft.trim()}
            className="active:scale-[0.97] transition-transform duration-100 ease-out"
          >
            <Send className="size-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function WorkspaceTerminal({ root }: { root: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null)
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current || !root) return

    let disposed = false
    let sessionKey: string | null = null
    let removeData: null | (() => void) = null

    async function mountTerminal() {
      const { Terminal } = await import("@xterm/xterm")
      const { FitAddon } = await import("@xterm/addon-fit")

      if (disposed || !containerRef.current) return

      const term = new Terminal({
        fontFamily: "\"Geist Mono\", ui-monospace, monospace",
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
        if (!disposed && sessionKey) {
          window.electron.terminal.resize(sessionKey, cols, rows)
        }
      })

      try {
        const next = await window.electron.terminal.create("workspace-terminal", root)
        if (disposed) {
          window.electron.terminal.dispose(next.sessionKey)
          return
        }

        sessionKey = next.sessionKey
        removeData = window.electron.terminal.onData(sessionKey, (data) => {
          term.write(data)
        })

        fitAddon.fit()
        window.electron.terminal.resize(sessionKey, term.cols, term.rows)

        term.onData((data) => {
          if (!disposed && sessionKey) {
            window.electron.terminal.write(sessionKey, data)
          }
        })
      } catch (err: unknown) {
        term.write(`\r\nFailed to create terminal: ${String(err)}\r\n`)
      }

      const observer = new ResizeObserver(() => {
        fitAddon.fit()
      })
      observer.observe(containerRef.current)

      return () => {
        observer.disconnect()
      }
    }

    let disconnect: null | (() => void) = null
    void mountTerminal().then((cleanup) => {
      disconnect = cleanup ?? null
    })

    return () => {
      disposed = true
      disconnect?.()
      removeData?.()
      if (sessionKey) {
        window.electron.terminal.dispose(sessionKey)
      }
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [root])

  useEffect(() => {
    fitRef.current?.fit()
  }, [root])

  if (!root) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background/90 text-xs text-muted-foreground backdrop-blur-sm">
        Open a workspace to start a terminal.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <TerminalSquare className="size-3.5 text-muted-foreground" />
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Terminal
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}

const CanvasToolbar = track(() => {
  const editor = useEditor()
  const currentTool = editor.getCurrentToolId()

  function addTerminalShape() {
    const center = editor.getViewportPageBounds().center
    editor.createShape({
      type: "terminal",
      x: center.x - 300,
      y: center.y - 200,
    })
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[300] flex justify-center p-3">
      <div className="pointer-events-auto flex items-center gap-0.5 border border-border bg-background/85 p-1 backdrop-blur-sm">
        {TOOLBAR_ITEMS.map((tool) => (
          <Toggle
            key={tool.id}
            size="sm"
            pressed={currentTool === tool.id}
            onPressedChange={() => editor.setCurrentTool(tool.id)}
            aria-label={tool.label}
            className="active:scale-[0.95] transition-[background-color,transform] duration-100 ease-out"
          >
            <tool.icon className="size-4" />
          </Toggle>
        ))}
        <Separator orientation="vertical" className="mx-1 h-4" />
        <Toggle
          size="sm"
          pressed={false}
          onPressedChange={addTerminalShape}
          aria-label="Add Terminal"
          className="active:scale-[0.95] transition-[background-color,transform] duration-100 ease-out"
        >
          <TerminalSquare className="size-4" />
        </Toggle>
      </div>
    </div>
  )
})

export function WorkspaceShell() {
  const root = workspaceRoot
  const workspaceLabel = root || "No workspace"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leftPanelRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rightPanelRef = useRef<any>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === "b") {
        e.preventDefault()
        const panel = leftPanelRef.current
        if (panel) {
          if (panel.isCollapsed()) panel.expand()
          else panel.collapse()
        }
      }
      if (e.metaKey && e.key === "j") {
        e.preventDefault()
        const panel = rightPanelRef.current
        if (panel) {
          if (panel.isCollapsed()) panel.expand()
          else panel.collapse()
        }
      }
      if (e.metaKey && e.key === "f") {
        e.preventDefault()
        if (leftPanelRef.current?.isCollapsed()) {
          leftPanelRef.current.expand()
        }
        requestAnimationFrame(() => {
          filterInputRef.current?.focus()
        })
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const hLayoutKey = getWorkspaceStorageKey("panels-h")
  const vLayoutKey = getWorkspaceStorageKey("panels-v")

  const [defaultLayoutH] = useState(() => {
    try {
      const raw = localStorage.getItem(hLayoutKey)
      return raw ? JSON.parse(raw) : undefined
    } catch { return undefined }
  })

  const [defaultLayoutV] = useState(() => {
    try {
      const raw = localStorage.getItem(vLayoutKey)
      return raw ? JSON.parse(raw) : undefined
    } catch { return undefined }
  })

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[300]"
      style={{ "--titlebar-h": "2.5rem" } as React.CSSProperties}
    >
      {/* Titlebar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[var(--titlebar-h)] items-center justify-center px-3">
        <div className="pointer-events-auto flex h-8 min-w-0 max-w-[min(42rem,calc(100%-12rem))] items-center justify-center border border-border/70 bg-background/90 px-4 backdrop-blur-sm">
          <div className="min-w-0 truncate text-center text-xs text-muted-foreground" title={workspaceLabel}>
            {workspaceLabel}
          </div>
        </div>
      </div>

      {/* Panel layout */}
      <div className="absolute inset-0">
        <ResizablePanelGroup
          key={root}
          orientation="horizontal"
          defaultLayout={defaultLayoutH}
          onLayoutChanged={(layout) => {
            localStorage.setItem(hLayoutKey, JSON.stringify(layout))
          }}
        >
          {/* Left panel — file tree */}
          <ResizablePanel
            id="left"
            panelRef={leftPanelRef}
            defaultSize={13}
            minSize="180px"
            maxSize="420px"
            collapsible
            collapsedSize={0}
          >
            <div className="pointer-events-auto h-full">
              <WorkspaceFileTree root={root} filterRef={filterInputRef} />
            </div>
          </ResizablePanel>

          <ResizableHandle className="pointer-events-auto w-0 bg-transparent after:!w-1.5 hover:after:bg-border/40 active:after:bg-border/60" />

          {/* Canvas gap — stays pointer-events-none */}
          <ResizablePanel id="canvas" minSize="200px" />

          <ResizableHandle className="pointer-events-auto w-0 bg-transparent after:!w-1.5 hover:after:bg-border/40 active:after:bg-border/60" />

          {/* Right panel — chat + terminal */}
          <ResizablePanel
            id="right"
            panelRef={rightPanelRef}
            defaultSize={17}
            minSize="280px"
            maxSize="600px"
            collapsible
            collapsedSize={0}
          >
            <div className="pointer-events-auto h-full border-l border-border/70">
              <ResizablePanelGroup
                orientation="vertical"
                defaultLayout={defaultLayoutV}
                onLayoutChanged={(layout) => {
                  localStorage.setItem(vLayoutKey, JSON.stringify(layout))
                }}
              >
                <ResizablePanel id="chat" defaultSize={65} minSize={25}>
                  <WorkspaceChat root={root} />
                </ResizablePanel>
                <ResizableHandle className="h-px bg-border/40 after:!h-2 hover:bg-border/60 active:bg-border/80" />
                <ResizablePanel id="terminal" defaultSize={35} minSize={20}>
                  <WorkspaceTerminal root={root} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Toolbar */}
      <div className="pointer-events-none absolute inset-0 min-h-0">
        <CanvasToolbar />
      </div>
    </div>
  )
}

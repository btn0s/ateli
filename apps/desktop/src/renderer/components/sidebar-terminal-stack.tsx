import { useCallback, useEffect, useState } from "react"
import { Play, Plus, X } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { Sidebar } from "@/components/sidebar"
import { SidebarEmbeddedTerminal } from "@/components/sidebar-embedded-terminal"
import {
  SidebarTabButton,
  sidebarTabChipClassName,
} from "@/components/sidebar-tab-button"
import { useTerminalKillConfirmation } from "@/components/terminal-kill-dialog"
import { useTerminalRenameDialog } from "@/components/terminal-rename-dialog"
import { useManagementPolicy } from "@/contexts/management-policy-context"

export type SidebarLowerMainTab =
  | { kind: "setup" }
  | { kind: "run" }
  | { kind: "terminal"; id: string }

const panelKbdClass =
  "ateli-specular-hairline pointer-events-none ml-0.5 inline-flex items-center rounded-[2px] border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"

/** Matches docked slab panels (see ShapeChrome / diff preview). */
const setupRunSlabClass =
  "ateli-surface-slab flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-4 overflow-hidden border border-border/30 bg-gradient-to-b from-card/95 to-card/90 px-3 py-5 text-center text-card-foreground"

function SidebarSetupRunPlaceholder({ variant }: { variant: "setup" | "run" }) {
  if (variant === "setup") {
    return (
      <Sidebar.Section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={setupRunSlabClass} style={{ borderRadius: "var(--radius)" }}>
          <div className="ateli-skeuo-well ateli-specular-hairline mx-auto max-w-[17rem] space-y-2 rounded-md border border-border/35 bg-muted/12 px-3 py-3">
            <p className="font-mono text-xs font-medium text-foreground">
              No setup script output
            </p>
            <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
              Setup script output will appear here after running setup.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="ateli-specular-hairline gap-1.5 border-border/45"
            disabled
          >
            <Play className="size-3.5" aria-hidden />
            Run setup
          </Button>
        </div>
      </Sidebar.Section>
    )
  }

  return (
    <Sidebar.Section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className={setupRunSlabClass} style={{ borderRadius: "var(--radius)" }}>
        <div
          className="ateli-skeuo-input-dish ateli-specular-hairline flex size-[3.25rem] shrink-0 items-center justify-center rounded-full border border-border/40 bg-card/55"
          aria-hidden
        >
          <Play className="size-6 text-muted-foreground/50" strokeWidth={1.25} />
        </div>
        <div className="flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="ateli-specular-hairline gap-2 border-border/45"
            disabled
          >
            <Play className="size-3.5" aria-hidden />
            Run workspace
            <kbd className={panelKbdClass}>⌘R</kbd>
          </Button>
          <p className="text-xs text-muted-foreground/70">Test your changes here.</p>
        </div>
      </div>
    </Sidebar.Section>
  )
}

/**
 * One PTY per terminal tab; inactive terminals stay mounted so sessions survive
 * tab switches. Setup and Run are fixed tabs (not closeable). The first
 * terminal tab is labeled "Terminal" and cannot be closed from the tab bar.
 */
export function SidebarTerminalTabs({
  cwd,
  terminalIds,
  activeMain,
  onSelectMain,
  onCloseTerminal,
  onSessionEnded,
  onAddTab,
}: {
  cwd: string
  terminalIds: string[]
  activeMain: SidebarLowerMainTab
  onSelectMain: (tab: SidebarLowerMainTab) => void
  onCloseTerminal: (id: string) => void
  onSessionEnded: (id: string) => void
  onAddTab: () => void
}) {
  const [sessionIdsByTab, setSessionIdsByTab] = useState<
    Record<string, string | undefined>
  >({})
  const [namesBySessionKey, setNamesBySessionKey] = useState<
    Record<string, string | undefined>
  >({})
  const { requestKill, dialog: killDialog } = useTerminalKillConfirmation()
  const { requestRename, dialog: renameDialog } = useTerminalRenameDialog()
  const { policy } = useManagementPolicy()

  useEffect(() => {
    let cancelled = false
    void window.electron.terminal.list().then((sessions) => {
      if (cancelled) return
      setNamesBySessionKey((prev) => {
        const next = { ...prev }
        for (const s of sessions) {
          if (s.name) next[s.sidecarSessionId] = s.name
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return window.electron.rpc.onNotification(({ method, params }) => {
      if (method !== "terminal.renamed") return
      const sessionKey = params.sessionKey
      if (typeof sessionKey !== "string") return
      const name = params.name
      setNamesBySessionKey((prev) => {
        const next = { ...prev }
        if (typeof name === "string" && name.length > 0) {
          next[sessionKey] = name
        } else {
          delete next[sessionKey]
        }
        return next
      })
    })
  }, [])

  const setTabSessionId = useCallback(
    (tabId: string, sessionId: string | null) => {
      setSessionIdsByTab((prev) => {
        if (prev[tabId] === sessionId) return prev
        const next = { ...prev }
        if (sessionId) {
          next[tabId] = sessionId
        } else {
          delete next[tabId]
        }
        return next
      })
    },
    [],
  )

  const closeTerminalTab = useCallback(
    (tabId: string) => {
      setTabSessionId(tabId, null)
      onCloseTerminal(tabId)
    },
    [onCloseTerminal, setTabSessionId],
  )

  const endSession = useCallback(
    (tabId: string) => {
      setTabSessionId(tabId, null)
      onSessionEnded(tabId)
    },
    [onSessionEnded, setTabSessionId],
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-2 py-1.5">
        <div className="ateli-skeuo-divider" aria-hidden />
      </div>
      <div className="ateli-surface-input-stripe flex shrink-0 items-center gap-1 px-2 py-1.5">
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]">
          <div
            role="tablist"
            aria-label="Setup, run, and terminals"
            className="flex w-max min-w-full items-center gap-1"
          >
            {(
              [
                { kind: "setup" as const, label: "Setup" },
                { kind: "run" as const, label: "Run" },
              ] as const
            ).map(({ kind, label }) => {
              const selected = activeMain.kind === kind
              return (
                <SidebarTabButton
                  key={kind}
                  selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelectMain({ kind })}
                  className="max-w-[8rem] min-w-0 shrink-0 justify-start"
                >
                  <span className="truncate">{label}</span>
                </SidebarTabButton>
              )
            })}
            {terminalIds.map((id, i) => {
              const selected =
                activeMain.kind === "terminal" && activeMain.id === id
              const fallbackLabel = i === 0 ? "Terminal" : `T${i}`
              const canClose = i > 0
              const sessionId = sessionIdsByTab[id]
              const customName = sessionId
                ? namesBySessionKey[sessionId]
                : undefined
              const label = customName ?? fallbackLabel
              return (
                <ContextMenu key={id}>
                  {canClose ? (
                    <ContextMenuTrigger
                      className={sidebarTabChipClassName(
                        selected,
                        "max-w-[11rem] min-w-0 shrink-0 cursor-default justify-between gap-1 pr-0.5",
                      )}
                      role="tab"
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => onSelectMain({ kind: "terminal", id })}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          onSelectMain({ kind: "terminal", id })
                        }
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-left text-xs">
                        {label}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-muted-foreground transition-[color,background-color,transform] duration-150 active:scale-[0.95] hover:text-foreground"
                        title={`Close ${label}`}
                        aria-label={`Close ${label}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTerminalTab(id)
                        }}
                      >
                        <X className="size-3" />
                      </Button>
                    </ContextMenuTrigger>
                  ) : (
                    <ContextMenuTrigger
                      render={
                        <SidebarTabButton
                          selected={selected}
                          tabIndex={selected ? 0 : -1}
                          onClick={() => onSelectMain({ kind: "terminal", id })}
                          className="max-w-[8rem] min-w-0 shrink-0 justify-start"
                        >
                          <span className="truncate">{label}</span>
                        </SidebarTabButton>
                      }
                    />
                  )}
                  <ContextMenuContent className="min-w-44">
                    <ContextMenuItem
                      disabled={!sessionId || !policy.user.renameTerminal}
                      onClick={() => {
                        if (!sessionId) return
                        requestRename({
                          sessionKey: sessionId,
                          currentName: customName,
                          fallbackLabel,
                        })
                      }}
                    >
                      Rename…
                    </ContextMenuItem>
                    <ContextMenuItem
                      variant="destructive"
                      disabled={!sessionId}
                      onClick={() => {
                        if (!sessionId) return
                        requestKill({ sessionId })
                      }}
                    >
                      Kill session
                      <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground transition-[color,background-color,transform] duration-150 active:scale-[0.96] hover:text-foreground"
          title="New terminal"
          aria-label="New terminal"
          onClick={onAddTab}
        >
          <Plus />
        </Button>
      </div>

      {terminalIds.length === 0 ? (
        <Sidebar.Section>
          <p className="py-1.5 pl-1 text-xs text-muted-foreground">
            No terminals. Use + to add one.
          </p>
        </Sidebar.Section>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {activeMain.kind === "setup" ? (
            <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden">
              <SidebarSetupRunPlaceholder variant="setup" />
            </div>
          ) : null}
          {activeMain.kind === "run" ? (
            <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden">
              <SidebarSetupRunPlaceholder variant="run" />
            </div>
          ) : null}
          {terminalIds.map((id) => {
            const visible =
              activeMain.kind === "terminal" && activeMain.id === id
            return (
              <div
                key={id}
                className={cn(
                  "absolute inset-0 flex min-h-0 flex-col overflow-hidden",
                  visible ? "visible z-10" : "invisible z-0 pointer-events-none",
                )}
                aria-hidden={!visible}
              >
                <SidebarEmbeddedTerminal
                  instanceKey={id}
                  cwd={cwd}
                  onSessionAttached={(sessionId) =>
                    setTabSessionId(id, sessionId)
                  }
                  onSessionEnded={() => endSession(id)}
                />
              </div>
            )
          })}
        </div>
      )}
      {killDialog}
      {renameDialog}
    </div>
  )
}

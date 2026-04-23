import { useCallback, useEffect, useState } from "react"
import { Plus, X } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { SidebarEmbeddedTerminal } from "@/components/sidebar-embedded-terminal"
import { useTerminalKillConfirmation } from "@/components/terminal-kill-dialog"
import { useTerminalRenameDialog } from "@/components/terminal-rename-dialog"
import { useManagementPolicy } from "@/contexts/management-policy-context"

function terminalTabSurfaceClass(selected: boolean) {
  return cn(
    "group/tab inline-flex h-7 shrink-0 items-center gap-1 rounded-[3px] outline-none transition-colors duration-150 ease-out",
    "focus-within:ring-1 focus-within:ring-ring",
    selected
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  )
}

/**
 * One PTY per tab; inactive tabs stay mounted so sessions survive tab switches.
 * Index 0 is always "Terminal" and cannot be closed from the tab bar.
 */
export function SidebarTerminalTabs({
  cwd,
  tabIds,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onSessionEnded,
  onAddTab,
}: {
  cwd: string
  tabIds: string[]
  activeTabId: string | null
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
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

  const closeTab = useCallback(
    (tabId: string) => {
      setTabSessionId(tabId, null)
      onCloseTab(tabId)
    },
    [onCloseTab, setTabSessionId],
  )

  const endSession = useCallback(
    (tabId: string) => {
      setTabSessionId(tabId, null)
      onSessionEnded(tabId)
    },
    [onSessionEnded, setTabSessionId],
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-t border-border/60">
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-0">
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]">
          <div
            role="tablist"
            aria-label="Sidebar terminals"
            className="flex w-max min-w-full items-center gap-1"
          >
            {tabIds.map((id, i) => {
              const selected = activeTabId === id
              const fallbackLabel = i === 0 ? "Terminal" : `T${i}`
              const canClose = i > 0
              const sessionId = sessionIdsByTab[id]
              const customName = sessionId
                ? namesBySessionKey[sessionId]
                : undefined
              const label = customName ?? fallbackLabel
              return (
                <ContextMenu key={id}>
                  <ContextMenuTrigger
                    role="tab"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    className={cn(
                      "pl-2",
                      canClose ? "pr-1" : "pr-2",
                      terminalTabSurfaceClass(selected),
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 max-w-[8rem] items-center text-left text-xs"
                      onClick={() => onSelectTab(id)}
                    >
                      <span className="truncate">{label}</span>
                    </button>
                    {canClose ? (
                      <button
                        type="button"
                        className="flex size-5 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                        title={`Close ${label}`}
                        aria-label={`Close ${label}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTab(id)
                        }}
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </ContextMenuTrigger>
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
          className="shrink-0 text-muted-foreground"
          title="New terminal"
          aria-label="New terminal"
          onClick={onAddTab}
        >
          <Plus />
        </Button>
      </div>

      {tabIds.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          No terminals. Use + to add one.
        </p>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {tabIds.map((id) => (
            <div
              key={id}
              className={cn(
                "absolute inset-0 flex min-h-0 flex-col overflow-hidden",
                activeTabId === id
                  ? "visible z-10"
                  : "invisible z-0 pointer-events-none",
              )}
              aria-hidden={activeTabId !== id}
            >
              <SidebarEmbeddedTerminal
                instanceKey={id}
                cwd={cwd}
                onSessionAttached={(sessionId) => setTabSessionId(id, sessionId)}
                onSessionEnded={() => endSession(id)}
              />
            </div>
          ))}
        </div>
      )}
      {killDialog}
      {renameDialog}
    </div>
  )
}

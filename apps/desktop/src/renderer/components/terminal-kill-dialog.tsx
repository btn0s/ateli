import { useCallback, useState, type ReactNode } from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { useTerminalSessionStore } from "@/contexts/terminal-session-store"

type TerminalKillRequest = {
  sessionId: string
}

export function isTerminalKillShortcut(event: KeyboardEvent): boolean {
  return (
    event.key === "Backspace" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  )
}

export function useTerminalKillConfirmation(): {
  requestKill: (request: TerminalKillRequest) => void
  dialog: ReactNode
} {
  const sessions = useTerminalSessionStore()
  const [pending, setPending] = useState<TerminalKillRequest | null>(null)
  const [killing, setKilling] = useState(false)

  const requestKill = useCallback((request: TerminalKillRequest) => {
    setPending(request)
  }, [])

  const cancel = useCallback(() => {
    if (!killing) {
      setPending(null)
    }
  }, [killing])

  const confirm = useCallback(async () => {
    if (!pending) return
    setKilling(true)
    try {
      await sessions.kill(pending.sessionId)
      setPending(null)
    } finally {
      setKilling(false)
    }
  }, [pending, sessions])

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(next) => !next && cancel()}>
      <DialogContent showCloseButton={false} className="gap-3">
        <DialogHeader className="gap-1">
          <DialogTitle>Kill session?</DialogTitle>
          <DialogDescription>
            Sends SIGTERM to the terminal process and closes attached views.
            Unsaved shell state is lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={killing}>
            Cancel
            <span className="ml-1 text-[11px] opacity-60 tabular-nums">Esc</span>
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={killing}>
            Kill session
            <span className="ml-1 text-[11px] opacity-60 tabular-nums">⌘ ↩</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { requestKill, dialog }
}

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
    event.key.toLowerCase() === "k" &&
    event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey
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
      <DialogContent
        showCloseButton={false}
        className="gap-3 border-l-2 border-l-destructive pl-5"
      >
        <DialogHeader className="gap-1.5">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em]">
            <span className="text-destructive">Destructive</span>
            <kbd className="inline-flex items-center rounded-none border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-muted-foreground">
              ⌘⇧K
            </kbd>
          </div>
          <DialogTitle className="font-mono text-base leading-tight">
            Kill session
          </DialogTitle>
          <DialogDescription>
            Sends SIGTERM to the terminal process and closes attached views.
            Unsaved shell state is lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={killing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={killing}>
            Kill session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { requestKill, dialog }
}

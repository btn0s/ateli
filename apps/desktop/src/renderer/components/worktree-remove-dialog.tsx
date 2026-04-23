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

type WorktreeRemoveRequest = {
  repoPath: string
  id: string
  branch: string
  path: string
}

export function useWorktreeRemoveConfirmation(): {
  requestRemove: (request: WorktreeRemoveRequest) => void
  dialog: ReactNode
} {
  const [pending, setPending] = useState<WorktreeRemoveRequest | null>(null)
  const [removing, setRemoving] = useState(false)

  const requestRemove = useCallback((request: WorktreeRemoveRequest) => {
    setPending(request)
  }, [])

  const cancel = useCallback(() => {
    if (!removing) {
      setPending(null)
    }
  }, [removing])

  const confirm = useCallback(async () => {
    if (!pending) return
    setRemoving(true)
    try {
      await window.electron.worktree.remove(pending.repoPath, pending.id)
      setPending(null)
    } catch (err) {
      console.error("worktree.remove failed", err)
    } finally {
      setRemoving(false)
    }
  }, [pending])

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(next) => !next && cancel()}>
      <DialogContent
        showCloseButton={false}
        className="gap-3 border-l-2 border-l-destructive pl-5"
      >
        <DialogHeader className="gap-1.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
            Destructive
          </div>
          <DialogTitle className="font-mono text-base leading-tight">
            Remove worktree
          </DialogTitle>
          {pending?.branch && (
            <div className="-mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {pending.branch}
            </div>
          )}
          <DialogDescription className="mt-1">
            Terminals rooted in{" "}
            <code className="rounded-none border border-border bg-muted/60 px-1 py-px font-mono text-[0.95em] text-foreground">
              {pending?.path}
            </code>{" "}
            are killed. The branch itself is preserved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={removing}>
            Remove worktree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { requestRemove, dialog }
}

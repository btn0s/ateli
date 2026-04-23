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
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Remove worktree?</DialogTitle>
          <DialogDescription>
            Any terminals rooted in{" "}
            <code className="font-mono text-xs">{pending?.path}</code> will be
            killed. The branch{" "}
            <code className="font-mono text-xs">{pending?.branch}</code> itself
            is not deleted.
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

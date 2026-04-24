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

export type WorktreeRemoveRequest = {
  repoPath: string
  id: string
  branch: string
  path: string
}

export function useWorktreeRemoveConfirmation(): {
  requestRemove: (requests: readonly WorktreeRemoveRequest[]) => void
  dialog: ReactNode
} {
  const [pending, setPending] = useState<readonly WorktreeRemoveRequest[] | null>(
    null,
  )
  const [removing, setRemoving] = useState(false)

  const requestRemove = useCallback((requests: readonly WorktreeRemoveRequest[]) => {
    if (requests.length === 0) return
    setPending(requests)
  }, [])

  const cancel = useCallback(() => {
    if (!removing) {
      setPending(null)
    }
  }, [removing])

  const confirm = useCallback(async () => {
    if (!pending?.length) return
    setRemoving(true)
    try {
      for (const req of pending) {
        await window.electron.worktree.remove(req.repoPath, req.id)
      }
      setPending(null)
    } catch (err) {
      console.error("worktree.remove failed", err)
    } finally {
      setRemoving(false)
    }
  }, [pending])

  const count = pending?.length ?? 0
  const single =
    pending && pending.length === 1 ? (pending[0] ?? null) : null

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(next) => !next && cancel()}>
      <DialogContent showCloseButton={false} className="gap-3">
        <DialogHeader className="gap-1">
          <DialogTitle>
            {single ? (
              <>
                Remove worktree
                {single.branch ? (
                  <span className="text-muted-foreground"> · {single.branch}</span>
                ) : null}
                ?
              </>
            ) : (
              <>Remove {count} worktrees?</>
            )}
          </DialogTitle>
          {single ? (
            <DialogDescription>
              Terminals rooted in{" "}
              <code className="rounded-none border border-border bg-muted/60 px-1 py-px text-[0.95em] text-foreground">
                {single.path}
              </code>{" "}
              are killed. The branch itself is preserved.
            </DialogDescription>
          ) : pending ? (
            <DialogDescription className="space-y-2">
              <p>
                Terminals rooted in these directories are killed. The branches
                themselves are preserved.
              </p>
              <ul className="max-h-40 list-inside list-disc overflow-y-auto text-sm text-muted-foreground">
                {pending.map((r) => (
                  <li key={r.id}>
                    <span className="text-foreground">{r.branch}</span>
                    <span className="ml-1 font-mono text-[11px] opacity-80">
                      {r.path}
                    </span>
                  </li>
                ))}
              </ul>
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={removing}>
            Cancel
            <span className="ml-1 text-[11px] opacity-60 tabular-nums">Esc</span>
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={removing}>
            {single ? "Remove worktree" : `Remove ${count} worktrees`}
            <span className="ml-1 text-[11px] opacity-60 tabular-nums">⌘ ↩</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { requestRemove, dialog }
}

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
import { cn } from "@workspace/ui/lib/utils"

export type WorktreeRemoveRequest = {
  repoPath: string
  id: string
  branch: string
  path: string
}

/** Shorten common macOS home paths for display; full path stays in `title`. */
function compactPathForDisplay(path: string): string {
  return path.replace(/^\/Users\/[^/]+(?=\/)/, "~")
}

const DIALOG_PRESS =
  "active:scale-[0.96] transition-transform duration-150 ease-out motion-reduce:transition-none motion-reduce:active:scale-100"

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
  const isPlural = count > 1

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(next) => !next && cancel()}>
      <DialogContent
        showCloseButton={false}
        className={cn(isPlural && "sm:max-w-lg")}
      >
        <DialogHeader>
          <DialogTitle className="text-balance">
            {single ? (
              <>
                Remove worktree
                {single.branch ? (
                  <span className="text-muted-foreground"> · {single.branch}</span>
                ) : null}
                ?
              </>
            ) : (
              <>
                Remove <span className="tabular-nums">{count}</span> worktrees?
              </>
            )}
          </DialogTitle>
          {single ? (
            <DialogDescription className="text-pretty">
              Terminals rooted in{" "}
              <code className="rounded-sm border border-border/80 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
                {single.path}
              </code>{" "}
              are killed. The branch itself is preserved.
            </DialogDescription>
          ) : pending ? (
            <>
              <DialogDescription className="text-pretty">
                Terminals rooted in these directories are killed. The branches
                themselves are preserved.
              </DialogDescription>
              <div
                role="list"
                aria-label="Worktrees to remove"
                className={cn(
                  "mt-1 max-h-[min(280px,calc(50vh-8rem))] overflow-y-auto overscroll-y-contain rounded-sm",
                  "border border-border/50 bg-muted/20 shadow-[inset_0_1px_0_0_oklch(1_0_0/5%)]",
                  "[scrollbar-gutter:stable]",
                )}
              >
                {pending.map((r) => (
                  <div
                    key={r.id}
                    role="listitem"
                    className="flex min-w-0 flex-col gap-0.5 border-b border-border/35 px-2 py-2 last:border-b-0"
                  >
                    <div
                      className="truncate text-xs font-medium text-foreground"
                      title={r.branch}
                    >
                      {r.branch}
                    </div>
                    <div
                      className="truncate font-mono text-[11px] leading-snug tracking-tight text-muted-foreground"
                      title={r.path}
                    >
                      {compactPathForDisplay(r.path)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={cancel}
            disabled={removing}
            className={DIALOG_PRESS}
          >
            Cancel
            <span className="ml-1 text-[11px] font-normal opacity-60 tabular-nums">
              Esc
            </span>
          </Button>
          <Button
            variant="destructive"
            type="button"
            onClick={confirm}
            disabled={removing}
            className={cn(
              DIALOG_PRESS,
              "border-transparent bg-destructive text-white shadow-sm",
              "hover:bg-destructive/90 hover:text-white",
              "focus-visible:border-destructive focus-visible:ring-destructive/35",
            )}
          >
            {single ? "Remove worktree" : (
              <>
                Remove <span className="tabular-nums">{count}</span> worktrees
              </>
            )}
            <span className="ml-1 text-[11px] font-normal opacity-90 tabular-nums">
              ⌘ ↩
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { requestRemove, dialog }
}

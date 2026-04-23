import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"

type WorktreeRenameRequest = {
  repoPath: string
  id: string
  currentBranch: string
}

export function useWorktreeRenameConfirmation(): {
  requestRename: (request: WorktreeRenameRequest) => void
  dialog: ReactNode
} {
  const [pending, setPending] = useState<WorktreeRenameRequest | null>(null)
  const [value, setValue] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const requestRename = useCallback((request: WorktreeRenameRequest) => {
    setPending(request)
    setValue(request.currentBranch)
    setError(null)
  }, [])

  const cancel = useCallback(() => {
    if (submitting) return
    setPending(null)
    setError(null)
  }, [submitting])

  const submit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault()
      if (!pending) return
      const next = value.trim()
      if (!next) {
        setError("Branch name is required")
        return
      }
      if (next === pending.currentBranch) {
        setPending(null)
        return
      }
      setSubmitting(true)
      setError(null)
      try {
        await window.electron.worktree.renameBranch(
          pending.repoPath,
          pending.id,
          next,
        )
        setPending(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSubmitting(false)
      }
    },
    [pending, value],
  )

  useEffect(() => {
    if (pending) {
      const id = requestAnimationFrame(() => {
        inputRef.current?.select()
      })
      return () => cancelAnimationFrame(id)
    }
  }, [pending])

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(next) => !next && cancel()}>
      <DialogContent showCloseButton={false} className="gap-3">
        <form onSubmit={submit} className="contents">
          <DialogHeader className="gap-1">
            <DialogTitle>
              Rename branch
              {pending ? (
                <span className="text-muted-foreground">
                  {" "}· {pending.currentBranch}
                </span>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              Runs <code className="rounded-none border border-border bg-muted/60 px-1 py-px text-[0.95em] text-foreground">git branch -m</code>{" "}
              inside the worktree. The remote tracking branch is left unchanged.
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={inputRef}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="branch name"
            disabled={submitting}
          />
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={cancel}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              Rename branch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  return { requestRename, dialog }
}

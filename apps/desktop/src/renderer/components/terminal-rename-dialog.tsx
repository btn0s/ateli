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

export type TerminalRenameRequest = {
  sessionKey: string
  currentName?: string
  fallbackLabel: string
}

export function useTerminalRenameDialog(): {
  requestRename: (request: TerminalRenameRequest) => void
  dialog: ReactNode
} {
  const [pending, setPending] = useState<TerminalRenameRequest | null>(null)
  const [value, setValue] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const requestRename = useCallback((request: TerminalRenameRequest) => {
    setPending(request)
    setValue(request.currentName ?? "")
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
      const trimmed = value.trim()
      const next = trimmed === "" ? undefined : trimmed
      if (next === pending.currentName) {
        setPending(null)
        return
      }
      setSubmitting(true)
      setError(null)
      try {
        await window.electron.terminal.rename(pending.sessionKey, next)
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
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} className="contents">
          <DialogHeader className="gap-1">
            <DialogTitle>Rename terminal</DialogTitle>
            <DialogDescription>
              Leave blank to restore the default label
              {pending?.fallbackLabel ? ` (${pending.fallbackLabel})` : ""}.
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={inputRef}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={pending?.fallbackLabel ?? "Terminal"}
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
              <span className="ml-1 text-[11px] opacity-60 tabular-nums">Esc</span>
            </Button>
            <Button type="submit" disabled={submitting}>
              Rename
              <span className="ml-1 text-[11px] opacity-60 tabular-nums">⌘ ↩</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  return { requestRename, dialog }
}

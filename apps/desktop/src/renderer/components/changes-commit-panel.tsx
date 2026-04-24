import { useCallback, useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

type ChangesCommitPanelProps = {
  repoPath: string
  /** Git status loaded successfully (repository root is valid). */
  gitReady: boolean
  /** Any paths with staged content (index column non-empty, not untracked). */
  hasStagedChanges: boolean
  /** Count of changed paths from `git status` (0 = clean). */
  changeCount: number
  onGitMutated: () => void
}

export function ChangesCommitPanel({
  repoPath,
  gitReady,
  hasStagedChanges,
  changeCount,
  onGitMutated,
}: ChangesCommitPanelProps) {
  const [message, setMessage] = useState("")
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState<null | "gen" | "commit" | "push">(null)
  const [notice, setNotice] = useState<{
    kind: "error" | "success"
    text: string
  } | null>(null)

  const canCommit =
    gitReady &&
    message.trim().length > 0 &&
    (hasStagedChanges || amend) &&
    busy === null

  const canPush = gitReady && busy === null

  const runGenerate = useCallback(async () => {
    setNotice(null)
    setBusy("gen")
    try {
      const r = await window.electron.git.generateCommitMessage(repoPath)
      if (r.error) {
        setNotice({ kind: "error", text: r.error })
        return
      }
      if (r.message) {
        setMessage(r.message)
        setNotice(null)
      }
    } finally {
      setBusy(null)
    }
  }, [repoPath])

  const runCommit = useCallback(async () => {
    setNotice(null)
    setBusy("commit")
    try {
      const r = await window.electron.git.commit({
        repoPath,
        message,
        amend: amend || undefined,
      })
      if (!r.ok) {
        setNotice({ kind: "error", text: r.error })
        return
      }
      setMessage("")
      setAmend(false)
      setNotice({ kind: "success", text: "Committed." })
      onGitMutated()
    } finally {
      setBusy(null)
    }
  }, [amend, message, onGitMutated, repoPath])

  const runPush = useCallback(async () => {
    setNotice(null)
    setBusy("push")
    try {
      const r = await window.electron.git.push(repoPath)
      if (!r.ok) {
        setNotice({ kind: "error", text: r.error })
        return
      }
      setNotice({ kind: "success", text: "Pushed." })
      onGitMutated()
    } finally {
      setBusy(null)
    }
  }, [onGitMutated, repoPath])

  if (!gitReady) {
    return null
  }

  return (
    <div
      className={cn(
        "ateli-surface-slab mb-2 shrink-0 rounded-md border border-border/20 p-2",
        "bg-gradient-to-b from-card/92 to-card/84 text-card-foreground",
        "supports-backdrop-filter:backdrop-blur-sm",
      )}
    >
      <Textarea
        aria-label="Commit message"
        placeholder="Commit message (⌘⏎). Stage files in the list below."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return
          e.preventDefault()
          if (canCommit) void runCommit()
        }}
        disabled={busy !== null}
        rows={3}
        className={cn(
          "ateli-skeuo-input-dish min-h-[4.25rem] resize-none rounded-md border border-border/15",
          "bg-input/20 py-1.5 text-xs",
          "placeholder:text-muted-foreground/70",
          "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45",
        )}
      />

      <div className="ateli-skeuo-divider -mx-0.5 my-2 shrink-0" aria-hidden />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="ateli-specular-hairline gap-1 border-border/40"
          disabled={busy !== null || changeCount === 0}
          onClick={() => void runGenerate()}
          title="Tries Cursor `agent --print --mode ask` in the repo, then optional ATELI_COMMIT_MSG_CLI, then a local git heuristic. Skip agent: ATELI_COMMIT_MSG_SKIP_CURSOR_AGENT=1. Custom agent path: ATELI_CURSOR_AGENT_BIN."
        >
          <Sparkles className="size-3.5 opacity-80" aria-hidden />
          {busy === "gen" ? "…" : "Generate"}
        </Button>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
          <Checkbox
            checked={amend}
            onCheckedChange={(v) => setAmend(v === true)}
            disabled={busy !== null}
          />
          Amend
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            className="ateli-specular-hairline"
            disabled={!canCommit}
            onClick={() => void runCommit()}
          >
            {busy === "commit" ? "…" : "Commit"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="ateli-specular-hairline border-border/40"
            disabled={!canPush}
            onClick={() => void runPush()}
          >
            {busy === "push" ? "…" : "Push"}
          </Button>
        </div>
      </div>

      {notice ? (
        <div
          className={cn(
            "ateli-skeuo-well mt-2 rounded-md border px-2 py-1.5 text-xs leading-snug",
            notice.kind === "error"
              ? "border-destructive/35 bg-destructive/10 text-destructive"
              : "ateli-specular-hairline border-border/35 bg-muted/14 text-muted-foreground",
          )}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}

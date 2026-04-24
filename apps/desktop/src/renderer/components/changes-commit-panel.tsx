import { useCallback, useEffect, useRef, useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

type ChangesCommitPanelProps = {
  repoPath: string
  /** Git status loaded successfully (repository root is valid). */
  gitReady: boolean
  /** Paths with staged content (index column non-empty, not untracked). */
  stagedPaths: string[]
  /** Counted paths from `git status`, regardless of stage state. */
  changedPaths: string[]
  onGitMutated: () => void
}

const COMMIT_MESSAGE_MAX_HEIGHT = 176

export function ChangesCommitPanel({
  repoPath,
  gitReady,
  stagedPaths,
  changedPaths,
  onGitMutated,
}: ChangesCommitPanelProps) {
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState<null | "gen" | "commit" | "push">(null)
  const [notice, setNotice] = useState<{
    kind: "error" | "success"
    text: string
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const hasStagedChanges = stagedPaths.length > 0
  const changeCount = changedPaths.length
  const canStageAll = gitReady && changeCount > 0 && busy === null
  const canCommit =
    gitReady && message.trim().length > 0 && hasStagedChanges && busy === null
  const primaryAction =
    hasStagedChanges || changeCount === 0 ? "commit" : "stage"
  const placeholder = hasStagedChanges
    ? "Commit message for staged files (⌘⏎)."
    : changeCount > 0
      ? "Commit message for current diff (⌘⏎)."
      : "Commit message (⌘⏎)."
  const canPush = gitReady && busy === null

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "0px"
    const nextHeight = Math.min(
      textarea.scrollHeight,
      COMMIT_MESSAGE_MAX_HEIGHT
    )
    textarea.style.height = `${Math.max(nextHeight, 68)}px`
    textarea.style.overflowY =
      textarea.scrollHeight > COMMIT_MESSAGE_MAX_HEIGHT ? "auto" : "hidden"
  }, [message])

  const runGenerate = useCallback(async () => {
    setNotice(null)
    setBusy("gen")
    try {
      const r = await window.electron.git.generateCommitMessage(
        repoPath,
        hasStagedChanges ? stagedPaths : undefined
      )
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
  }, [hasStagedChanges, repoPath, stagedPaths])

  const runStageAll = useCallback(async () => {
    if (changeCount === 0) return
    setNotice(null)
    setBusy("commit")
    try {
      const r = await window.electron.git.stagePaths(repoPath, changedPaths)
      if (!r.ok) {
        setNotice({ kind: "error", text: r.error })
        return
      }
      setNotice({
        kind: "success",
        text: `Staged ${changeCount} file${changeCount === 1 ? "" : "s"}.`,
      })
      onGitMutated()
    } finally {
      setBusy(null)
    }
  }, [changeCount, changedPaths, onGitMutated, repoPath])

  const runCommit = useCallback(async () => {
    setNotice(null)
    setBusy("commit")
    try {
      const r = await window.electron.git.commit({
        repoPath,
        message,
      })
      if (!r.ok) {
        setNotice({ kind: "error", text: r.error })
        return
      }
      setMessage("")
      setNotice({ kind: "success", text: "Committed." })
      onGitMutated()
    } finally {
      setBusy(null)
    }
  }, [message, onGitMutated, repoPath])

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
        "mb-2 shrink-0 rounded-md border border-border/20 p-2 ateli-surface-slab",
        "bg-gradient-to-b from-card/92 to-card/84 text-card-foreground",
        "supports-backdrop-filter:backdrop-blur-sm"
      )}
    >
      <Textarea
        ref={textareaRef}
        aria-label="Commit message"
        placeholder={placeholder}
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
          "max-h-44 min-h-[4.25rem] resize-none rounded-md border border-border/15 ateli-skeuo-input-dish",
          "overflow-y-auto bg-input/20 py-1.5 text-xs leading-5",
          "placeholder:text-muted-foreground/70",
          "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45"
        )}
      />

      <div className="-mx-0.5 my-2 ateli-skeuo-divider shrink-0" aria-hidden />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="gap-1 border-border/40 ateli-specular-hairline"
          disabled={busy !== null || changeCount === 0}
          onClick={() => void runGenerate()}
          title="Draft a commit message from the staged changes, or from the current diff if nothing is staged yet."
        >
          <Sparkles className="size-3.5 opacity-80" aria-hidden />
          {busy === "gen" ? "…" : "Generate"}
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            className="ateli-specular-hairline"
            disabled={primaryAction === "commit" ? !canCommit : !canStageAll}
            onClick={() =>
              void (primaryAction === "commit" ? runCommit() : runStageAll())
            }
          >
            {busy === "commit"
              ? "…"
              : primaryAction === "commit"
                ? "Commit"
                : "Stage all"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="border-border/40 ateli-specular-hairline"
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
            "mt-2 rounded-md border px-2 py-1.5 text-xs leading-snug ateli-skeuo-well",
            notice.kind === "error"
              ? "border-destructive/35 bg-destructive/10 text-destructive"
              : "border-border/35 bg-muted/14 text-muted-foreground ateli-specular-hairline"
          )}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}

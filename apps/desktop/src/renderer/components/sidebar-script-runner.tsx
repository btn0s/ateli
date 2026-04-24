import { useCallback, useEffect, useState } from "react"
import { Play, RefreshCw } from "lucide-react"
import { useEditor } from "tldraw"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
  getCenterLaneScreenRect,
  zoomToSelectionInViewport,
} from "@/lib/canvas-camera"
import { addTerminalAtCenter } from "@/lib/default-actions"

type ScriptEntry = { name: string; command: string }

type ScriptsLoad =
  | { status: "loading" }
  | { status: "no-package-json" }
  | { status: "empty" }
  | { status: "ready"; scripts: ScriptEntry[] }

const hintClass = "px-2 py-1 text-xs text-muted-foreground"

/**
 * Reads `scripts` from the active worktree's root package.json and lets the
 * user launch one into a fresh canvas terminal (auto-selected and zoomed).
 * Replaces the older Setup/Run/Terminal tab strip.
 */
export function SidebarScriptRunner({ cwd }: { cwd: string }) {
  const editor = useEditor()
  const [load, setLoad] = useState<ScriptsLoad>({ status: "loading" })
  const [reloadSeq, setReloadSeq] = useState(0)

  useEffect(() => {
    if (!cwd) {
      setLoad({ status: "no-package-json" })
      return
    }
    let cancelled = false
    setLoad({ status: "loading" })
    void window.electron.fs.readPackageJsonScripts(cwd).then((result) => {
      if (cancelled) return
      if (!result) {
        setLoad({ status: "no-package-json" })
        return
      }
      if (result.scripts.length === 0) {
        setLoad({ status: "empty" })
        return
      }
      setLoad({ status: "ready", scripts: result.scripts })
    })
    return () => {
      cancelled = true
    }
  }, [cwd, reloadSeq])

  const runScript = useCallback(
    (name: string) => {
      const id = addTerminalAtCenter(editor, {
        cwd,
        initialCommand: `pnpm run ${name}`,
      })
      editor.select(id)
      zoomToSelectionInViewport(editor, {
        maxTargetZoom: 1,
        zoomOutFactor: 0.9,
        screenRect: getCenterLaneScreenRect(editor),
      })
    },
    [cwd, editor]
  )

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-2 py-1.5">
        <div className="ateli-skeuo-divider" aria-hidden />
      </div>
      <div className="ateli-surface-input-stripe flex w-full min-w-0 shrink-0 items-center gap-1 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate pl-0.5 text-xs text-muted-foreground">
          Scripts
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground transition-[color,background-color,transform] duration-150 active:scale-[0.96] hover:text-foreground"
          title="Reload scripts"
          aria-label="Reload scripts"
          onClick={() => setReloadSeq((s) => s + 1)}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {load.status === "loading" ? null : load.status === "ready" ? (
          <ul className="flex flex-col gap-px">
            {load.scripts.map((s) => (
              <ScriptRow
                key={s.name}
                script={s}
                onRun={() => runScript(s.name)}
              />
            ))}
          </ul>
        ) : (
          <p className={cn(hintClass, "pl-1")}>
            {load.status === "no-package-json"
              ? "No package.json in this worktree."
              : "No scripts in package.json."}
          </p>
        )}
      </div>
    </div>
  )
}

function ScriptRow({
  script,
  onRun,
}: {
  script: ScriptEntry
  onRun: () => void
}) {
  return (
    <li
      className={cn(
        "group grid w-full grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-1.5 py-1 transition-colors duration-150 select-none",
        "cursor-default hover:bg-accent"
      )}
      onDoubleClick={onRun}
      title={`Double-click to run ${script.name}`}
    >
      <span className="truncate text-xs leading-tight text-foreground">
        {script.name}
      </span>
      <span
        className="min-w-0 truncate font-mono text-[11px] leading-tight text-muted-foreground/80"
        title={script.command}
      >
        {script.command}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn(
          "shrink-0 text-muted-foreground transition-[color,background-color,opacity,transform] duration-150 active:scale-[0.96] hover:text-foreground",
          "opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
        )}
        title={`Run ${script.name}`}
        aria-label={`Run ${script.name}`}
        onClick={onRun}
      >
        <Play className="size-3" />
      </Button>
    </li>
  )
}

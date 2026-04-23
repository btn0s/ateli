import { useEffect } from "react"
import { Button } from "@workspace/ui/components/button"

export function FolderPicker({ onSelect }: { onSelect: (path: string) => void }) {
  async function handleClick() {
    const path = await window.electron.selectFolder()
    if (path) onSelect(path)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault()
        void handleClick()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  return (
    <div className="relative flex min-h-screen flex-col bg-background font-sans antialiased">
      <div className="pointer-events-none absolute top-10 left-8 text-xs text-muted-foreground/70">
        Ateli
      </div>

      <div className="flex flex-1 items-center justify-center px-8">
        <div className="flex max-w-md flex-col gap-5">
          <h1 className="text-[32px] leading-[1.1] font-light tracking-tight text-foreground">
            Open a project.
          </h1>

          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Choose a folder and Ateli will lay out its terminals, worktrees,
            and files on a canvas you can arrange to your taste.
          </p>

          <div className="mt-2 flex items-center gap-3">
            <Button
              onClick={handleClick}
              size="lg"
              className="px-4"
            >
              Choose folder
            </Button>
            <span className="text-xs text-muted-foreground/70">
              or{" "}
              <kbd className="inline-flex items-center rounded-[2px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                ⌘O
              </kbd>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

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
      {/* Corner marks: top-left brand, bottom-left tagline, bottom-right version/status. */}
      <div className="pointer-events-none absolute top-10 left-8 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80">
        <span className="size-1.5 bg-signal" aria-hidden />
        <span>ateli</span>
      </div>

      <div className="pointer-events-none absolute bottom-8 left-8 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
        canvas-first workspace for dev
      </div>

      <div className="pointer-events-none absolute right-8 bottom-8 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
        idle · awaiting project
      </div>

      {/* Main content block — loosely centered, slight upward bias. */}
      <div className="flex flex-1 items-center justify-center">
        <div className="flex max-w-md flex-col gap-6">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <span className="inline-block size-px w-8 bg-border" aria-hidden />
            <span>step 01 / open a project</span>
          </div>

          <h1 className="text-[28px] leading-[1.05] font-light tracking-tight text-foreground">
            Open a project
            <span className="text-muted-foreground/60">.</span>
          </h1>

          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            Select a folder to begin. Ateli arranges terminals, worktrees, and
            files on an infinite canvas — one spatial workspace per project.
          </p>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleClick}
              size="lg"
              className="group gap-2 border-border bg-foreground text-background hover:bg-foreground/90"
            >
              <span>Choose folder</span>
              <span className="transition-transform duration-150 ease-out group-hover:translate-x-0.5">
                →
              </span>
            </Button>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
              or press{" "}
              <kbd className="inline-flex items-center rounded-none border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-muted-foreground">
                ⌘O
              </kbd>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

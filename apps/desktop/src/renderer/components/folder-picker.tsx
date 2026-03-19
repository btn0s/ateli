import { Button } from "@workspace/ui/components/button"
import { FolderOpen } from "lucide-react"

export function FolderPicker({ onSelect }: { onSelect: (path: string) => void }) {
  async function handleClick() {
    const path = await window.electron.selectFolder()
    if (path) onSelect(path)
  }

  return (
    <div className="flex min-h-screen items-center justify-center font-sans antialiased">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="text-muted-foreground rounded-xl border p-4">
          <FolderOpen className="size-8" />
        </div>
        <div>
          <h1 className="text-lg font-medium">Open a project</h1>
          <p className="text-muted-foreground text-sm">
            Select a folder to get started.
          </p>
        </div>
        <Button onClick={handleClick}>Choose Folder</Button>
      </div>
    </div>
  )
}

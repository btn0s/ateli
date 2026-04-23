import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Sidebar } from "@/components/sidebar"
import {
  SidebarTabButton,
  SidebarTabStrip,
} from "@/components/sidebar-tab-button"
import { WorktreeList } from "@/components/worktree-list"

type LeftTab = "worktrees" | "canvas"

export function LeftSidebarTabs({ repoPath }: { repoPath: string }) {
  const [tab, setTab] = useState<LeftTab>("worktrees")

  const trailing =
    tab === "worktrees" ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        title="New worktree"
        aria-label="New worktree"
        onClick={() => {
          const branch = `ateli/${Date.now().toString(36)}`
          window.electron.worktree.create(repoPath, branch)
        }}
      >
        <Plus />
      </Button>
    ) : null

  return (
    <Sidebar.Root>
      <SidebarTabStrip ariaLabel="Workspace panel" trailing={trailing}>
        <SidebarTabButton
          selected={tab === "worktrees"}
          onClick={() => setTab("worktrees")}
        >
          Worktrees
        </SidebarTabButton>
        <SidebarTabButton
          selected={tab === "canvas"}
          onClick={() => setTab("canvas")}
        >
          Canvas
        </SidebarTabButton>
      </SidebarTabStrip>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {tab === "worktrees" ? (
          <WorktreeList repoPath={repoPath} />
        ) : (
          <CanvasTabPlaceholder />
        )}
      </div>
    </Sidebar.Root>
  )
}

function CanvasTabPlaceholder() {
  return (
    <Sidebar.Section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
      <p className="text-xs text-muted-foreground">Canvas overview</p>
      <p className="text-xs text-muted-foreground/60">
        Coming soon · TODO
      </p>
    </Sidebar.Section>
  )
}

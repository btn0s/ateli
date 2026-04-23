import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

export type WorktreeIndexEntry = {
  id: string
  path: string
  branch: string
  head: string
  isMain: boolean
  createdAt: string
  repoPath: string
}

const WorktreeIndexContext = createContext<WorktreeIndexEntry[]>([])

export function WorktreeIndexProvider({
  repoPath,
  children,
}: {
  repoPath: string
  children: ReactNode
}) {
  const [worktrees, setWorktrees] = useState<WorktreeIndexEntry[]>([])

  const refresh = useCallback(() => {
    if (!repoPath) {
      setWorktrees([])
      return
    }
    void window.electron.worktree.list(repoPath).then(setWorktrees)
  }, [repoPath])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    return window.electron.rpc.onNotification(({ method }) => {
      if (
        method === "worktree.created" ||
        method === "worktree.removed" ||
        method === "worktree.renamed"
      ) {
        refresh()
      }
    })
  }, [refresh])

  return (
    <WorktreeIndexContext.Provider value={worktrees}>
      {children}
    </WorktreeIndexContext.Provider>
  )
}

export function useWorktrees(): WorktreeIndexEntry[] {
  return useContext(WorktreeIndexContext)
}

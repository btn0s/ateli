import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export interface DiffPreviewTab {
  absPath: string
  id: string
  indexStatus: string
  path: string
  workTreeStatus: string
}

interface DiffPreviewTabsContextValue {
  activeTabId: string | null
  closeTab: (id: string) => void
  openDiffTab: (tab: DiffPreviewTab) => void
  selectTab: (id: string) => void
  tabs: DiffPreviewTab[]
}

const DiffPreviewTabsContext =
  createContext<DiffPreviewTabsContextValue | null>(null)

export function DiffPreviewTabsProvider({
  children,
}: {
  children: ReactNode
}) {
  const [tabs, setTabs] = useState<DiffPreviewTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  const openDiffTab = useCallback((tab: DiffPreviewTab) => {
    setTabs((current) => {
      const existing = current.find((entry) => entry.path === tab.path)
      if (existing) {
        setActiveTabId(existing.id)
        return current
      }
      setActiveTabId(tab.id)
      return [...current, tab]
    })
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs((current) => {
      const index = current.findIndex((entry) => entry.id === id)
      if (index < 0) return current
      const next = current.filter((entry) => entry.id !== id)
      setActiveTabId((active) => {
        if (active !== id) return active
        return next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null
      })
      return next
    })
  }, [])

  const selectTab = useCallback((id: string) => {
    setActiveTabId(id)
  }, [])

  const value = useMemo(
    () => ({
      activeTabId,
      closeTab,
      openDiffTab,
      selectTab,
      tabs,
    }),
    [activeTabId, closeTab, openDiffTab, selectTab, tabs],
  )

  return (
    <DiffPreviewTabsContext.Provider value={value}>
      {children}
    </DiffPreviewTabsContext.Provider>
  )
}

export function useDiffPreviewTabs() {
  const value = useContext(DiffPreviewTabsContext)
  if (!value) {
    throw new Error("useDiffPreviewTabs must be used within DiffPreviewTabsProvider")
  }
  return value
}

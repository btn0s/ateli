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
  activeTab: DiffPreviewTab | null
  activeTabId: string | null
  canvasSelected: boolean
  closeTab: (id: string) => void
  openDiffTab: (tab: DiffPreviewTab) => void
  selectCanvas: () => void
  selectTab: (id: string) => void
  tabs: DiffPreviewTab[]
}

const DiffPreviewTabsContext =
  createContext<DiffPreviewTabsContextValue | null>(null)

export function DiffPreviewTabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<DiffPreviewTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>("canvas")

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
        return next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? "canvas"
      })
      return next
    })
  }, [])

  const selectTab = useCallback((id: string) => {
    setActiveTabId(id)
  }, [])

  const selectCanvas = useCallback(() => {
    setActiveTabId("canvas")
  }, [])

  const activeTab = useMemo(
    () =>
      activeTabId === "canvas"
        ? null
        : (tabs.find((tab) => tab.id === activeTabId) ?? null),
    [activeTabId, tabs]
  )

  const canvasSelected = activeTabId === "canvas"

  const value = useMemo(
    () => ({
      activeTab,
      activeTabId,
      canvasSelected,
      closeTab,
      openDiffTab,
      selectCanvas,
      selectTab,
      tabs,
    }),
    [
      activeTab,
      activeTabId,
      canvasSelected,
      closeTab,
      openDiffTab,
      selectCanvas,
      selectTab,
      tabs,
    ]
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
    throw new Error(
      "useDiffPreviewTabs must be used within DiffPreviewTabsProvider"
    )
  }
  return value
}

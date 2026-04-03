import type { MutableRefObject } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { File } from "lucide-react"
import { getRepoPath } from "@/lib/default-actions"
import { SidebarPanelHeader } from "@/components/sidebar-panel-header"
import {
  SidebarTreeBranch,
  SidebarTreeRow,
} from "@/components/sidebar-tree"

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

function normalizeRoot(p: string): string {
  return p.replace(/[/\\]+$/, "") || p
}

function pathDepth(p: string): number {
  return p.split(/[/\\]/).filter(Boolean).length
}

function FileTreeRows({
  rootPath,
  expanded,
  toggleDir,
  cacheRef,
}: {
  rootPath: string
  expanded: Set<string>
  toggleDir: (path: string) => void
  cacheRef: MutableRefObject<Map<string, DirEntry[]>>
}) {
  const entries = cacheRef.current.get(rootPath)
  if (!entries) return null

  return (
    <>
      {entries.map((entry) => (
        <div key={entry.path}>
          {entry.isDirectory ? (
            <>
              <SidebarTreeRow>
                <SidebarTreeRow.Trigger
                  onClick={() => toggleDir(entry.path)}
                  title={entry.path}
                >
                  <SidebarTreeRow.Disclosure
                    expanded={expanded.has(entry.path)}
                  />
                  <SidebarTreeRow.Label>{entry.name}</SidebarTreeRow.Label>
                </SidebarTreeRow.Trigger>
                <SidebarTreeRow.AlignedEnd />
              </SidebarTreeRow>
              {expanded.has(entry.path) && (
                <SidebarTreeBranch>
                  <SidebarTreeBranch.Ruler />
                  <SidebarTreeBranch.Content>
                    <FileTreeRows
                      rootPath={entry.path}
                      expanded={expanded}
                      toggleDir={toggleDir}
                      cacheRef={cacheRef}
                    />
                  </SidebarTreeBranch.Content>
                </SidebarTreeBranch>
              )}
            </>
          ) : (
            <SidebarTreeRow>
              <SidebarTreeRow.Trigger
                className="text-muted-foreground hover:text-accent-foreground"
                onClick={() => void window.electron.fs.openPath(entry.path)}
                title={entry.path}
              >
                <SidebarTreeRow.Icon>
                  <File className="size-3 shrink-0 opacity-70" />
                </SidebarTreeRow.Icon>
                <SidebarTreeRow.Label>{entry.name}</SidebarTreeRow.Label>
              </SidebarTreeRow.Trigger>
              <SidebarTreeRow.AlignedEnd />
            </SidebarTreeRow>
          )}
        </div>
      ))}
    </>
  )
}

export function FileTree() {
  const rootPath = getRepoPath()
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const r = getRepoPath()
    return r ? new Set([normalizeRoot(r)]) : new Set()
  })
  const [reloadSeq, setReloadSeq] = useState(0)
  const [, setRenderVersion] = useState(0)
  const cacheRef = useRef<Map<string, DirEntry[]>>(new Map())

  const bump = useCallback(() => {
    setRenderVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    if (!rootPath) {
      setExpanded(new Set())
      cacheRef.current = new Map()
      return
    }
    const norm = normalizeRoot(rootPath)
    setExpanded(new Set([norm]))
    cacheRef.current = new Map()
    setReloadSeq((s) => s + 1)
  }, [rootPath])

  useEffect(() => {
    if (!rootPath) return
    const norm = normalizeRoot(rootPath)
    void window.electron.fs.watchRoot(norm)
    const remove = window.electron.fs.onChanged(({ rootPath: changed }) => {
      if (normalizeRoot(changed) === norm) {
        cacheRef.current = new Map()
        setReloadSeq((s) => s + 1)
      }
    })
    return () => {
      remove()
      window.electron.fs.unwatchRoot(norm)
    }
  }, [rootPath])

  useEffect(() => {
    if (!rootPath) return
    let cancelled = false
    const norm = normalizeRoot(rootPath)
    const dirs = [...expanded].sort((a, b) => pathDepth(a) - pathDepth(b))

    ;(async () => {
      for (const dir of dirs) {
        try {
          const { entries } = await window.electron.fs.readdir(dir)
          if (cancelled) return
          cacheRef.current.set(dir, entries)
        } catch {
          if (cancelled) return
          cacheRef.current.set(dir, [])
        }
      }
      if (!cancelled) bump()
    })()

    return () => {
      cancelled = true
    }
  }, [rootPath, expanded, reloadSeq, bump])

  const toggleDir = useCallback((dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

  if (!rootPath) return null

  const norm = normalizeRoot(rootPath)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
      <SidebarPanelHeader>
        <SidebarPanelHeader.Title>Files</SidebarPanelHeader.Title>
        <SidebarPanelHeader.Trailer>
          <SidebarPanelHeader.CountSpacer />
          <SidebarPanelHeader.ActionSlot />
        </SidebarPanelHeader.Trailer>
      </SidebarPanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2">
        <FileTreeRows
          rootPath={norm}
          expanded={expanded}
          toggleDir={toggleDir}
          cacheRef={cacheRef}
        />
      </div>
    </div>
  )
}

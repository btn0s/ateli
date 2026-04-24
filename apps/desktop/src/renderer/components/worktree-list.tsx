import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { track, useEditor, useValue } from "tldraw"
import type { TLShapeId } from "tldraw"
import {
  FileTree as PierreWorktreeTreeModel,
  preparePresortedFileTreeInput,
} from "@pierre/trees"
import { FileTree as PierreWorktreeFileTree } from "@pierre/trees/react"
import type {
  ContextMenuItem as PierreContextMenuItem,
  ContextMenuOpenContext as PierreContextMenuOpenContext,
} from "@pierre/trees"
import { cn } from "@workspace/ui/lib/utils"
import { addTerminalAtCenter } from "@/lib/default-actions"
import {
  getCenterLaneScreenRect,
  zoomToSelectionInViewport,
} from "@/lib/canvas-camera"
import { collectExpandedDirectoryPaths } from "@/lib/pierre-tree-expanded"
import { SIDEBAR_PIERRE_TREE_STYLE } from "@/lib/sidebar-pierre-tree-style"
import {
  buildWorktreePierrePaths,
  resolveWorktreeFromMenuPath,
  terminalShapeIdFromLeafPath,
} from "@/lib/worktree-pierre-tree"
import { Sidebar } from "@/components/sidebar"
import {
  useWorktrees,
  type WorktreeIndexEntry,
} from "@/contexts/worktree-index-context"
import { useTerminalKillConfirmation } from "@/components/terminal-kill-dialog"
import { useWorktreeRemoveConfirmation } from "@/components/worktree-remove-dialog"
import { useWorktreeRenameConfirmation } from "@/components/worktree-rename-dialog"
import { useManagementPolicy } from "@/contexts/management-policy-context"

type WorktreeMapsRef = {
  leafPathToShapeId: Map<string, TLShapeId>
  terminalCountByDirPath: Map<string, number>
  dirPathToWt: Map<string, WorktreeIndexEntry>
}

const MENU_BTN =
  "flex w-full cursor-default items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-[13px] leading-5 outline-none select-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring"
const MENU_BTN_DESTRUCTIVE =
  "text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/30"

/** Above SidebarHud (z-1000) so portaled menus receive clicks instead of the overlay. */
const CTX_MENU_BACKDROP_Z = "z-[1100]"
const CTX_MENU_PANEL_Z = "z-[1101]"

function WorktreePierreContextPortal({
  item,
  context,
  mapsRef,
  repoPath,
  editor,
  policy,
  onAddTerminal,
  onNavigateShape,
  onCopyText,
  onReveal,
  onRename,
  onRemove,
  onKillSession,
}: {
  item: PierreContextMenuItem
  context: PierreContextMenuOpenContext
  mapsRef: MutableRefObject<WorktreeMapsRef>
  repoPath: string
  editor: ReturnType<typeof useEditor>
  policy: { user: { renameBranch: boolean } }
  onAddTerminal: (wt: WorktreeIndexEntry) => void
  onNavigateShape: (id: TLShapeId) => void
  onCopyText: (text: string) => void
  onReveal: (path: string) => void
  onRename: (wt: WorktreeIndexEntry) => void
  onRemove: (wt: WorktreeIndexEntry) => void
  onKillSession: (sessionId: string) => void
}) {
  const { anchorRect, close } = context
  const leafMap = mapsRef.current.leafPathToShapeId
  const dirPathToWt = mapsRef.current.dirPathToWt

  const wt = resolveWorktreeFromMenuPath(
    item.path,
    item.kind === "directory",
    dirPathToWt
  )

  const top = anchorRect.top + anchorRect.height + 4
  const left = anchorRect.left

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    const onPtr = (e: PointerEvent) => {
      // Opening the menu uses a right-click; don't treat that as an "outside" press.
      if (e.pointerType === "mouse" && e.button !== 0) return
      const el = e.target as HTMLElement | null
      if (el?.closest?.("[data-worktree-pierre-menu]")) return
      close()
    }
    window.addEventListener("keydown", onKey)
    // Bubble phase + stopPropagation on the menu panel so item clicks aren't
    // seen as outside presses (capture:true on window was closing / eating actions).
    window.addEventListener("pointerdown", onPtr)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPtr)
    }
  }, [close])

  const finish = () => close()

  if (item.kind === "directory" && wt) {
    const worktree = wt
    function onDirectoryMenuPointerDown(e: React.PointerEvent) {
      if (e.pointerType === "mouse" && e.button !== 0) return
      const n = e.target as Node
      const el = n instanceof Element ? n : n.parentElement
      const btn = el?.closest?.("button[data-wt-menu]") as
        | HTMLButtonElement
        | undefined
      if (!btn || btn.disabled) {
        e.stopPropagation()
        return
      }
      const action = btn.getAttribute("data-wt-menu")
      if (!action) {
        e.stopPropagation()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      switch (action) {
        case "new-terminal":
          onAddTerminal(worktree)
          finish()
          break
        case "copy-path":
          void onCopyText(worktree.path)
          finish()
          break
        case "reveal-path":
          void onReveal(worktree.path)
          finish()
          break
        case "rename-branch":
          if (!worktree.id || !policy.user.renameBranch) return
          onRename(worktree)
          finish()
          break
        case "remove-worktree":
          if (!worktree.id) return
          onRemove(worktree)
          finish()
          break
        default:
          break
      }
    }

    return createPortal(
      <>
        <div
          className={cn("fixed inset-0", CTX_MENU_BACKDROP_Z)}
          aria-hidden
          onContextMenu={(e) => e.preventDefault()}
        />
        <div
          data-worktree-pierre-menu
          className={cn(
            "fixed min-w-48 rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg",
            CTX_MENU_PANEL_Z,
          )}
          style={{
            left,
            top,
            maxWidth: "min(20rem, calc(100vw - 1rem))",
          }}
          role="menu"
          onPointerDown={onDirectoryMenuPointerDown}
        >
          <button
            type="button"
            className={MENU_BTN}
            data-wt-menu="new-terminal"
          >
            New terminal here
          </button>
          <div className="my-1 h-px bg-border" role="separator" />
          <button type="button" className={MENU_BTN} data-wt-menu="copy-path">
            Copy path
          </button>
          <button type="button" className={MENU_BTN} data-wt-menu="reveal-path">
            Reveal in Finder
          </button>
          {!worktree.isMain ? (
            <>
              <div className="my-1 h-px bg-border" role="separator" />
              <button
                type="button"
                className={cn(MENU_BTN, !worktree.id || !policy.user.renameBranch ? "pointer-events-none opacity-50" : "")}
                disabled={!worktree.id || !policy.user.renameBranch}
                data-wt-menu="rename-branch"
              >
                Rename branch…
              </button>
              <button
                type="button"
                className={cn(MENU_BTN, MENU_BTN_DESTRUCTIVE, !worktree.id ? "pointer-events-none opacity-50" : "")}
                disabled={!worktree.id}
                data-wt-menu="remove-worktree"
              >
                Remove worktree
              </button>
            </>
          ) : null}
        </div>
      </>,
      document.body,
    )
  }

  const shapeId = terminalShapeIdFromLeafPath(item.path, leafMap)
  if (!shapeId) {
    return null
  }
  const shape = editor.getShape(shapeId)
  if (!shape || shape.type !== "terminal") {
    return null
  }
  const props = shape.props as { cwd?: string; sessionId?: string }
  const terminalShapeId = shapeId

  function onTerminalMenuPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return
    const n = e.target as Node
    const el = n instanceof Element ? n : n.parentElement
    const btn = el?.closest?.("button[data-wt-menu]") as
      | HTMLButtonElement
      | undefined
    if (!btn || btn.disabled) {
      e.stopPropagation()
      return
    }
    const action = btn.getAttribute("data-wt-menu")
    if (!action) {
      e.stopPropagation()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    switch (action) {
      case "focus-canvas":
        onNavigateShape(terminalShapeId)
        finish()
        break
      case "copy-cwd":
        if (!props.cwd) return
        void onCopyText(props.cwd)
        finish()
        break
      case "reveal-cwd":
        if (!props.cwd) return
        void onReveal(props.cwd)
        finish()
        break
      case "kill-session":
        if (!props.sessionId) return
        onKillSession(props.sessionId)
        finish()
        break
      default:
        break
    }
  }

  return createPortal(
    <>
      <div
        className={cn("fixed inset-0", CTX_MENU_BACKDROP_Z)}
        aria-hidden
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        data-worktree-pierre-menu
        className={cn(
          "fixed min-w-44 rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg",
          CTX_MENU_PANEL_Z,
        )}
        style={{
          left,
          top,
          maxWidth: "min(20rem, calc(100vw - 1rem))",
        }}
        role="menu"
        onPointerDown={onTerminalMenuPointerDown}
      >
        <button type="button" className={MENU_BTN} data-wt-menu="focus-canvas">
          Focus on canvas
        </button>
        {props.cwd ? (
          <>
            <button type="button" className={MENU_BTN} data-wt-menu="copy-cwd">
              Copy cwd
            </button>
            <button type="button" className={MENU_BTN} data-wt-menu="reveal-cwd">
              Reveal in Finder
            </button>
          </>
        ) : null}
        <div className="my-1 h-px bg-border" role="separator" />
        <button
          type="button"
          className={cn(
            MENU_BTN,
            "justify-between",
            MENU_BTN_DESTRUCTIVE,
            !props.sessionId ? "pointer-events-none opacity-50" : "",
          )}
          disabled={!props.sessionId}
          data-wt-menu="kill-session"
        >
          <span>Kill session</span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
            ⌘⌫
          </span>
        </button>
      </div>
    </>,
    document.body,
  )
}

export const WorktreeList = track(function WorktreeList({
  repoPath,
}: {
  repoPath: string
}) {
  const editor = useEditor()
  const worktrees = useWorktrees()
  const { requestKill, dialog: killDialog } = useTerminalKillConfirmation()
  const { requestRemove, dialog: removeDialog } = useWorktreeRemoveConfirmation()
  const { requestRename, dialog: renameDialog } = useWorktreeRenameConfirmation()
  const { policy } = useManagementPolicy()

  const mapsRef = useRef<WorktreeMapsRef>({
    leafPathToShapeId: new Map(),
    terminalCountByDirPath: new Map(),
    dirPathToWt: new Map(),
  })
  const navigateRef = useRef<(id: TLShapeId) => void>(() => {})
  const dirPathsRef = useRef<string[]>([])

  const terminalFingerprint = useValue(
    "worktree-list-terminal-fp",
    () =>
      editor
        .getCurrentPageShapes()
        .filter((s) => s.type === "terminal")
        .map((s) => s.id)
        .join(","),
    [editor],
  )

  const treeModelRef = useRef<PierreWorktreeTreeModel | null>(null)
  if (treeModelRef.current === null) {
    treeModelRef.current = new PierreWorktreeTreeModel({
      composition: {
        contextMenu: {
          enabled: true,
          triggerMode: "both",
          buttonVisibility: "always",
        },
      },
      initialExpansion: "closed",
      paths: [],
      search: false,
      onSelectionChange(paths) {
        const p = paths[0]
        if (!p) return
        const id = mapsRef.current.leafPathToShapeId.get(p)
        if (id) navigateRef.current(id)
      },
      renderRowDecoration(ctx) {
        if (ctx.item.kind !== "directory") return null
        const dirPath = ctx.item.path.endsWith("/")
          ? ctx.item.path
          : `${ctx.item.path}/`
        const n = mapsRef.current.terminalCountByDirPath.get(dirPath) ?? 0
        return { text: String(n), title: "Canvas terminals in this worktree" }
      },
    })
  }
  const treeModel = treeModelRef.current

  const navigateToShape = useCallback(
    (shapeId: TLShapeId) => {
      editor.select(shapeId)
      zoomToSelectionInViewport(editor, {
        maxTargetZoom: 1,
        zoomOutFactor: 0.9,
        screenRect: getCenterLaneScreenRect(editor),
      })
    },
    [editor],
  )
  navigateRef.current = navigateToShape

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
  }

  async function revealInFinder(p: string) {
    try {
      await window.electron.fs.openPath(p)
    } catch {
      // ignore
    }
  }

  function addTerminalForWorktree(wt: WorktreeIndexEntry) {
    const cwd = wt.isMain ? repoPath : wt.path
    addTerminalAtCenter(editor, { cwd })
  }

  function removeWorktree(wt: WorktreeIndexEntry) {
    if (!wt.id || wt.isMain) return
    requestRemove({
      repoPath,
      id: wt.id,
      branch: wt.branch,
      path: wt.path,
    })
  }

  function renameBranch(wt: WorktreeIndexEntry) {
    if (!wt.id || wt.isMain) return
    requestRename({
      repoPath,
      id: wt.id,
      currentBranch: wt.branch,
    })
  }

  useEffect(() => {
    dirPathsRef.current = []
  }, [repoPath])

  useEffect(() => {
    const terminalShapes = editor
      .getCurrentPageShapes()
      .filter((s) => s.type === "terminal")
    const built = buildWorktreePierrePaths(repoPath, worktrees, terminalShapes)
    mapsRef.current = {
      leafPathToShapeId: built.leafPathToShapeId,
      terminalCountByDirPath: built.terminalCountByDirPath,
      dirPathToWt: built.dirPathToWt,
    }

    const fromModel = collectExpandedDirectoryPaths(
      treeModel,
      dirPathsRef.current,
    )
    const initialExpanded =
      fromModel.length > 0
        ? fromModel.filter((p) => built.directoryPaths.includes(p))
        : built.directoryPaths.filter((p) => p === "main/")
    dirPathsRef.current = built.directoryPaths
    const prepared = preparePresortedFileTreeInput(built.paths)
    // Pass paths only via preparedInput; supplying both raw paths and prepared
    // input throws if default sort reorders relative to presorted paths.
    treeModel.resetPaths(undefined as unknown as string[], {
      preparedInput: prepared,
      initialExpandedPaths: initialExpanded,
    })
  }, [repoPath, worktrees, terminalFingerprint, editor, treeModel])

  const renderContextMenu = useCallback(
    (item: PierreContextMenuItem, context: PierreContextMenuOpenContext) =>
      (
        <WorktreePierreContextPortal
          key={item.path}
          item={item}
          context={context}
          mapsRef={mapsRef}
          repoPath={repoPath}
          editor={editor}
          policy={policy}
          onAddTerminal={addTerminalForWorktree}
          onNavigateShape={navigateToShape}
          onCopyText={copyText}
          onReveal={revealInFinder}
          onRename={renameBranch}
          onRemove={removeWorktree}
          onKillSession={(sessionId) => requestKill({ sessionId })}
        />
      ) as ReactNode,
    [repoPath, editor, policy, navigateToShape, requestKill, mapsRef, terminalFingerprint],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Sidebar.Section className="min-h-0 flex-1 overflow-hidden px-0 [scrollbar-gutter:stable]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <PierreWorktreeFileTree
              aria-label="Worktrees and canvas terminals"
              model={treeModel}
              style={SIDEBAR_PIERRE_TREE_STYLE}
              renderContextMenu={renderContextMenu}
            />
          </div>
        </div>
      </Sidebar.Section>
      {killDialog}
      {removeDialog}
      {renameDialog}
    </div>
  )
})

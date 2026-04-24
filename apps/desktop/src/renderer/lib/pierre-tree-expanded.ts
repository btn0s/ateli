import type { FileTree } from "@pierre/trees"

/** Reads which directory paths are expanded (for preserving expansion across `resetPaths`). */
export function collectExpandedDirectoryPaths(
  model: FileTree,
  directoryPaths: readonly string[],
): string[] {
  const expanded: string[] = []
  for (const p of directoryPaths) {
    const item = model.getItem(p)
    if (!item || !("isExpanded" in item)) continue
    if (item.isExpanded()) expanded.push(p)
  }
  return expanded
}

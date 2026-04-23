import path from "node:path"

/** True if `child` is `parent` or a path strictly inside it (avoids /a/b vs /a/b-other prefix bug). */
export function isPathInside(child: string, parent: string): boolean {
  const a = path.resolve(child)
  const b = path.resolve(parent)
  if (a === b) {
    return true
  }
  const prefix = b.endsWith(path.sep) ? b : b + path.sep
  return a.startsWith(prefix)
}

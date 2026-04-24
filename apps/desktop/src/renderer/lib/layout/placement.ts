import { GUTTER, MAX_SPIRAL_ITERS, SPIRAL_STEP } from "./constants"
import { centroidOf, inflate, rectsOverlap, snap } from "./geometry"
import { scoreCluster } from "./weight"
import type { Cluster, Rect, ShapeRect } from "./types"

const GOLDEN_ANGLE_RAD = 2.3998 // ≈ 137.5°

export function pickAnchor(
  clusters: Cluster[],
  targetGroupKey: string,
  viewport: Rect,
  now: number,
  size: { w: number; h: number }
): { x: number; y: number } {
  let best: Cluster | null = null
  let bestScore = 0
  for (const c of clusters) {
    const s = scoreCluster(c, targetGroupKey, now)
    if (s > bestScore) {
      best = c
      bestScore = s
    }
  }

  if (best) {
    const members = best.shapes.filter((s) => s.groupKey === targetGroupKey)
    const centroid = centroidOf(members)
    return { x: centroid.x - size.w / 2, y: centroid.y - size.h / 2 }
  }

  const free = largestFreeRect(viewport, clusters, size)
  if (free) {
    return {
      x: free.x + free.w / 2 - size.w / 2,
      y: free.y + free.h / 2 - size.h / 2,
    }
  }

  return {
    x: viewport.x + viewport.w / 2 - size.w / 2,
    y: viewport.y + viewport.h / 2 - size.h / 2,
  }
}

/**
 * Coarse free-rect finder: scans axis-aligned horizontal bands between cluster bboxes
 * and picks the widest band tall enough to fit `size` with GUTTER. Not a true MER —
 * good enough to bias placement toward visibly-empty space.
 */
function largestFreeRect(
  viewport: Rect,
  clusters: Cluster[],
  size: { w: number; h: number }
): Rect | null {
  if (clusters.length === 0) return viewport
  const ys: number[] = [viewport.y, viewport.y + viewport.h]
  for (const c of clusters) {
    ys.push(c.bounds.y - GUTTER, c.bounds.y + c.bounds.h + GUTTER)
  }
  ys.sort((a, b) => a - b)
  let best: Rect | null = null
  for (let i = 0; i < ys.length - 1; i++) {
    const top = ys[i]
    const bot = ys[i + 1]
    const height = bot - top
    if (height < size.h + GUTTER * 2) continue
    const bandRect: Rect = {
      x: viewport.x,
      y: top,
      w: viewport.w,
      h: height,
    }
    let blocked = false
    for (const c of clusters) {
      if (rectsOverlap(inflate(c.bounds, GUTTER), bandRect)) {
        blocked = true
        break
      }
    }
    if (!blocked && (!best || bandRect.w * bandRect.h > best.w * best.h)) {
      best = bandRect
    }
  }
  return best
}

export function spiralSearch(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  obstacles: Rect[]
): { x: number; y: number } {
  const candidate = (x: number, y: number): Rect => ({ x, y, w: size.w, h: size.h })

  const fits = (c: Rect): boolean => {
    const padded = inflate(c, GUTTER)
    for (const o of obstacles) {
      if (rectsOverlap(padded, o)) return false
    }
    return true
  }

  const first = candidate(anchor.x, anchor.y)
  if (fits(first)) return { x: anchor.x, y: anchor.y }

  // Vogel/sunflower spiral sampled at SPIRAL_STEP; golden-angle for uniform-density disk sampling.
  for (let i = 1; i < MAX_SPIRAL_ITERS; i++) {
    const t = i * 0.5
    const r = SPIRAL_STEP * Math.sqrt(t)
    const theta = t * GOLDEN_ANGLE_RAD
    const x = snap(anchor.x + r * Math.cos(theta), SPIRAL_STEP)
    const y = snap(anchor.y + r * Math.sin(theta), SPIRAL_STEP)
    if (fits(candidate(x, y))) return { x, y }
  }

  // Last-resort linear sweep along +x.
  let x = snap(anchor.x, SPIRAL_STEP)
  while (true) {
    x += SPIRAL_STEP
    if (fits(candidate(x, anchor.y))) return { x, y: anchor.y }
    if (x - anchor.x > 1_000_000) return { x: anchor.x, y: anchor.y }
  }
}

export function obstaclesFromShapes(shapes: ShapeRect[]): Rect[] {
  return shapes.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }))
}

import type { Rect, ShapeRect } from "./types"

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  )
}

export function inflate(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
}

export function boundsOf(shapes: ShapeRect[]): Rect {
  if (shapes.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of shapes) {
    if (s.x < minX) minX = s.x
    if (s.y < minY) minY = s.y
    if (s.x + s.w > maxX) maxX = s.x + s.w
    if (s.y + s.h > maxY) maxY = s.y + s.h
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function centroidOf(shapes: ShapeRect[]): { x: number; y: number } {
  if (shapes.length === 0) return { x: 0, y: 0 }
  let sx = 0
  let sy = 0
  for (const s of shapes) {
    sx += s.x + s.w / 2
    sy += s.y + s.h / 2
  }
  return { x: sx / shapes.length, y: sy / shapes.length }
}

export function snap(v: number, step: number): number {
  return Math.round(v / step) * step
}

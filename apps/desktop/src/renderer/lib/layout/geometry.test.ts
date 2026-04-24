import { describe, expect, it } from "vitest"
import { rectsOverlap, inflate, boundsOf, snap, centroidOf } from "./geometry"

describe("rectsOverlap", () => {
  it("returns true when rects share any area", () => {
    expect(
      rectsOverlap(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 5, y: 5, w: 10, h: 10 }
      )
    ).toBe(true)
  })
  it("returns false when rects only touch edges", () => {
    expect(
      rectsOverlap(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 10, y: 0, w: 10, h: 10 }
      )
    ).toBe(false)
  })
  it("returns false when rects are far apart", () => {
    expect(
      rectsOverlap(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 100, y: 100, w: 10, h: 10 }
      )
    ).toBe(false)
  })
})

describe("inflate", () => {
  it("expands by pad on each side", () => {
    expect(inflate({ x: 10, y: 20, w: 30, h: 40 }, 5)).toEqual({
      x: 5,
      y: 15,
      w: 40,
      h: 50,
    })
  })
})

describe("boundsOf", () => {
  it("returns tight bbox of shapes", () => {
    const bounds = boundsOf([
      { id: "a", x: 0, y: 0, w: 10, h: 10, groupKey: "g", lastUsedAt: 0 },
      { id: "b", x: 20, y: 30, w: 10, h: 10, groupKey: "g", lastUsedAt: 0 },
    ])
    expect(bounds).toEqual({ x: 0, y: 0, w: 30, h: 40 })
  })
})

describe("snap", () => {
  it("rounds to nearest step", () => {
    expect(snap(43, 40)).toBe(40)
    expect(snap(61, 40)).toBe(80)
  })
})

describe("centroidOf", () => {
  it("averages shape centers", () => {
    expect(
      centroidOf([
        { id: "a", x: 0, y: 0, w: 10, h: 10, groupKey: "g", lastUsedAt: 0 },
        { id: "b", x: 20, y: 20, w: 10, h: 10, groupKey: "g", lastUsedAt: 0 },
      ])
    ).toEqual({ x: 15, y: 15 })
  })
})

import { describe, expect, it } from "vitest"
import { tokenize } from "./search"

describe("tokenize", () => {
  it("splits on delimiter character classes, not a multi-char string", () => {
    expect(tokenize("a,b/c")).toEqual(["a", "b", "c"])
  })

  it("treats consecutive delimiters as one", () => {
    expect(tokenize("foo  bar")).toEqual(["foo", "bar"])
  })
})

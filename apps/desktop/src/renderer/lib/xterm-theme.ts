import type { ITheme } from "@xterm/xterm"

/**
 * Resolve a CSS custom property to a concrete color string (`rgb(...)`)
 * so we can hand it to xterm, which can't parse raw `oklch(...)` values.
 */
function resolveColor(varName: string): string {
  const el = document.createElement("div")
  el.style.display = "none"
  el.style.color = `var(${varName})`
  document.body.appendChild(el)
  const resolved = getComputedStyle(el).color
  document.body.removeChild(el)
  return resolved
}

/**
 * Build an xterm theme that tracks the Quiet palette. `surface` picks whether
 * the terminal sits on a `--card` surface (canvas shape, sidebar panel) or on
 * the root `--background`.
 */
export function buildXtermTheme(surface: "card" | "background" = "card"): ITheme {
  const bg = resolveColor(surface === "card" ? "--card" : "--background")
  const fg = resolveColor("--foreground")
  const muted = resolveColor("--muted-foreground")

  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: "rgba(255, 255, 255, 0.12)",
    black: bg,
    brightBlack: muted,
    white: fg,
    brightWhite: fg,
  }
}

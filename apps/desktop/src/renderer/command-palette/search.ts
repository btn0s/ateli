import type {
  CommandDefinition,
  CommandExecutionContext,
  ScoredCommand,
} from "./types"
import { getRecencyOrder, getRecencyScore } from "./recency"

/** Per-provider ordering stability (higher = earlier when text/context ties). */
const MODEL_GROUP_BAND: Record<CommandDefinition["group"], number> = {
  suggested: 6,
  navigation: 5,
  worktree: 5,
  terminal: 5,
  create: 4,
  canvas: 4,
  action: 3,
}

/** Splits on runs of delimiter chars (avoids string.split treating the whole literal as a single token). */
const TOKEN_SEP = /[\s,./\-_:;]+/

/** Exported for unit tests. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(TOKEN_SEP)
    .map((t) => t.trim())
    .filter(Boolean)
}

function textScoreFor(query: string, def: CommandDefinition): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const title = def.title.toLowerCase()
  const blob = [title, def.subtitle, ...def.keywords, ...tokenize(def.title)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (title === q) return 1000
  if (title.startsWith(q)) return 960
  if (title.includes(q)) return 780
  for (const w of tokenize(def.title + " " + def.subtitle + " " + def.keywords.join(" "))) {
    if (w.startsWith(q) && w.length > 0) return 900
  }
  if (blob.includes(q)) return 720
  if (fuzzyAccepts(q, title)) return 500
  return 0
}

function fuzzyAccepts(q: string, s: string): boolean {
  if (q.length === 0) return true
  let qi = 0
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) qi++
  }
  return qi === q.length
}

function compareCommands(a: ScoredCommand, b: ScoredCommand): number {
  const ta =
    a.textScore * 1_000_000 +
    a.contextScore * 10_000 +
    a.recencyScore * 100 +
    a.band
  const tb =
    b.textScore * 1_000_000 +
    b.contextScore * 10_000 +
    b.recencyScore * 100 +
    b.band
  if (ta !== tb) return tb - ta
  if (a.textScore !== b.textScore) return b.textScore - a.textScore
  if (a.contextScore !== b.contextScore) return b.contextScore - a.contextScore
  if (a.recencyScore !== b.recencyScore) return b.recencyScore - a.recencyScore
  return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
}

export function scoreCommands(
  defs: CommandDefinition[],
  execBase: CommandExecutionContext,
  query: string,
): ScoredCommand[] {
  const q = query.trim()
  const scope = execBase.palette.repoPath
  const recencyOrder = getRecencyOrder(scope)

  const out: ScoredCommand[] = []
  for (const def of defs) {
    if (!def.when(execBase)) continue
    const text = q ? textScoreFor(q, def) : 0
    if (q && text === 0) continue

    const contextScore = def.score ? def.score(execBase) : 0
    const recencyScore = getRecencyScore(scope ?? "", def.id, recencyOrder)
    const band = MODEL_GROUP_BAND[def.group] ?? 0
    out.push({
      def,
      textScore: q ? text : 1,
      contextScore,
      recencyScore: q ? recencyScore * 0.5 : recencyScore,
      band,
      sortKey: def.id,
    })
  }

  if (!q) {
    out.forEach((s) => {
      s.textScore = 1
    })
  }

  out.sort(compareCommands)
  return out
}

/**
 * For an empty search query, partition into Recent / Suggested / Navigation / Actions
 * (deterministic; preserves global `scored` order when picking from the tail).
 */
export function bucketEmptyQuery(
  scored: ScoredCommand[],
  recentDefs: CommandDefinition[],
): { section: string; items: CommandDefinition[] }[] {
  const recent = recentDefs
  const inRecent = new Set(recent.map((d) => d.id))
  const used = new Set(inRecent)
  const tail = scored.filter((s) => !inRecent.has(s.def.id)).map((s) => s.def)

  const pick = (pred: (d: CommandDefinition) => boolean) => {
    const out: CommandDefinition[] = []
    for (const d of tail) {
      if (used.has(d.id)) continue
      if (pred(d)) {
        out.push(d)
        used.add(d.id)
      }
    }
    return out
  }

  const suggested = pick(
    (d) =>
      d.emptyQuerySection === "suggested" ||
      d.group === "create" ||
      d.group === "suggested"
  )
  const navigation = pick(
    (d) =>
      d.emptyQuerySection === "navigation" ||
      d.group === "navigation" ||
      d.group === "worktree" ||
      d.group === "terminal"
  )
  const actions = pick(() => true)

  const sections: { section: string; items: CommandDefinition[] }[] = []
  if (recent.length) sections.push({ section: "Recent", items: recent })
  if (suggested.length) sections.push({ section: "Suggested", items: suggested })
  if (navigation.length) sections.push({ section: "Navigation", items: navigation })
  if (actions.length) sections.push({ section: "Actions", items: actions })
  return sections
}

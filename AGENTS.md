# Agents

## Rules

- Never run dev servers or start the application. The user will do this themselves.

## UI: “Luminous” floating surfaces

Ateli’s floating UI (command palette, modals, popovers) uses a **luminous** language: a soft **modal scrim** (gradient, not flat black) + a **glassy panel** (inset specular + deep ambient shadow, light backdrop blur) + **top-of-surface** stripes on dense chrome. **Skeuo-lite** = that same specular read on **docked** surfaces (slab / ledger), slightly **recessed** fields (`ateli-skeuo-input-dish`) and **wells** (errors, keylines), and **inset** selected tabs / pills (`ateli-skeuo-pill-inset`) so controls feel a bit *set into* the glass, not printed on it.

**Source of truth**

- `packages/ui/src/styles/globals.css` — CSS variables and utilities: `ateli-surface-luminous` (modals, palette), `ateli-surface-luminous-floater` (bottom tool strip), `ateli-surface-slab` (docked inlays, diff body, shape chrome), `ateli-skeuo-dock` (sidebar body gradient on top of luminous), `ateli-chrome-ledger` (center tab bar), `ateli-overlay-scrim`, `ateli-surface-input-stripe`, `ateli-specular-hairline`, `ateli-skeuo-divider`, `ateli-skeuo-well`, `ateli-skeuo-input-dish`, `ateli-skeuo-pill-inset`
- `apps/desktop/src/renderer/command-palette/CommandPalette.tsx` — reference layout that composes the utilities
- `packages/ui/src/components/command.tsx` — search strip, **dish**-inset `InputGroup`, gradient **dividers** between groups
- `DiffPreviewTabs` (center) — `ateli-chrome-ledger` + `ateli-surface-slab` on the diff pane; `ShapeChrome` — glass slab + input-style header

**When to use**

- New overlay, modal shell, or palette-style surface → compose `ateli-surface-luminous` (and matching border/background) instead of ad-hoc `shadow-[…]` and gradient strings
- New full-screen or portal backdrop → `ateli-overlay-scrim` on the `fixed inset-0` layer
- A band under a top control row → `ateli-surface-input-stripe` (or the same border + `from-muted/20` pattern)
- Pills, badges, tiny chips on dark panels → `ateli-specular-hairline` for a 1px “lit” top edge
- **Bottom-docked** toolbars or other small **floating** bars → `ateli-surface-luminous-floater` (tighter drop shadow + extra bottom inset for a slight “seated in glass” read). See `Canvas` `CustomToolbar`
- **Tall docked** panes and **inlays** (diff preview, embedded shape chrome) → `ateli-surface-slab` + optional `bg-gradient-to-b from-card/…`; **center tab strip** → `ateli-chrome-ledger`
- **Sidebars** → keep `ateli-surface-luminous` and add `ateli-skeuo-dock` so the column has a subtle top “sky”
- **Selected tab chips** (sidebar or diff) → `ateli-skeuo-pill-inset` on the pill (already in `SidebarTabButton` when selected)
- **Search / compact inputs** in command UI → `ateli-skeuo-input-dish` on the `InputGroup`
- **Soft horizontal rules** between list sections → `ateli-skeuo-divider` instead of flat `h-px bg-border`
- **Error / key notice bands** in the palette → `ateli-skeuo-well` plus semantic border + tint

Tweak the look globally by editing `--ateli-surface-luminous-shadow`, `--ateli-surface-floater-shadow`, `--ateli-surface-slab-shadow`, `--ateli-skeuo-*`, and `--ateli-overlay-scrim` in `globals.css`, not scattered components.

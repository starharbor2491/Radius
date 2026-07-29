# Radius design system

The chrome is dense, quiet, and reads as one surface. Everything below is a rule
the code follows, not a preference — if a component breaks one of these, that is
a bug in the component.

The stylesheet holds no literal values (see `CLAUDE.md`), so every rule here is
expressed as a `--rx-*` token. Changing the rule changes the whole UI at once,
which is the point.

## Type

Four roles, and only four. A screen that needs a fifth needs restructuring, not
a new size.

| Role | Token | Weight | Used for |
|---|---|---|---|
| Section label | `--rx-text-n2`, uppercase, tracked | medium | The label above a group of cards |
| Secondary | `--rx-text-n1` | normal | Metadata, hints, counts, timestamps |
| Body | `--rx-text-0` | normal | Everything by default |
| Title | `--rx-text-1` | bold | Panel titles, card headings |

Two rules that matter more than the sizes:

- **Hierarchy comes from weight and colour before size.** The scale is tight on
  purpose (13px base, 1.15 ratio) because a browser chrome is dense; a title
  that is 2px larger and 200 weights heavier reads as a title, and one that is
  8px larger just wastes a row.
- **Three text colours, no more.** `--rx-color-text` for what you read,
  `--rx-color-text-muted` for what supports it, `--rx-color-text-faint` for what
  you only notice when you look for it. Disabled is not a fourth colour — it is
  reduced opacity on whichever of the three applies.

## Spacing

One rhythm, from the space scale. Within a component, gaps step by one; between
components, by two.

| Distance | Token |
|---|---|
| Icon to its label | `--rx-space-1` |
| Between controls in a row | `--rx-space-2` |
| Between rows in a card | `--rx-space-2` |
| Card padding | `--rx-space-3` |
| Between cards | `--rx-space-3` |
| Between sections | `--rx-space-5` |

A section label sits `--rx-space-2` above its content and `--rx-space-5` below
whatever came before, so the label is visibly attached to what it labels rather
than floating between two things.

## Elevation

Four surfaces, in order. Nothing sits on a surface of the same level.

`--rx-color-bg` (the window) → `--rx-color-surface-1` (rail, sidebar) →
`--rx-color-surface-2` (cards, rows) → `--rx-color-surface-3` (inputs, chips).

Glass is a property of the four named surface roles (`chrome`, `panel`,
`popover`, `overlay`), not a decoration to sprinkle. A popover is never the same
material as the chrome behind it, or it disappears into it.

## Interactive states

Every interactive element answers all five. A control that only styles `:hover`
looks unfinished the moment someone uses a keyboard.

| State | Treatment |
|---|---|
| Rest | Transparent or `surface-2`, text muted |
| Hover | One surface level up, text to full |
| Active/pressed | Same surface, `transform: scale(0.98)` through motion tokens |
| Selected | Accent border or accent-tinted background, text full, weight medium |
| Focus-visible | 2px accent ring, 2px offset — never removed, never only on `:focus` |
| Disabled | `opacity: var(--rx-opacity-disabled)`, `cursor: not-allowed`, no hover |

Hit targets are at least 28px tall at density 1. A 20px row with a 12px close
button is a target people miss.

## Content rules

These are where a UI usually gives itself away.

- **Everything that can be long, truncates.** Tab titles, page titles, model
  ids, provider labels, file names, history entries. `min-width: 0` on the flex
  child, `text-overflow: ellipsis`, and the full value in a `title`.
- **Lists have a shape.** Above roughly eight rows a flat list needs grouping,
  a sticky header, or a search field. The keybinding editor and the command
  palette both earn one.
- **Empty states say what to do**, in body text, not in the faintest colour on
  the palette. An empty panel is the first thing a new user sees.
- **Numbers that are not known are absent.** Consistent with the AI layer: no
  fabricated cost, no invented progress bar, no fake percentage.
- **Scrollbars are styled.** A default Chromium scrollbar next to a themed panel
  is the single loudest tell that the surface was not looked at.
- **Accelerators render per platform.** `⌘⇧T` on macOS, `Ctrl+Shift+T`
  elsewhere — the same binding, formatted for the machine it is shown on.

## Motion

Every animation pulls its physics from `useMotionTokens()`. No component writes
a duration or a spring. Motion communicates one of three things and nothing
else: that something arrived, that something moved from A to B, or that
something is still working. Decoration that says none of those is off by
default.

`prefers-reduced-motion` and the motion-off setting must both actually stop
animation, not shorten it.

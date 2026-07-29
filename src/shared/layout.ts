import { z } from 'zod'

/**
 * The layout document.
 *
 * The chrome used to hardcode where each panel lived: a sidebar on the left, a
 * toolbar on top, and one right-hand panel showing whichever of the seven
 * surfaces was last opened. This describes that arrangement as *data* instead,
 * so a panel can be docked in a different region and the choice can be stored
 * per workspace.
 *
 * Everything in this file is pure. The moves (`movePanel`, `resizeRegion`,
 * `setActive`) return a new document rather than mutating one, which is what
 * lets `tests/layout.test.ts` cover them without an Electron window anywhere
 * near it. Main applies them and pushes the result back as a snapshot; the
 * renderer never edits a layout in place.
 */

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

/**
 * The dockable surfaces. This is exactly the set the right panel used to switch
 * between -- the tab strip and the toolbar are the window's own furniture, not
 * panels, so they are deliberately absent.
 */
export const PANEL_IDS = [
  'ai',
  'agent',
  'settings',
  'theme',
  'history',
  'downloads',
  'usage'
] as const
export type PanelId = (typeof PANEL_IDS)[number]
export const PanelIdSchema = z.enum(PANEL_IDS)

/**
 * Where a panel can be docked.
 *
 * `top` is missing on purpose: the toolbar owns the top strip and a panel above
 * it would push the omnibox off the window's drag region. Floating is M4 work --
 * it needs a second WebContentsView to paint over page content without the
 * modal overlay, which is a bigger change than this one.
 */
export const REGION_IDS = ['left', 'right', 'bottom'] as const
export type RegionId = (typeof REGION_IDS)[number]
export const RegionIdSchema = z.enum(REGION_IDS)

/**
 * What a panel calls itself at the top of its own dock.
 *
 * These can be a phrase, because there is a whole panel header to hold one.
 */
export const PANEL_TITLES: Record<PanelId, string> = {
  ai: 'Assistant',
  agent: 'Working alongside you',
  settings: 'Settings',
  theme: 'Theme studio',
  history: 'History',
  downloads: 'Downloads',
  usage: 'AI usage and budget'
}

/**
 * What a panel is called in a list.
 *
 * A title that reads well as a header does not survive a table row: the layout
 * editor was showing "Working alongsid…" and "AI usage and bu…" next to a
 * control, which tells you neither what the panel is nor what the control does.
 */
export const PANEL_NAMES: Record<PanelId, string> = {
  ai: 'Assistant',
  agent: 'Agent',
  settings: 'Settings',
  theme: 'Theme',
  history: 'History',
  downloads: 'Downloads',
  usage: 'Usage'
}

export const REGION_TITLES: Record<RegionId, string> = {
  left: 'Left dock',
  right: 'Right dock',
  bottom: 'Bottom dock'
}

/** Which window axis a region's `size` measures. */
export const REGION_AXIS: Record<RegionId, 'width' | 'height'> = {
  left: 'width',
  right: 'width',
  bottom: 'height'
}

export interface RegionBounds {
  min: number
  max: number
  initial: number
}

/**
 * The right dock's numbers are the ones the hardcoded chrome shipped with, so a
 * default document reproduces the old geometry to the pixel.
 */
export const REGION_BOUNDS: Record<RegionId, RegionBounds> = {
  left: { min: 220, max: 640, initial: 320 },
  right: { min: 280, max: 720, initial: 380 },
  bottom: { min: 140, max: 640, initial: 260 }
}

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

/**
 * Nested objects use `.prefault({})` rather than `.default({})`.
 *
 * zod 4's `.default()` on an object short-circuits parsing: a document that
 * omits `regions.bottom` would get the literal default value back without its
 * own leaves ever being filled in. `.prefault()` substitutes the *input* and
 * then parses it, so a three-line layout file still resolves to a complete one.
 */
function regionSchema(region: RegionId, panels: readonly PanelId[], active: PanelId | null) {
  const bounds = REGION_BOUNDS[region]
  return z
    .object({
      /** Docked panels, in the order they are offered. */
      panels: z.array(PanelIdSchema).default([...panels]),
      /** The one panel this region is currently showing, or null when closed. */
      active: PanelIdSchema.nullable().default(active),
      /** Width for `left`/`right`, height for `bottom`. */
      size: z.number().min(bounds.min).max(bounds.max).default(bounds.initial)
    })
    .prefault({})
}

export const LayoutSchema = z
  .object({
    version: z.literal(1).default(1),
    regions: z
      .object({
        left: regionSchema('left', [], null),
        /**
         * Every panel starts docked right with none of them showing, which is
         * precisely what the hardcoded chrome did: one right-hand panel, closed
         * until a command opened it.
         */
        right: regionSchema('right', PANEL_IDS, null),
        bottom: regionSchema('bottom', [], null)
      })
      .prefault({})
  })
  .prefault({})

export type Layout = z.infer<typeof LayoutSchema>
/** One region's slice. The three are structurally identical by construction. */
export type LayoutRegion = Layout['regions'][RegionId]

/** The arrangement an existing user already has: nothing moves until they move it. */
export function defaultLayout(): Layout {
  return LayoutSchema.parse({})
}

/**
 * Reads a layout from persisted or untrusted data.
 *
 * A workspace stored before this feature existed has no `layout` key at all,
 * and a hand-edited one can be anything. Both resolve to the default rather
 * than throwing -- a browser that will not open because a layout field is
 * malformed is worse than one that opens with its panels where they started.
 */
export function parseLayout(value: unknown): Layout {
  const result = LayoutSchema.safeParse(value ?? {})
  return result.success ? result.data : defaultLayout()
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

/** Which region a panel is docked in, or null if the document has lost it. */
export function regionOf(layout: Layout, panel: PanelId): RegionId | null {
  for (const region of REGION_IDS) {
    if (layout.regions[region].panels.includes(panel)) return region
  }
  return null
}

/** True when the panel is the one its region is currently showing. */
export function isPanelOpen(layout: Layout, panel: PanelId): boolean {
  return REGION_IDS.some((region) => layout.regions[region].active === panel)
}

/** Every region currently showing something, in render order. */
export function openRegions(layout: Layout): RegionId[] {
  return REGION_IDS.filter((region) => layout.regions[region].active !== null)
}

/**
 * A short string that changes only when the chrome's *geometry* does.
 *
 * The renderer receives a fresh layout object with every state snapshot, so an
 * effect keyed on the document itself would re-run on every page title change.
 * Keying on this instead means the inset re-measurement and the resize observers
 * are rebuilt when a region actually opens, closes or resizes -- and not when a
 * favicon lands.
 */
export function layoutSignature(layout: Layout): string {
  return REGION_IDS.map((region) => {
    const slice = layout.regions[region]
    return `${region}:${slice.active ?? '-'}:${slice.size}`
  }).join('|')
}

export function clampRegionSize(region: RegionId, size: number): number {
  const bounds = REGION_BOUNDS[region]
  if (!Number.isFinite(size)) return bounds.initial
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(size)))
}

/* ------------------------------------------------------------------ *
 * Moves
 * ------------------------------------------------------------------ */

function withRegion(layout: Layout, region: RegionId, patch: Partial<LayoutRegion>): Layout {
  return {
    ...layout,
    regions: { ...layout.regions, [region]: { ...layout.regions[region], ...patch } }
  }
}

/**
 * Docks a panel in `toRegion` at `toIndex`.
 *
 * A panel exists in exactly one region, so this removes it from wherever it was
 * first. If it was the panel its old region was showing, it stays visible in
 * its new one -- dragging an open panel somewhere else should not close it. A
 * panel that was merely docked stays merely docked, so moving a hidden panel
 * never pops a region open unasked.
 */
export function movePanel(
  layout: Layout,
  panel: PanelId,
  toRegion: RegionId,
  toIndex?: number
): Layout {
  const wasShowing = isPanelOpen(layout, panel)

  let next = layout
  for (const region of REGION_IDS) {
    const current = next.regions[region]
    if (!current.panels.includes(panel)) continue
    next = withRegion(next, region, {
      panels: current.panels.filter((candidate) => candidate !== panel),
      active: current.active === panel ? null : current.active
    })
  }

  const target = next.regions[toRegion]
  const index = toIndex === undefined ? target.panels.length : clampIndex(toIndex, target.panels.length)
  const panels = [...target.panels]
  panels.splice(index, 0, panel)

  return withRegion(next, toRegion, {
    panels,
    active: wasShowing ? panel : target.active
  })
}

/**
 * Shows a panel in a region, or closes the region when `panel` is null.
 *
 * Activating a panel that is docked elsewhere moves it here rather than failing:
 * the callers are keyboard commands and toolbar buttons that name a panel, not a
 * place, and "open the assistant" should open it wherever the user has put it.
 */
export function setActive(layout: Layout, region: RegionId, panel: PanelId | null): Layout {
  if (panel === null) return withRegion(layout, region, { active: null })

  const next = layout.regions[region].panels.includes(panel)
    ? layout
    : movePanel(layout, panel, region)

  return withRegion(next, region, { active: panel })
}

/** Closes whichever region is showing this panel. A no-op if none is. */
export function closePanel(layout: Layout, panel: PanelId): Layout {
  let next = layout
  for (const region of REGION_IDS) {
    if (next.regions[region].active === panel) next = withRegion(next, region, { active: null })
  }
  return next
}

/** Shows a panel if it is hidden, hides it if it is showing. */
export function togglePanel(layout: Layout, panel: PanelId): Layout {
  if (isPanelOpen(layout, panel)) return closePanel(layout, panel)
  return setActive(layout, regionOf(layout, panel) ?? 'right', panel)
}

/** Resizes a region, clamped to bounds a user cannot drag the chrome out of. */
export function resizeRegion(layout: Layout, region: RegionId, size: number): Layout {
  return withRegion(layout, region, { size: clampRegionSize(region, size) })
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length
  return Math.min(length, Math.max(0, Math.trunc(index)))
}

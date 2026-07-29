import { describe, expect, it } from 'vitest'
import {
  LayoutSchema,
  PANEL_IDS,
  REGION_BOUNDS,
  REGION_IDS,
  clampRegionSize,
  closePanel,
  defaultLayout,
  isPanelOpen,
  layoutSignature,
  movePanel,
  openRegions,
  parseLayout,
  regionOf,
  resizeRegion,
  setActive,
  togglePanel,
  type Layout
} from '@shared/layout'

describe('the default layout', () => {
  it('reproduces the arrangement the hardcoded chrome shipped with', () => {
    const layout = defaultLayout()

    // Every panel docked right, nothing showing: exactly the old single right
    // panel, closed until a command opened it.
    expect(layout.regions.right.panels).toEqual([...PANEL_IDS])
    expect(layout.regions.right.active).toBeNull()
    expect(layout.regions.right.size).toBe(380)

    expect(layout.regions.left.panels).toEqual([])
    expect(layout.regions.bottom.panels).toEqual([])
    expect(openRegions(layout)).toEqual([])
  })

  it('gives every region a size inside its own bounds', () => {
    const layout = defaultLayout()
    for (const region of REGION_IDS) {
      expect(layout.regions[region].size).toBeGreaterThanOrEqual(REGION_BOUNDS[region].min)
      expect(layout.regions[region].size).toBeLessThanOrEqual(REGION_BOUNDS[region].max)
    }
  })
})

describe('the layout schema', () => {
  /*
   * The zod 4 trap from CLAUDE.md: `.default({})` on a nested object
   * short-circuits parsing, so the inner leaves never get their own defaults.
   * `.prefault({})` substitutes the input and then parses it. If this ever
   * regresses, a partial document loses whole regions.
   */
  it('fills inner defaults for a partial document', () => {
    const parsed = LayoutSchema.parse({ regions: { bottom: { active: 'history' } } })

    expect(parsed.regions.bottom.active).toBe('history')
    expect(parsed.regions.bottom.size).toBe(REGION_BOUNDS.bottom.initial)
    expect(parsed.regions.bottom.panels).toEqual([])
    // The regions the document never mentioned still arrive complete.
    expect(parsed.regions.right.panels).toEqual([...PANEL_IDS])
    expect(parsed.regions.left.size).toBe(REGION_BOUNDS.left.initial)
    expect(parsed.version).toBe(1)
  })

  it('resolves an empty document to the default', () => {
    expect(LayoutSchema.parse({})).toEqual(defaultLayout())
  })

  it('rejects a size outside a region bounds', () => {
    expect(() => LayoutSchema.parse({ regions: { right: { size: 4000 } } })).toThrow()
    expect(() => LayoutSchema.parse({ regions: { right: { panels: ['nope'] } } })).toThrow()
  })
})

describe('parseLayout', () => {
  it('treats a workspace with no layout at all as the default', () => {
    expect(parseLayout(undefined)).toEqual(defaultLayout())
    expect(parseLayout(null)).toEqual(defaultLayout())
  })

  it('falls back rather than throwing on a malformed document', () => {
    // A browser that refuses to open because a layout field is wrong is worse
    // than one that opens with its panels where they started.
    expect(parseLayout({ regions: { right: { size: 'wide' } } })).toEqual(defaultLayout())
    expect(parseLayout('not a layout')).toEqual(defaultLayout())
  })

  it('keeps a valid document intact', () => {
    const moved = movePanel(defaultLayout(), 'history', 'bottom')
    expect(parseLayout(moved)).toEqual(moved)
  })
})

describe('movePanel', () => {
  it('moves a panel out of one region and into another', () => {
    const layout = movePanel(defaultLayout(), 'history', 'bottom')

    expect(regionOf(layout, 'history')).toBe('bottom')
    expect(layout.regions.right.panels).not.toContain('history')
    expect(layout.regions.bottom.panels).toEqual(['history'])
  })

  it('does not mutate the document it was given', () => {
    const before = defaultLayout()
    const snapshot = JSON.stringify(before)
    movePanel(before, 'history', 'bottom')
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('keeps an open panel open in its new home', () => {
    const open = setActive(defaultLayout(), 'right', 'ai')
    const moved = movePanel(open, 'ai', 'bottom')

    expect(moved.regions.right.active).toBeNull()
    expect(moved.regions.bottom.active).toBe('ai')
    expect(isPanelOpen(moved, 'ai')).toBe(true)
  })

  it('does not open a region by moving a hidden panel into it', () => {
    const withAiOpen = setActive(defaultLayout(), 'right', 'ai')
    const moved = movePanel(withAiOpen, 'usage', 'left')

    expect(moved.regions.left.active).toBeNull()
    expect(moved.regions.left.panels).toEqual(['usage'])
    // The panel that was already showing is left alone.
    expect(moved.regions.right.active).toBe('ai')
  })

  it('inserts at the requested index and appends without one', () => {
    let layout = movePanel(defaultLayout(), 'history', 'bottom')
    layout = movePanel(layout, 'downloads', 'bottom')
    expect(layout.regions.bottom.panels).toEqual(['history', 'downloads'])

    layout = movePanel(layout, 'usage', 'bottom', 0)
    expect(layout.regions.bottom.panels).toEqual(['usage', 'history', 'downloads'])
  })

  it('reorders within one region rather than duplicating', () => {
    const layout = movePanel(defaultLayout(), 'usage', 'right', 0)

    expect(layout.regions.right.panels[0]).toBe('usage')
    expect(layout.regions.right.panels.filter((panel) => panel === 'usage')).toHaveLength(1)
    expect(layout.regions.right.panels).toHaveLength(PANEL_IDS.length)
  })

  it('clamps an index that is off the end', () => {
    const layout = movePanel(defaultLayout(), 'ai', 'bottom', 99)
    expect(layout.regions.bottom.panels).toEqual(['ai'])
  })

  it('leaves every panel docked exactly once', () => {
    let layout = defaultLayout()
    layout = movePanel(layout, 'ai', 'left')
    layout = movePanel(layout, 'agent', 'bottom')
    layout = movePanel(layout, 'ai', 'bottom')

    const docked = REGION_IDS.flatMap((region) => layout.regions[region].panels)
    expect([...docked].sort()).toEqual([...PANEL_IDS].sort())
  })
})

describe('setActive', () => {
  it('shows a panel that is already docked in the region', () => {
    const layout = setActive(defaultLayout(), 'right', 'settings')
    expect(layout.regions.right.active).toBe('settings')
  })

  it('closes a region when given null', () => {
    const layout = setActive(setActive(defaultLayout(), 'right', 'settings'), 'right', null)
    expect(layout.regions.right.active).toBeNull()
    // Closing a region hides a panel; it does not undock it.
    expect(layout.regions.right.panels).toContain('settings')
  })

  it('moves a panel that lives elsewhere rather than failing', () => {
    // Callers name a panel, not a place: "open the assistant" has to work
    // wherever the user has put it.
    const layout = setActive(defaultLayout(), 'bottom', 'ai')
    expect(layout.regions.bottom.panels).toEqual(['ai'])
    expect(layout.regions.bottom.active).toBe('ai')
    expect(layout.regions.right.panels).not.toContain('ai')
  })

  it('lets two regions show a panel each', () => {
    let layout = setActive(defaultLayout(), 'right', 'ai')
    layout = setActive(layout, 'bottom', 'history')

    expect(openRegions(layout)).toEqual(['right', 'bottom'])
    expect(isPanelOpen(layout, 'ai')).toBe(true)
    expect(isPanelOpen(layout, 'history')).toBe(true)
  })
})

describe('closePanel and togglePanel', () => {
  it('closes whichever region is showing the panel', () => {
    const layout = closePanel(setActive(defaultLayout(), 'bottom', 'history'), 'history')
    expect(openRegions(layout)).toEqual([])
  })

  it('is a no-op for a panel that is not showing', () => {
    const layout = setActive(defaultLayout(), 'right', 'ai')
    expect(closePanel(layout, 'usage')).toEqual(layout)
  })

  it('toggles a panel open and shut in place', () => {
    const docked = movePanel(defaultLayout(), 'ai', 'bottom')

    const opened = togglePanel(docked, 'ai')
    expect(opened.regions.bottom.active).toBe('ai')
    // Toggling shut must not send it back to the right dock.
    expect(togglePanel(opened, 'ai').regions.bottom.panels).toEqual(['ai'])
    expect(isPanelOpen(togglePanel(opened, 'ai'), 'ai')).toBe(false)
  })
})

describe('resizeRegion', () => {
  it('stores a size within bounds', () => {
    expect(resizeRegion(defaultLayout(), 'right', 420).regions.right.size).toBe(420)
  })

  it('clamps rather than letting a drag push a region out of the window', () => {
    expect(resizeRegion(defaultLayout(), 'right', 10).regions.right.size).toBe(
      REGION_BOUNDS.right.min
    )
    expect(resizeRegion(defaultLayout(), 'right', 5000).regions.right.size).toBe(
      REGION_BOUNDS.right.max
    )
    expect(resizeRegion(defaultLayout(), 'bottom', -40).regions.bottom.size).toBe(
      REGION_BOUNDS.bottom.min
    )
  })

  it('rounds to whole pixels and survives a NaN', () => {
    expect(clampRegionSize('right', 380.6)).toBe(381)
    expect(clampRegionSize('bottom', Number.NaN)).toBe(REGION_BOUNDS.bottom.initial)
  })

  it('leaves the other regions alone', () => {
    const layout = resizeRegion(defaultLayout(), 'left', 300)
    expect(layout.regions.right).toEqual(defaultLayout().regions.right)
  })

  it('produces a document the schema still accepts', () => {
    const layout = resizeRegion(defaultLayout(), 'left', 5000)
    expect(() => LayoutSchema.parse(layout)).not.toThrow()
  })
})

describe('layoutSignature', () => {
  it('changes when the geometry does', () => {
    const base = defaultLayout()
    expect(layoutSignature(base)).toBe(layoutSignature(defaultLayout()))
    expect(layoutSignature(setActive(base, 'right', 'ai'))).not.toBe(layoutSignature(base))
    expect(layoutSignature(resizeRegion(base, 'right', 500))).not.toBe(layoutSignature(base))
  })

  it('ignores a change that cannot move the page view', () => {
    // Reordering the docked panels changes the document but not one pixel of
    // the chrome's footprint, so the inset measurement must not be rebuilt.
    const reordered: Layout = movePanel(defaultLayout(), 'usage', 'right', 0)
    expect(layoutSignature(reordered)).toBe(layoutSignature(defaultLayout()))
  })
})

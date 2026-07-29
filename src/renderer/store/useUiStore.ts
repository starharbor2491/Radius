import { useMemo } from 'react'
import { create } from 'zustand'
import {
  clampRegionSize,
  defaultLayout,
  openRegions,
  parseLayout,
  regionOf,
  type Layout,
  type PanelId,
  type RegionId
} from '@shared/layout'
import { send } from '../lib/bridge'
import { useAppStore } from './useAppStore'

/** A panel id, or `none` for "close whatever is showing". */
export type RightPanel = PanelId | 'none'

interface UiStore {
  sidebarOpen: boolean
  sidebarWidth: number
  paletteOpen: boolean
  omniboxFocused: boolean
  bookmarksOpen: boolean
  findOpen: boolean
  toast: string | null

  /** The panel currently being dragged between regions, if any. */
  dragPanel: PanelId | null
  /** The region the pointer is over during a drag, or null for "nowhere yet". */
  dropRegion: RegionId | null

  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void

  setRightPanel: (panel: RightPanel) => void
  toggleRightPanel: (panel: PanelId) => void
  closeRegion: (region: RegionId) => void
  movePanel: (panel: PanelId, region: RegionId, index?: number) => void
  resizeRegion: (region: RegionId, size: number) => void
  resetLayout: () => void
  applyLayout: (layout: Layout) => void

  beginPanelDrag: (panel: PanelId) => void
  setDropRegion: (region: RegionId | null) => void
  endPanelDrag: () => void

  setPaletteOpen: (open: boolean) => void
  setOmniboxFocused: (focused: boolean) => void
  toggleBookmarks: () => void
  setFindOpen: (open: boolean) => void
  showToast: (message: string | null) => void
}

export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 460

/**
 * Chrome-local UI state.
 *
 * What is *here* is this window's own business -- whether the palette is open,
 * how wide the tab sidebar is, what is mid-drag. What is deliberately *not*
 * here is the layout document: where panels are docked is persisted per
 * workspace, so it lives in main and arrives as a snapshot like everything
 * else. The actions below send an IPC mutation and stop; none of them touches
 * a local copy of the layout, because a renderer that moved a panel optimistically
 * would be drawing a region main had not yet been told to inset the page around.
 *
 * Anything that changes what the chrome must paint over calls `syncOverlay`,
 * because main needs to know when to raise the chrome above the page view.
 */
export const useUiStore = create<UiStore>((set, get) => ({
  sidebarOpen: true,
  sidebarWidth: 244,
  paletteOpen: false,
  omniboxFocused: false,
  bookmarksOpen: false,
  findOpen: false,
  toast: null,
  dragPanel: null,
  dropRegion: null,

  toggleSidebar: () => set((store) => ({ sidebarOpen: !store.sidebarOpen })),
  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)) }),

  /* ----------------------------------------------------------- layout */

  setRightPanel: (panel) => {
    const target = activeWorkspace()
    if (!target) return
    if (panel === 'none') {
      // Every open region closes: the old single right panel could only ever
      // have one thing showing, so this is what "close the panel" meant.
      for (const region of openRegions(target.layout)) {
        send('layout:setActive', { workspaceId: target.id, region, panel: null })
      }
      return
    }
    send('layout:setActive', {
      workspaceId: target.id,
      region: regionOf(target.layout, panel) ?? 'right',
      panel
    })
  },

  toggleRightPanel: (panel) => {
    const target = activeWorkspace()
    if (!target) return
    const region = regionOf(target.layout, panel) ?? 'right'
    const showing = target.layout.regions[region].active === panel
    send('layout:setActive', { workspaceId: target.id, region, panel: showing ? null : panel })
  },

  closeRegion: (region) => {
    const target = activeWorkspace()
    if (!target) return
    send('layout:setActive', { workspaceId: target.id, region, panel: null })
  },

  movePanel: (panel, region, index) => {
    const target = activeWorkspace()
    if (!target) return
    send('layout:movePanel', {
      workspaceId: target.id,
      panel,
      region,
      ...(index === undefined ? {} : { index })
    })
  },

  resizeRegion: (region, size) => {
    const target = activeWorkspace()
    if (!target) return
    send('layout:resizeRegion', {
      workspaceId: target.id,
      region,
      size: clampRegionSize(region, size)
    })
  },

  resetLayout: () => {
    const target = activeWorkspace()
    if (target) send('layout:reset', { workspaceId: target.id })
  },

  applyLayout: (layout) => {
    const target = activeWorkspace()
    if (target) send('layout:set', { workspaceId: target.id, layout })
  },

  /* ------------------------------------------------------------ drag */

  /**
   * Starting a panel drag raises the chrome above the page.
   *
   * It has to: the drop targets for the left and bottom docks sit over the
   * region the page view occupies, and the chrome paints *underneath* that
   * view. Overlay mode is modal, which for a drag is the behaviour we want
   * anyway -- the page should not be taking clicks while a panel is in flight.
   */
  beginPanelDrag: (dragPanel) => {
    set({ dragPanel, dropRegion: null })
    syncOverlay(true)
  },
  setDropRegion: (dropRegion) => set({ dropRegion }),
  endPanelDrag: () => {
    set({ dragPanel: null, dropRegion: null })
    syncOverlay(get().paletteOpen || get().omniboxFocused)
  },

  setPaletteOpen: (paletteOpen) => {
    set({ paletteOpen })
    syncOverlay(paletteOpen || get().omniboxFocused || get().dragPanel !== null)
  },
  setOmniboxFocused: (omniboxFocused) => {
    set({ omniboxFocused })
    syncOverlay(omniboxFocused || get().paletteOpen || get().dragPanel !== null)
  },

  toggleBookmarks: () => set((store) => ({ bookmarksOpen: !store.bookmarksOpen })),
  // The find bar lives inside the chrome's own toolbar strip, so it needs no
  // overlay -- the page stays interactive while you search it.
  setFindOpen: (findOpen) => set({ findOpen }),
  showToast: (toast) => set({ toast })
}))

/**
 * Tells main whether the chrome needs to paint over page content. Overlay mode
 * is modal by construction (see RadiusWindow), so it is only ever on while a
 * palette, a dropdown or a panel drag is actually in flight.
 */
function syncOverlay(active: boolean): void {
  send('chrome:setOverlay', { active })
}

/**
 * The workspace a layout mutation applies to, read straight from the mirror.
 *
 * Read at call time rather than subscribed to, because these are event
 * handlers: they want the value as of the click, and subscribing would drag
 * every panel button into re-rendering on unrelated snapshots.
 */
function activeWorkspace(): { id: string; layout: Layout } | null {
  const { state } = useAppStore.getState()
  const workspace = state.workspaces.find((candidate) => candidate.id === state.activeWorkspaceId)
  if (!workspace) return null
  return { id: workspace.id, layout: parseLayout(workspace.layout) }
}

/* ------------------------------------------------------------------ *
 * Selectors
 * ------------------------------------------------------------------ */

// A stable reference so the chrome renders the default arrangement -- rather
// than nothing at all -- in the frame before the first snapshot arrives.
const FALLBACK_LAYOUT = defaultLayout()

/**
 * The active workspace's layout document.
 *
 * Derived with `useMemo` over stable slices rather than inside the selector:
 * zustand v5 compares snapshots by identity, and parsing inside the selector
 * would hand `useSyncExternalStore` a new object on every call and spin React
 * into "maximum update depth exceeded".
 */
export function useWorkspaceLayout(): Layout {
  const workspaces = useAppStore((store) => store.state.workspaces)
  const activeWorkspaceId = useAppStore((store) => store.state.activeWorkspaceId)

  return useMemo(() => {
    const workspace = workspaces.find((candidate) => candidate.id === activeWorkspaceId)
    if (!workspace) return FALLBACK_LAYOUT
    return parseLayout(workspace.layout)
  }, [workspaces, activeWorkspaceId])
}

/**
 * Every panel currently showing, for the toolbar's active states.
 *
 * A list rather than a single id because docks are independent now: the
 * assistant can be open on the right while history is open along the bottom,
 * and both buttons should read as active.
 */
export function useOpenPanels(): PanelId[] {
  const layout = useWorkspaceLayout()
  return useMemo(
    () =>
      openRegions(layout)
        .map((region) => layout.regions[region].active)
        .filter((panel): panel is PanelId => panel !== null),
    [layout]
  )
}

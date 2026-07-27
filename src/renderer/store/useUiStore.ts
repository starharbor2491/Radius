import { create } from 'zustand'
import { send } from '../lib/bridge'

export type RightPanel = 'none' | 'ai' | 'settings' | 'theme' | 'history' | 'downloads'

interface UiStore {
  sidebarOpen: boolean
  sidebarWidth: number
  rightPanel: RightPanel
  rightPanelWidth: number
  paletteOpen: boolean
  omniboxFocused: boolean
  bookmarksOpen: boolean
  findOpen: boolean
  toast: string | null

  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setRightPanel: (panel: RightPanel) => void
  toggleRightPanel: (panel: RightPanel) => void
  setRightPanelWidth: (width: number) => void
  setPaletteOpen: (open: boolean) => void
  setOmniboxFocused: (focused: boolean) => void
  toggleBookmarks: () => void
  setFindOpen: (open: boolean) => void
  showToast: (message: string | null) => void
}

export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 460
export const RIGHT_PANEL_MIN = 280
export const RIGHT_PANEL_MAX = 720

/**
 * Chrome-local UI state. Deliberately separate from the mirrored app state:
 * whether a panel is open is this window's business, not something worth a
 * round trip to main.
 *
 * Anything that changes the chrome's footprint calls `syncOverlay`, because
 * main needs to know when to raise the chrome above the page view.
 */
export const useUiStore = create<UiStore>((set, get) => ({
  sidebarOpen: true,
  sidebarWidth: 244,
  rightPanel: 'none',
  rightPanelWidth: 380,
  paletteOpen: false,
  omniboxFocused: false,
  bookmarksOpen: false,
  findOpen: false,
  toast: null,

  toggleSidebar: () => set((store) => ({ sidebarOpen: !store.sidebarOpen })),
  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)) }),

  setRightPanel: (rightPanel) => set({ rightPanel }),
  toggleRightPanel: (panel) =>
    set((store) => ({ rightPanel: store.rightPanel === panel ? 'none' : panel })),
  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, width)) }),

  setPaletteOpen: (paletteOpen) => {
    set({ paletteOpen })
    syncOverlay(paletteOpen || get().omniboxFocused)
  },
  setOmniboxFocused: (omniboxFocused) => {
    set({ omniboxFocused })
    syncOverlay(omniboxFocused || get().paletteOpen)
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
 * palette or dropdown is actually open.
 */
function syncOverlay(active: boolean): void {
  send('chrome:setOverlay', { active })
}

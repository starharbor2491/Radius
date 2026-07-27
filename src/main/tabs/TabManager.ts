import type { StateStore } from '../state/StateStore'
import type { RadiusWindow } from '../window/RadiusWindow'
import type { Tab, TabGroupColor } from '@shared/types'
import { parseOmniboxInput, resolveSearchEngine } from '@shared/url'

export const NEW_TAB_URL = 'about:blank'

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const MIN_ZOOM = ZOOM_STEPS[0]!
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!

/** Index of the ladder rung closest to an arbitrary zoom factor. */
function nearestStep(factor: number): number {
  let best = 0
  for (const [index, step] of ZOOM_STEPS.entries()) {
    if (Math.abs(step - factor) < Math.abs(ZOOM_STEPS[best]! - factor)) best = index
  }
  return best
}

export interface SuspensionOptions {
  /** Minutes of inactivity before a background tab's view is torn down. */
  idleMinutes: number
  /** How often the reaper runs, in ms. */
  sweepIntervalMs: number
}

export const DEFAULT_SUSPENSION: SuspensionOptions = {
  idleMinutes: 20,
  sweepIntervalMs: 60_000
}

/**
 * Owns the relationship between tab *records* (StateStore) and tab *views*
 * (RadiusWindow). A tab always has a record; it only has a view while it is
 * awake. Everything that closes the gap between those two lives here.
 */
export class TabManager {
  private sweepTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly state: StateStore,
    private readonly window: RadiusWindow,
    private suspension: SuspensionOptions = DEFAULT_SUSPENSION
  ) {}

  /* --------------------------------------------------------- lifecycle */

  /**
   * Restores the previous session. Nothing is loaded eagerly: every tab comes
   * back suspended and only the active one is woken, which is what makes a
   * 200-tab restore instant.
   */
  restore(): void {
    const workspaceId = this.state.getActiveWorkspaceId()
    if (!workspaceId) return

    const activeTabId = this.state.getActiveTabId(workspaceId)
    if (activeTabId && this.state.getTab(activeTabId)) {
      this.activate(activeTabId)
      return
    }

    const first = this.tabsInWorkspace(workspaceId)[0]
    if (first) this.activate(first.id)
    else this.create({ workspaceId, url: NEW_TAB_URL })
  }

  startSuspensionSweep(): void {
    this.stopSuspensionSweep()
    this.sweepTimer = setInterval(() => this.sweepIdleTabs(), this.suspension.sweepIntervalMs)
    // Do not keep the process alive purely to reap tabs.
    this.sweepTimer.unref?.()
  }

  stopSuspensionSweep(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    this.sweepTimer = null
  }

  setSuspensionOptions(options: Partial<SuspensionOptions>): void {
    this.suspension = { ...this.suspension, ...options }
    if (this.sweepTimer) this.startSuspensionSweep()
  }

  /* -------------------------------------------------------------- reads */

  private tabsInWorkspace(workspaceId: string): Tab[] {
    return this.state
      .listTabs()
      .filter((tab) => tab.workspaceId === workspaceId)
      .sort((a, b) => a.order - b.order)
  }

  /* ------------------------------------------------------------ actions */

  create(input: {
    workspaceId?: string
    url?: string
    groupId?: string | null
    index?: number
    background?: boolean
  }): Tab {
    const workspaceId = input.workspaceId ?? this.state.getActiveWorkspaceId()
    if (!workspaceId) throw new Error('Cannot create a tab with no workspace')

    const tab = this.state.createTab({
      workspaceId,
      url: input.url ?? NEW_TAB_URL,
      groupId: input.groupId ?? null,
      ...(input.index === undefined ? {} : { index: input.index })
    })

    if (!input.background) this.activate(tab.id)
    return tab
  }

  activate(tabId: string): void {
    const tab = this.state.getTab(tabId)
    if (!tab) return

    this.wake(tab)
    this.window.setActiveTab(tabId)
    this.state.setActiveTabId(tab.workspaceId, tabId)
  }

  /** Materialises a view for a suspended tab and restores its URL. */
  private wake(tab: Tab): void {
    if (this.window.hasView(tab.id)) {
      this.state.setRuntime(tab.id, { suspended: false })
      return
    }
    this.window.createView(tab.id, tab.url)
    this.state.setRuntime(tab.id, { suspended: false, loading: tab.url !== NEW_TAB_URL })
  }

  close(tabId: string): void {
    const tab = this.state.getTab(tabId)
    if (!tab) return
    const wasActive = this.state.getActiveTabId(tab.workspaceId) === tabId

    this.window.destroyView(tabId)
    this.state.closeTab(tabId)

    if (!wasActive) return
    const successor = this.state.getActiveTabId(tab.workspaceId)
    if (successor) {
      this.activate(successor)
    } else {
      // Never leave a workspace with zero tabs -- an empty window is a dead end.
      this.create({ workspaceId: tab.workspaceId, url: NEW_TAB_URL })
    }
  }

  reopenClosed(): Tab | null {
    const entry = this.state.popClosedTab()
    if (!entry) return null
    return this.create({
      workspaceId: entry.workspaceId,
      url: entry.url,
      groupId: entry.groupId,
      index: entry.order
    })
  }

  navigate(tabId: string, rawUrl: string): void {
    const tab = this.state.getTab(tabId)
    if (!tab) return

    const engineId = this.state.getSetting<string | undefined>('searchEngineId', undefined)
    const intent = parseOmniboxInput(rawUrl, resolveSearchEngine(engineId))
    if (!intent.url) return

    this.wake(tab)
    const view = this.window.getView(tabId)
    if (!view) return
    this.state.setRuntime(tabId, { loading: true })
    void view.webContents.loadURL(intent.url).catch(() => {
      this.state.setRuntime(tabId, { loading: false })
    })
  }

  goBack(tabId: string): void {
    const history = this.window.getView(tabId)?.webContents.navigationHistory
    if (history?.canGoBack()) history.goBack()
  }

  goForward(tabId: string): void {
    const history = this.window.getView(tabId)?.webContents.navigationHistory
    if (history?.canGoForward()) history.goForward()
  }

  reload(tabId: string, hard = false): void {
    const tab = this.state.getTab(tabId)
    if (!tab) return
    if (!this.window.hasView(tabId)) {
      this.wake(tab)
      return
    }
    const contents = this.window.getView(tabId)?.webContents
    if (hard) contents?.reloadIgnoringCache()
    else contents?.reload()
  }

  stop(tabId: string): void {
    this.window.getView(tabId)?.webContents.stop()
  }

  move(input: {
    tabId: string
    toIndex: number
    groupId?: string | null
    workspaceId?: string
  }): void {
    this.state.moveTab(input)
    // Dragging a tab into another workspace should not leave it on screen.
    if (input.workspaceId && input.workspaceId !== this.state.getActiveWorkspaceId()) {
      this.suspend(input.tabId)
    }
  }

  setPinned(tabId: string, pinned: boolean): void {
    this.state.setPinned(tabId, pinned)
  }

  /** Tears down the view but keeps the record, freeing the renderer process. */
  suspend(tabId: string): void {
    if (this.window.getActiveTabId() === tabId) return
    if (!this.window.hasView(tabId)) return
    this.window.destroyView(tabId)
    this.state.setRuntime(tabId, {
      suspended: true,
      loading: false,
      canGoBack: false,
      canGoForward: false
    })
  }

  private sweepIdleTabs(): void {
    const cutoff = Date.now() - this.suspension.idleMinutes * 60_000
    const activeTabId = this.window.getActiveTabId()
    for (const tabId of this.window.listViewTabIds()) {
      if (tabId === activeTabId) continue
      const tab = this.state.getTab(tabId)
      if (!tab || tab.pinned) continue
      if (tab.lastActiveAt <= cutoff) this.suspend(tabId)
    }
  }

  /* --------------------------------------------------------- workspaces */

  activateWorkspace(workspaceId: string): void {
    this.state.setActiveWorkspaceId(workspaceId)
    const activeTabId = this.state.getActiveTabId(workspaceId)
    const target = activeTabId ?? this.tabsInWorkspace(workspaceId)[0]?.id

    if (target) {
      this.activate(target)
    } else {
      this.create({ workspaceId, url: NEW_TAB_URL })
    }

    // Views belonging to other workspaces stay alive but hidden; the sweep
    // reclaims them on the normal idle schedule.
    this.window.setActiveTab(this.window.getActiveTabId())
  }

  deleteWorkspace(workspaceId: string): void {
    const removed = this.state.deleteWorkspace(workspaceId)
    for (const tabId of removed) this.window.destroyView(tabId)

    const next = this.state.getActiveWorkspaceId()
    if (next) this.activateWorkspace(next)
  }

  createGroup(input: {
    workspaceId: string
    title: string
    color: TabGroupColor
    tabIds: string[]
  }): ReturnType<StateStore['createGroup']> {
    return this.state.createGroup(input)
  }

  deleteGroup(groupId: string, closeTabs: boolean): void {
    const doomed = this.state.deleteGroup(groupId, closeTabs)
    for (const tabId of doomed) this.close(tabId)
  }

  /* ------------------------------------------------- webContents events */

  handleTitle(tabId: string, title: string): void {
    this.state.updateTab(tabId, { title })
    // Titles land after the navigation, so annotate rather than re-count.
    const tab = this.state.getTab(tabId)
    if (tab) this.state.annotateHistory(tab.url, { title })
  }

  handleFavicon(tabId: string, faviconUrl: string | null): void {
    this.state.updateTab(tabId, { faviconUrl })
    const tab = this.state.getTab(tabId)
    if (tab) this.state.annotateHistory(tab.url, { faviconUrl })
  }

  handleLoading(tabId: string, loading: boolean): void {
    this.state.setRuntime(tabId, { loading })
  }

  handleNavigate(tabId: string, url: string, canGoBack: boolean, canGoForward: boolean): void {
    const previous = this.state.getTab(tabId)
    this.state.updateTab(tabId, { url })
    this.state.setRuntime(tabId, { canGoBack, canGoForward })

    // Only a genuine change of address is a visit; an in-page anchor is not.
    if (previous?.url !== url) {
      this.state.recordVisit({ url, title: previous?.title ?? '', faviconUrl: null })
    }
  }

  /* --------------------------------------------------- find and zoom */

  /**
   * Runs an incremental find.
   *
   * `findNext: true` starts a new find session and `false` steps within the
   * current one -- the reverse of what the name suggests. Getting this backwards
   * silently reports nothing, because Chromium has no session to continue.
   */
  find(input: {
    tabId: string
    query: string
    forward: boolean
    findNext: boolean
    matchCase: boolean
  }): void {
    const contents = this.window.getView(input.tabId)?.webContents
    if (!contents) return
    if (!input.query) {
      contents.stopFindInPage('clearSelection')
      return
    }
    contents.findInPage(input.query, {
      forward: input.forward,
      findNext: input.findNext,
      matchCase: input.matchCase
    })
  }

  stopFind(tabId: string, keepSelection: boolean): void {
    this.window
      .getView(tabId)
      ?.webContents.stopFindInPage(keepSelection ? 'keepSelection' : 'clearSelection')
  }

  setZoom(tabId: string, factor: number): number {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor))
    const contents = this.window.getView(tabId)?.webContents
    if (contents) contents.setZoomFactor(clamped)
    this.state.setRuntime(tabId, { zoom: clamped })
    return clamped
  }

  stepZoom(tabId: string, direction: 'in' | 'out' | 'reset'): number {
    if (direction === 'reset') return this.setZoom(tabId, 1)
    const current = this.state.getRuntime(tabId).zoom
    // Step through a fixed ladder so repeated presses land on round values
    // rather than drifting by a multiplier.
    const index = ZOOM_STEPS.findIndex((step) => Math.abs(step - current) < 0.001)
    const base = index === -1 ? nearestStep(current) : index
    const next = direction === 'in' ? Math.min(base + 1, ZOOM_STEPS.length - 1) : Math.max(base - 1, 0)
    return this.setZoom(tabId, ZOOM_STEPS[next]!)
  }

  handleOpenUrl(url: string, background: boolean): void {
    const workspaceId = this.state.getActiveWorkspaceId()
    if (!workspaceId) return
    this.create({ workspaceId, url, background })
  }
}

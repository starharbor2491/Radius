import { randomUUID } from 'node:crypto'
import type { JsonStore } from '../store/JsonStore'
import type {
  AppState,
  Bookmark,
  BookmarkFolder,
  DownloadItem,
  DownloadState,
  HistoryEntry,
  Tab,
  TabGroup,
  TabGroupColor,
  UsageRecord,
  Workspace
} from '@shared/types'

/**
 * Runtime facts about a tab that are true only while a WebContentsView exists.
 * These are intentionally not persisted -- after a restart every tab is
 * suspended until the user focuses it.
 */
export interface TabRuntime {
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  suspended: boolean
  zoom: number
}

const DEFAULT_RUNTIME: TabRuntime = {
  loading: false,
  canGoBack: false,
  canGoForward: false,
  suspended: true,
  zoom: 1
}

const SETTING_ACTIVE_WORKSPACE = 'activeWorkspaceId'
const SETTING_ACTIVE_TABS = 'activeTabIdByWorkspace'

const CLOSED_TAB_LIMIT = 50
const HISTORY_LIMIT = 10_000
/** How much history the renderer gets in a snapshot; the panel searches the rest. */
const HISTORY_SNAPSHOT_LIMIT = 200
const DOWNLOAD_LIMIT = 200

const DEFAULT_ACCENTS = [
  'oklch(0.70 0.17 285)',
  'oklch(0.74 0.15 175)',
  'oklch(0.76 0.16 60)',
  'oklch(0.68 0.18 350)',
  'oklch(0.72 0.16 145)'
]

type Listener = (state: AppState) => void

/** Rows are stored as plain objects; these narrow the store's `unknown[]`. */
interface TabRow extends Omit<Tab, 'suspended' | 'loading' | 'canGoBack' | 'canGoForward'> {
  scrollY: number
}

interface ClosedTabRow {
  id: string
  workspaceId: string
  url: string
  title: string
  faviconUrl: string | null
  groupId: string | null
  order: number
  closedAt: number
}

/**
 * The authoritative store for everything the chrome renders.
 *
 * Main owns the state and the renderer mirrors it: every mutation lands here,
 * gets persisted, and then a fresh snapshot is pushed over `state:changed`.
 * Full snapshots rather than patches is a deliberate tradeoff -- the payload is
 * a few KB and it removes a whole class of desync bugs.
 */
export class StateStore {
  private readonly runtime = new Map<string, TabRuntime>()
  private readonly listeners = new Set<Listener>()
  private notifyQueued = false

  constructor(private readonly store: JsonStore) {}

  /* ------------------------------------------------------- collections */

  private get workspaces(): Workspace[] {
    return this.store.data.workspaces as Workspace[]
  }
  private get groups(): TabGroup[] {
    return this.store.data.groups as TabGroup[]
  }
  private get tabRows(): TabRow[] {
    return this.store.data.tabs as TabRow[]
  }
  private get closedTabs(): ClosedTabRow[] {
    return this.store.data.closedTabs as ClosedTabRow[]
  }
  private get bookmarkRows(): Bookmark[] {
    return this.store.data.bookmarks as Bookmark[]
  }
  private get folderRows(): BookmarkFolder[] {
    return this.store.data.bookmarkFolders as BookmarkFolder[]
  }
  private get historyRows(): HistoryEntry[] {
    return this.store.data.history as HistoryEntry[]
  }
  private get downloadRows(): DownloadItem[] {
    return this.store.data.downloads as DownloadItem[]
  }
  private get usageRows(): UsageRecord[] {
    return this.store.data.usage as UsageRecord[]
  }

  /** Marks the document dirty and schedules both a disk write and a UI push. */
  private commit(): void {
    this.store.touch()
    this.notify()
  }

  /* ---------------------------------------------------------- lifecycle */

  /** Creates the first workspace on a cold install so the UI is never empty. */
  ensureSeeded(): void {
    if (this.workspaces.length > 0) return
    this.createWorkspace({ name: 'Personal', icon: '◎' })
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Coalesces bursts of mutations into a single snapshot on the next
   * microtask. A tab load fires title/favicon/nav-state updates back to back;
   * without this the renderer would re-render three times for one event.
   */
  notify(): void {
    if (this.notifyQueued) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      const snapshot = this.snapshot()
      for (const listener of this.listeners) listener(snapshot)
    })
  }

  /* ------------------------------------------------------------ runtime */

  getRuntime(tabId: string): TabRuntime {
    return this.runtime.get(tabId) ?? DEFAULT_RUNTIME
  }

  setRuntime(tabId: string, patch: Partial<TabRuntime>): void {
    this.runtime.set(tabId, { ...this.getRuntime(tabId), ...patch })
    this.notify()
  }

  clearRuntime(tabId: string): void {
    this.runtime.delete(tabId)
  }

  /* ---------------------------------------------------------- snapshot */

  snapshot(): AppState {
    return {
      workspaces: this.listWorkspaces(),
      activeWorkspaceId: this.getActiveWorkspaceId(),
      groups: this.listGroups(),
      tabs: this.listTabs(),
      activeTabIdByWorkspace: this.getActiveTabMap(),
      bookmarks: this.listBookmarks(),
      bookmarkFolders: this.listBookmarkFolders(),
      history: this.listHistory().slice(0, HISTORY_SNAPSHOT_LIMIT),
      downloads: this.listDownloads(),
      // Providers are layered in by the registry, which owns key presence.
      providers: [],
      settings: this.getAllSettings()
    }
  }

  /* --------------------------------------------------------- workspaces */

  listWorkspaces(): Workspace[] {
    return [...this.workspaces].sort((a, b) => a.order - b.order)
  }

  createWorkspace(input: { name: string; icon: string; accent?: string }): Workspace {
    const workspace: Workspace = {
      id: randomUUID(),
      name: input.name,
      icon: input.icon,
      accent: input.accent ?? DEFAULT_ACCENTS[this.workspaces.length % DEFAULT_ACCENTS.length]!,
      order: this.workspaces.length,
      themeId: null,
      createdAt: Date.now()
    }
    this.workspaces.push(workspace)
    if (!this.getActiveWorkspaceId()) this.setSetting(SETTING_ACTIVE_WORKSPACE, workspace.id)
    this.commit()
    return workspace
  }

  updateWorkspace(
    workspaceId: string,
    patch: Partial<Pick<Workspace, 'name' | 'icon' | 'accent' | 'themeId'>>
  ): void {
    const workspace = this.workspaces.find((candidate) => candidate.id === workspaceId)
    if (!workspace) return
    Object.assign(workspace, stripUndefined(patch))
    this.commit()
  }

  deleteWorkspace(workspaceId: string): string[] {
    const removed = this.tabRows.filter((tab) => tab.workspaceId === workspaceId).map((tab) => tab.id)

    replaceInPlace(this.workspaces, this.workspaces.filter((w) => w.id !== workspaceId))
    replaceInPlace(this.groups, this.groups.filter((g) => g.workspaceId !== workspaceId))
    replaceInPlace(this.tabRows, this.tabRows.filter((t) => t.workspaceId !== workspaceId))
    for (const tabId of removed) this.runtime.delete(tabId)

    if (this.getSetting<string | null>(SETTING_ACTIVE_WORKSPACE, null) === workspaceId) {
      this.setSetting(SETTING_ACTIVE_WORKSPACE, this.listWorkspaces()[0]?.id ?? null)
    }
    const activeTabs = this.getActiveTabMap()
    delete activeTabs[workspaceId]
    this.setSetting(SETTING_ACTIVE_TABS, activeTabs)

    this.commit()
    return removed
  }

  reorderWorkspaces(orderedIds: string[]): void {
    orderedIds.forEach((id, index) => {
      const workspace = this.workspaces.find((candidate) => candidate.id === id)
      if (workspace) workspace.order = index
    })
    this.commit()
  }

  getActiveWorkspaceId(): string | null {
    const stored = this.getSetting<string | null>(SETTING_ACTIVE_WORKSPACE, null)
    if (stored && this.workspaces.some((workspace) => workspace.id === stored)) return stored
    return this.listWorkspaces()[0]?.id ?? null
  }

  setActiveWorkspaceId(workspaceId: string | null): void {
    this.setSetting(SETTING_ACTIVE_WORKSPACE, workspaceId)
    this.commit()
  }

  /* -------------------------------------------------------------- groups */

  listGroups(): TabGroup[] {
    return [...this.groups].sort((a, b) => a.order - b.order)
  }

  createGroup(input: {
    workspaceId: string
    title: string
    color: TabGroupColor
    tabIds: string[]
  }): TabGroup {
    const siblings = this.groups.filter((group) => group.workspaceId === input.workspaceId)
    const group: TabGroup = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      title: input.title,
      color: input.color,
      collapsed: false,
      order: siblings.length
    }
    this.groups.push(group)
    for (const tabId of input.tabIds) {
      const tab = this.tabRows.find((candidate) => candidate.id === tabId)
      if (tab) tab.groupId = group.id
    }
    this.commit()
    return group
  }

  updateGroup(groupId: string, patch: Partial<Pick<TabGroup, 'title' | 'color' | 'collapsed'>>): void {
    const group = this.groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    Object.assign(group, stripUndefined(patch))
    this.commit()
  }

  /** Returns the ids of tabs the caller should close, if any. */
  deleteGroup(groupId: string, closeTabs: boolean): string[] {
    const members = this.tabRows.filter((tab) => tab.groupId === groupId).map((tab) => tab.id)
    replaceInPlace(this.groups, this.groups.filter((group) => group.id !== groupId))
    // Ungroup rather than orphan when the tabs are being kept.
    for (const tab of this.tabRows) if (tab.groupId === groupId) tab.groupId = null
    this.commit()
    return closeTabs ? members : []
  }

  /* ---------------------------------------------------------------- tabs */

  listTabs(): Tab[] {
    return [...this.tabRows]
      .sort((a, b) => a.order - b.order)
      .map((row) => {
        const runtime = this.getRuntime(row.id)
        return {
          id: row.id,
          workspaceId: row.workspaceId,
          groupId: row.groupId,
          url: row.url,
          title: row.title,
          faviconUrl: row.faviconUrl,
          pinned: row.pinned,
          suspended: runtime.suspended,
          loading: runtime.loading,
          canGoBack: runtime.canGoBack,
          canGoForward: runtime.canGoForward,
          order: row.order,
          lastActiveAt: row.lastActiveAt,
          inAiContext: row.inAiContext
        }
      })
  }

  getTab(tabId: string): Tab | undefined {
    return this.listTabs().find((tab) => tab.id === tabId)
  }

  createTab(input: {
    workspaceId: string
    url: string
    groupId?: string | null
    index?: number
  }): Tab {
    const siblings = this.tabRows.filter((tab) => tab.workspaceId === input.workspaceId)
    const order = input.index ?? siblings.length
    for (const sibling of siblings) {
      if (sibling.order >= order) sibling.order += 1
    }

    const row: TabRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      groupId: input.groupId ?? null,
      url: input.url,
      title: input.url ? '' : 'New tab',
      faviconUrl: null,
      pinned: false,
      order,
      lastActiveAt: Date.now(),
      inAiContext: false,
      scrollY: 0
    }
    this.tabRows.push(row)
    this.runtime.set(row.id, { ...DEFAULT_RUNTIME })
    this.commit()
    return this.getTab(row.id)!
  }

  closeTab(tabId: string): void {
    const tab = this.getTab(tabId)
    if (!tab) return

    this.closedTabs.unshift({
      id: randomUUID(),
      workspaceId: tab.workspaceId,
      url: tab.url,
      title: tab.title,
      faviconUrl: tab.faviconUrl,
      groupId: tab.groupId,
      order: tab.order,
      closedAt: Date.now()
    })
    if (this.closedTabs.length > CLOSED_TAB_LIMIT) this.closedTabs.length = CLOSED_TAB_LIMIT

    replaceInPlace(this.tabRows, this.tabRows.filter((row) => row.id !== tabId))
    this.runtime.delete(tabId)
    this.reindexWorkspace(tab.workspaceId)

    const activeTabs = this.getActiveTabMap()
    if (activeTabs[tab.workspaceId] === tabId) {
      const remaining = this.tabRows
        .filter((row) => row.workspaceId === tab.workspaceId)
        .sort((a, b) => a.order - b.order)
      // Focus whichever tab took this one's slot, else the last one.
      const successor = remaining[Math.min(tab.order, remaining.length - 1)]
      activeTabs[tab.workspaceId] = successor?.id ?? null
      this.setSetting(SETTING_ACTIVE_TABS, activeTabs)
    }
    this.commit()
  }

  popClosedTab(): { workspaceId: string; url: string; groupId: string | null; order: number } | null {
    const entry = this.closedTabs.shift()
    if (!entry) return null
    this.commit()
    return {
      workspaceId: entry.workspaceId,
      url: entry.url,
      groupId: entry.groupId,
      order: entry.order
    }
  }

  updateTab(
    tabId: string,
    patch: Partial<Pick<Tab, 'url' | 'title' | 'faviconUrl' | 'pinned' | 'inAiContext'>> & {
      scrollY?: number
    }
  ): void {
    const row = this.tabRows.find((candidate) => candidate.id === tabId)
    if (!row) return
    Object.assign(row, stripUndefined(patch))
    this.commit()
  }

  touchTab(tabId: string): void {
    const row = this.tabRows.find((candidate) => candidate.id === tabId)
    if (!row) return
    row.lastActiveAt = Date.now()
    this.store.touch()
  }

  /**
   * Moves a tab to an index within its workspace, optionally changing group or
   * workspace.
   *
   * `toIndex` is the slot the tab should occupy *after* being removed from its
   * current position, so a forward move has to sort past the tab currently
   * there and a backward move has to sort in front of it. `reindexWorkspace`
   * then collapses the fractional key back to whole numbers.
   */
  moveTab(input: {
    tabId: string
    toIndex: number
    groupId?: string | null
    workspaceId?: string
  }): void {
    const row = this.tabRows.find((candidate) => candidate.id === input.tabId)
    if (!row) return

    const previousWorkspace = row.workspaceId
    const targetWorkspace = input.workspaceId ?? previousWorkspace

    const siblings = this.tabRows
      .filter((candidate) => candidate.workspaceId === targetWorkspace)
      .sort((a, b) => a.order - b.order)
    const currentIndex = siblings.findIndex((candidate) => candidate.id === input.tabId)
    const movingForward = currentIndex !== -1 && input.toIndex >= currentIndex

    row.order = movingForward ? input.toIndex + 0.5 : input.toIndex - 0.5
    if (input.groupId !== undefined) row.groupId = input.groupId
    if (input.workspaceId !== undefined) row.workspaceId = input.workspaceId

    this.reindexWorkspace(targetWorkspace)
    if (targetWorkspace !== previousWorkspace) this.reindexWorkspace(previousWorkspace)
    this.commit()
  }

  /** Renumbers a workspace to 0..n-1 with pinned tabs first. */
  private reindexWorkspace(workspaceId: string): void {
    this.tabRows
      .filter((row) => row.workspaceId === workspaceId)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return a.order - b.order
      })
      .forEach((row, index) => {
        row.order = index
      })
  }

  setPinned(tabId: string, pinned: boolean): void {
    const row = this.tabRows.find((candidate) => candidate.id === tabId)
    if (!row) return
    row.pinned = pinned
    this.reindexWorkspace(row.workspaceId)
    this.commit()
  }

  getActiveTabMap(): Record<string, string | null> {
    return this.getSetting<Record<string, string | null>>(SETTING_ACTIVE_TABS, {})
  }

  getActiveTabId(workspaceId: string): string | null {
    return this.getActiveTabMap()[workspaceId] ?? null
  }

  setActiveTabId(workspaceId: string, tabId: string | null): void {
    const map = this.getActiveTabMap()
    map[workspaceId] = tabId
    this.setSetting(SETTING_ACTIVE_TABS, map)
    if (tabId) this.touchTab(tabId)
    this.commit()
  }

  /* ---------------------------------------------------------- bookmarks */

  listBookmarks(): Bookmark[] {
    return [...this.bookmarkRows].sort((a, b) => a.order - b.order)
  }

  listBookmarkFolders(): BookmarkFolder[] {
    return [...this.folderRows].sort((a, b) => a.order - b.order)
  }

  createBookmark(input: {
    url: string
    title: string
    faviconUrl: string | null
    folderId: string | null
    tags: string[]
    note: string
  }): Bookmark {
    const bookmark: Bookmark = {
      id: randomUUID(),
      folderId: input.folderId,
      url: input.url,
      title: input.title,
      faviconUrl: input.faviconUrl,
      tags: input.tags,
      note: input.note,
      order: this.bookmarkRows.length,
      createdAt: Date.now()
    }
    this.bookmarkRows.push(bookmark)
    this.commit()
    return bookmark
  }

  updateBookmark(
    bookmarkId: string,
    patch: Partial<Pick<Bookmark, 'title' | 'note' | 'tags' | 'folderId'>>
  ): void {
    const bookmark = this.bookmarkRows.find((candidate) => candidate.id === bookmarkId)
    if (!bookmark) return
    Object.assign(bookmark, stripUndefined(patch))
    this.commit()
  }

  deleteBookmark(bookmarkId: string): void {
    replaceInPlace(this.bookmarkRows, this.bookmarkRows.filter((b) => b.id !== bookmarkId))
    this.commit()
  }

  createBookmarkFolder(name: string, parentId: string | null): BookmarkFolder {
    const folder: BookmarkFolder = {
      id: randomUUID(),
      parentId,
      name,
      order: this.folderRows.length
    }
    this.folderRows.push(folder)
    this.commit()
    return folder
  }

  deleteBookmarkFolder(folderId: string): void {
    replaceInPlace(this.folderRows, this.folderRows.filter((f) => f.id !== folderId))
    // Children of a deleted folder move to the root rather than vanishing.
    for (const folder of this.folderRows) if (folder.parentId === folderId) folder.parentId = null
    for (const bookmark of this.bookmarkRows) {
      if (bookmark.folderId === folderId) bookmark.folderId = null
    }
    this.commit()
  }

  /* ------------------------------------------------------------ history */

  listHistory(): HistoryEntry[] {
    // Reverse before sorting so that entries recorded in the same millisecond
    // (fast redirects, restored sessions) still come out newest-first: the sort
    // is stable, so equal timestamps keep this reversed insertion order.
    return [...this.historyRows].reverse().sort((a, b) => b.visitedAt - a.visitedAt)
  }

  /**
   * Records a visit.
   *
   * Revisiting an URL bumps the existing entry rather than appending, so the
   * history panel shows places rather than a raw event log -- and so the list
   * stays small enough to hold in memory.
   */
  recordVisit(input: { url: string; title: string; faviconUrl: string | null }): void {
    if (!/^https?:\/\//i.test(input.url)) return

    const existing = this.historyRows.find((entry) => entry.url === input.url)
    if (existing) {
      existing.visitedAt = Date.now()
      existing.visitCount += 1
      if (input.title) existing.title = input.title
      if (input.faviconUrl) existing.faviconUrl = input.faviconUrl
    } else {
      this.historyRows.push({
        id: randomUUID(),
        url: input.url,
        title: input.title,
        faviconUrl: input.faviconUrl,
        visitedAt: Date.now(),
        visitCount: 1
      })
      if (this.historyRows.length > HISTORY_LIMIT) {
        replaceInPlace(this.historyRows, this.listHistory().slice(0, HISTORY_LIMIT))
      }
    }
    this.commit()
  }

  /**
   * Fills in a title or favicon that arrived after the navigation did, without
   * counting it as another visit. Page titles almost always land late, so
   * treating them as visits would inflate every count.
   */
  annotateHistory(url: string, patch: { title?: string; faviconUrl?: string | null }): void {
    const entry = this.historyRows.find((candidate) => candidate.url === url)
    if (!entry) return
    if (patch.title) entry.title = patch.title
    if (patch.faviconUrl) entry.faviconUrl = patch.faviconUrl
    this.store.touch()
  }

  searchHistory(query: string, limit = 100): HistoryEntry[] {
    const needle = query.trim().toLowerCase()
    const all = this.listHistory()
    if (!needle) return all.slice(0, limit)
    return all
      .filter(
        (entry) =>
          entry.title.toLowerCase().includes(needle) || entry.url.toLowerCase().includes(needle)
      )
      .slice(0, limit)
  }

  deleteHistoryEntry(entryId: string): void {
    replaceInPlace(this.historyRows, this.historyRows.filter((entry) => entry.id !== entryId))
    this.commit()
  }

  clearHistory(sinceMs: number | null): void {
    if (sinceMs === null) replaceInPlace(this.historyRows, [])
    else replaceInPlace(this.historyRows, this.historyRows.filter((e) => e.visitedAt < sinceMs))
    this.commit()
  }

  /* ---------------------------------------------------------- downloads */

  listDownloads(): DownloadItem[] {
    return [...this.downloadRows].sort((a, b) => b.startedAt - a.startedAt)
  }

  upsertDownload(item: DownloadItem): void {
    const existing = this.downloadRows.findIndex((candidate) => candidate.id === item.id)
    if (existing === -1) this.downloadRows.unshift(item)
    else this.downloadRows[existing] = item

    if (this.downloadRows.length > DOWNLOAD_LIMIT) this.downloadRows.length = DOWNLOAD_LIMIT
    this.commit()
  }

  updateDownload(
    id: string,
    patch: Partial<Pick<DownloadItem, 'state' | 'receivedBytes' | 'totalBytes' | 'completedAt'>>
  ): void {
    const item = this.downloadRows.find((candidate) => candidate.id === id)
    if (!item) return
    Object.assign(item, stripUndefined(patch))
    this.commit()
  }

  removeDownload(id: string): void {
    replaceInPlace(this.downloadRows, this.downloadRows.filter((item) => item.id !== id))
    this.commit()
  }

  clearFinishedDownloads(): void {
    const finished: DownloadState[] = ['completed', 'cancelled', 'interrupted']
    replaceInPlace(this.downloadRows, this.downloadRows.filter((i) => !finished.includes(i.state)))
    this.commit()
  }

  /* ----------------------------------------------------------- settings */

  getAllSettings(): Record<string, unknown> {
    return { ...this.store.data.settings }
  }

  getSetting<T>(key: string, fallback: T): T {
    const value = this.store.data.settings[key]
    return value === undefined ? fallback : (value as T)
  }

  setSetting(key: string, value: unknown): void {
    this.store.data.settings[key] = value
    this.store.touch()
  }

  /* -------------------------------------------------------------- usage */

  recordUsage(record: Omit<UsageRecord, 'id' | 'createdAt'>): void {
    this.usageRows.push({ ...record, id: randomUUID(), createdAt: Date.now() })
    this.store.touch()
  }

  listUsage(sinceMs?: number): UsageRecord[] {
    return this.usageRows
      .filter((record) => (sinceMs === undefined ? true : record.createdAt >= sinceMs))
      .sort((a, b) => b.createdAt - a.createdAt)
  }
}

/** Replaces an array's contents without breaking the store's reference to it. */
function replaceInPlace<T>(target: T[], next: T[]): void {
  target.length = 0
  target.push(...next)
}

/**
 * Drops `undefined` values so an optional patch field never overwrites a real
 * one with nothing.
 */
function stripUndefined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}

import { randomUUID } from 'node:crypto'
import { asc, desc, eq, gte } from 'drizzle-orm'
import type { Db } from '../db'
import { schema } from '../db'
import type {
  AppState,
  Bookmark,
  BookmarkFolder,
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
}

const DEFAULT_RUNTIME: TabRuntime = {
  loading: false,
  canGoBack: false,
  canGoForward: false,
  suspended: true
}

const SETTING_ACTIVE_WORKSPACE = 'activeWorkspaceId'
const SETTING_ACTIVE_TABS = 'activeTabIdByWorkspace'
const CLOSED_TAB_LIMIT = 50

const DEFAULT_ACCENTS = [
  'oklch(0.70 0.17 285)',
  'oklch(0.74 0.15 175)',
  'oklch(0.76 0.16 60)',
  'oklch(0.68 0.18 350)',
  'oklch(0.72 0.16 145)'
]

type Listener = (state: AppState) => void

/**
 * The authoritative store for everything the chrome renders.
 *
 * Main owns the state and the renderer mirrors it: every mutation lands here,
 * gets persisted, and then a fresh snapshot is pushed over `state:changed`.
 * Full snapshots rather than patches is a deliberate M1 tradeoff -- the payload
 * is a few KB and it removes a whole class of desync bugs. Patching is a later
 * optimisation, behind the same interface.
 */
export class StateStore {
  private readonly runtime = new Map<string, TabRuntime>()
  private readonly listeners = new Set<Listener>()
  private notifyQueued = false

  constructor(private readonly db: Db) {}

  /* ---------------------------------------------------------- lifecycle */

  /** Creates the first workspace on a cold install so the UI is never empty. */
  ensureSeeded(): void {
    const existing = this.db.select().from(schema.workspaces).all()
    if (existing.length > 0) return
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
    const next = { ...this.getRuntime(tabId), ...patch }
    this.runtime.set(tabId, next)
    this.notify()
  }

  clearRuntime(tabId: string): void {
    this.runtime.delete(tabId)
  }

  /* ---------------------------------------------------------- snapshot */

  snapshot(): AppState {
    const workspaces = this.listWorkspaces()
    const groups = this.listGroups()
    const tabs = this.listTabs()
    const bookmarks = this.listBookmarks()
    const bookmarkFolders = this.listBookmarkFolders()

    return {
      workspaces,
      activeWorkspaceId: this.getActiveWorkspaceId(),
      groups,
      tabs,
      activeTabIdByWorkspace: this.getActiveTabMap(),
      bookmarks,
      bookmarkFolders,
      // Providers are layered in by the registry, which owns key presence.
      providers: [],
      settings: this.getAllSettings()
    }
  }

  /* --------------------------------------------------------- workspaces */

  listWorkspaces(): Workspace[] {
    return this.db
      .select()
      .from(schema.workspaces)
      .orderBy(asc(schema.workspaces.order))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        icon: row.icon,
        accent: row.accent,
        order: row.order,
        themeId: row.themeId,
        createdAt: row.createdAt
      }))
  }

  createWorkspace(input: { name: string; icon: string; accent?: string }): Workspace {
    const count = this.db.select().from(schema.workspaces).all().length
    const workspace: Workspace = {
      id: randomUUID(),
      name: input.name,
      icon: input.icon,
      accent: input.accent ?? DEFAULT_ACCENTS[count % DEFAULT_ACCENTS.length]!,
      order: count,
      themeId: null,
      createdAt: Date.now()
    }
    this.db.insert(schema.workspaces).values(workspace).run()
    if (!this.getActiveWorkspaceId()) this.setActiveWorkspaceId(workspace.id)
    this.notify()
    return workspace
  }

  updateWorkspace(
    workspaceId: string,
    patch: Partial<Pick<Workspace, 'name' | 'icon' | 'accent' | 'themeId'>>
  ): void {
    this.db.update(schema.workspaces).set(patch).where(eq(schema.workspaces.id, workspaceId)).run()
    this.notify()
  }

  deleteWorkspace(workspaceId: string): string[] {
    const removed = this.listTabs().filter((tab) => tab.workspaceId === workspaceId)
    this.db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).run()

    if (this.getActiveWorkspaceId() === workspaceId) {
      const next = this.listWorkspaces()[0]
      this.setActiveWorkspaceId(next?.id ?? null)
    }
    const activeTabs = this.getActiveTabMap()
    delete activeTabs[workspaceId]
    this.setSetting(SETTING_ACTIVE_TABS, activeTabs)
    this.notify()
    return removed.map((tab) => tab.id)
  }

  reorderWorkspaces(orderedIds: string[]): void {
    orderedIds.forEach((id, index) => {
      this.db.update(schema.workspaces).set({ order: index }).where(eq(schema.workspaces.id, id)).run()
    })
    this.notify()
  }

  getActiveWorkspaceId(): string | null {
    const stored = this.getSetting<string | null>(SETTING_ACTIVE_WORKSPACE, null)
    if (stored && this.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, stored)).get()) {
      return stored
    }
    return this.listWorkspaces()[0]?.id ?? null
  }

  setActiveWorkspaceId(workspaceId: string | null): void {
    this.setSetting(SETTING_ACTIVE_WORKSPACE, workspaceId)
    this.notify()
  }

  /* -------------------------------------------------------------- groups */

  listGroups(): TabGroup[] {
    return this.db
      .select()
      .from(schema.tabGroups)
      .orderBy(asc(schema.tabGroups.order))
      .all()
      .map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        title: row.title,
        color: row.color as TabGroupColor,
        collapsed: row.collapsed,
        order: row.order
      }))
  }

  createGroup(input: {
    workspaceId: string
    title: string
    color: TabGroupColor
    tabIds: string[]
  }): TabGroup {
    const siblings = this.listGroups().filter((g) => g.workspaceId === input.workspaceId)
    const group: TabGroup = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      title: input.title,
      color: input.color,
      collapsed: false,
      order: siblings.length
    }
    this.db.insert(schema.tabGroups).values(group).run()
    for (const tabId of input.tabIds) {
      this.db.update(schema.tabs).set({ groupId: group.id }).where(eq(schema.tabs.id, tabId)).run()
    }
    this.notify()
    return group
  }

  updateGroup(
    groupId: string,
    patch: Partial<Pick<TabGroup, 'title' | 'color' | 'collapsed'>>
  ): void {
    this.db.update(schema.tabGroups).set(patch).where(eq(schema.tabGroups.id, groupId)).run()
    this.notify()
  }

  /** Returns the ids of tabs that should be closed by the caller, if any. */
  deleteGroup(groupId: string, closeTabs: boolean): string[] {
    const members = this.listTabs().filter((tab) => tab.groupId === groupId)
    // The FK is ON DELETE SET NULL, so ungrouping happens for free when we keep
    // the tabs; we only need explicit ids when the caller is closing them.
    this.db.delete(schema.tabGroups).where(eq(schema.tabGroups.id, groupId)).run()
    this.notify()
    return closeTabs ? members.map((tab) => tab.id) : []
  }

  /* ---------------------------------------------------------------- tabs */

  listTabs(): Tab[] {
    return this.db
      .select()
      .from(schema.tabs)
      .orderBy(asc(schema.tabs.order))
      .all()
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
    const siblings = this.listTabs().filter((tab) => tab.workspaceId === input.workspaceId)
    const order = input.index ?? siblings.length
    // Make room at the insertion point.
    for (const sibling of siblings) {
      if (sibling.order >= order) {
        this.db
          .update(schema.tabs)
          .set({ order: sibling.order + 1 })
          .where(eq(schema.tabs.id, sibling.id))
          .run()
      }
    }

    const row = {
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
    this.db.insert(schema.tabs).values(row).run()
    this.runtime.set(row.id, { ...DEFAULT_RUNTIME })
    this.notify()
    return this.getTab(row.id)!
  }

  closeTab(tabId: string): void {
    const tab = this.getTab(tabId)
    if (!tab) return

    this.db
      .insert(schema.closedTabs)
      .values({
        id: randomUUID(),
        workspaceId: tab.workspaceId,
        url: tab.url,
        title: tab.title,
        faviconUrl: tab.faviconUrl,
        groupId: tab.groupId,
        order: tab.order,
        closedAt: Date.now()
      })
      .run()
    this.trimClosedTabs()

    this.db.delete(schema.tabs).where(eq(schema.tabs.id, tabId)).run()
    this.runtime.delete(tabId)
    this.reindexWorkspace(tab.workspaceId)

    const activeTabs = this.getActiveTabMap()
    if (activeTabs[tab.workspaceId] === tabId) {
      const remaining = this.listTabs()
        .filter((candidate) => candidate.workspaceId === tab.workspaceId)
        .sort((a, b) => a.order - b.order)
      // Focus the neighbour that took this tab's slot, else the last tab.
      const successor = remaining[Math.min(tab.order, remaining.length - 1)]
      activeTabs[tab.workspaceId] = successor?.id ?? null
      this.setSetting(SETTING_ACTIVE_TABS, activeTabs)
    }
    this.notify()
  }

  private trimClosedTabs(): void {
    const rows = this.db
      .select({ id: schema.closedTabs.id })
      .from(schema.closedTabs)
      .orderBy(desc(schema.closedTabs.closedAt))
      .all()
    for (const row of rows.slice(CLOSED_TAB_LIMIT)) {
      this.db.delete(schema.closedTabs).where(eq(schema.closedTabs.id, row.id)).run()
    }
  }

  popClosedTab(): { workspaceId: string; url: string; groupId: string | null; order: number } | null {
    const row = this.db
      .select()
      .from(schema.closedTabs)
      .orderBy(desc(schema.closedTabs.closedAt))
      .limit(1)
      .get()
    if (!row) return null
    this.db.delete(schema.closedTabs).where(eq(schema.closedTabs.id, row.id)).run()
    return { workspaceId: row.workspaceId, url: row.url, groupId: row.groupId, order: row.order }
  }

  updateTab(
    tabId: string,
    patch: Partial<Pick<Tab, 'url' | 'title' | 'faviconUrl' | 'pinned' | 'inAiContext'>> & {
      scrollY?: number
    }
  ): void {
    this.db.update(schema.tabs).set(patch).where(eq(schema.tabs.id, tabId)).run()
    this.notify()
  }

  touchTab(tabId: string): void {
    this.db
      .update(schema.tabs)
      .set({ lastActiveAt: Date.now() })
      .where(eq(schema.tabs.id, tabId))
      .run()
  }

  /**
   * Moves a tab to an index within its workspace, optionally changing group or
   * workspace. Pinned tabs are kept ahead of unpinned ones by the reindex pass.
   */
  moveTab(input: {
    tabId: string
    toIndex: number
    groupId?: string | null
    workspaceId?: string
  }): void {
    const tab = this.getTab(input.tabId)
    if (!tab) return
    const targetWorkspace = input.workspaceId ?? tab.workspaceId

    // `toIndex` is the slot the tab should occupy *after* it has been removed
    // from its current position. Comparing against the existing orders, that
    // means a forward move has to sort past the tab currently in that slot,
    // while a backward move has to sort in front of it.
    const siblings = this.listTabs()
      .filter((candidate) => candidate.workspaceId === targetWorkspace)
      .sort((a, b) => a.order - b.order)
    const currentIndex = siblings.findIndex((candidate) => candidate.id === input.tabId)
    const movingForward = currentIndex !== -1 && input.toIndex >= currentIndex
    const sortKey = movingForward ? input.toIndex + 0.5 : input.toIndex - 0.5

    const patch: Record<string, unknown> = { order: sortKey }
    if (input.groupId !== undefined) patch.groupId = input.groupId
    if (input.workspaceId !== undefined) patch.workspaceId = input.workspaceId
    this.db.update(schema.tabs).set(patch).where(eq(schema.tabs.id, input.tabId)).run()

    this.reindexWorkspace(targetWorkspace)
    if (targetWorkspace !== tab.workspaceId) this.reindexWorkspace(tab.workspaceId)
    this.notify()
  }

  /**
   * Collapses fractional and duplicate orders back to 0..n-1 with pinned tabs
   * first. `moveTab` relies on this: it writes `index - 0.5` so the moved tab
   * sorts into the gap, then this pass renumbers everything.
   */
  private reindexWorkspace(workspaceId: string): void {
    const members = this.db
      .select()
      .from(schema.tabs)
      .where(eq(schema.tabs.workspaceId, workspaceId))
      .all()
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return a.order - b.order
      })
    members.forEach((row, index) => {
      if (row.order !== index) {
        this.db.update(schema.tabs).set({ order: index }).where(eq(schema.tabs.id, row.id)).run()
      }
    })
  }

  setPinned(tabId: string, pinned: boolean): void {
    const tab = this.getTab(tabId)
    if (!tab) return
    this.db.update(schema.tabs).set({ pinned }).where(eq(schema.tabs.id, tabId)).run()
    this.reindexWorkspace(tab.workspaceId)
    this.notify()
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
    this.notify()
  }

  /* ---------------------------------------------------------- bookmarks */

  listBookmarks(): Bookmark[] {
    return this.db
      .select()
      .from(schema.bookmarks)
      .orderBy(asc(schema.bookmarks.order))
      .all()
      .map((row) => ({
        id: row.id,
        folderId: row.folderId,
        url: row.url,
        title: row.title,
        faviconUrl: row.faviconUrl,
        tags: row.tags ?? [],
        note: row.note,
        order: row.order,
        createdAt: row.createdAt
      }))
  }

  listBookmarkFolders(): BookmarkFolder[] {
    return this.db
      .select()
      .from(schema.bookmarkFolders)
      .orderBy(asc(schema.bookmarkFolders.order))
      .all()
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
      order: this.listBookmarks().length,
      createdAt: Date.now()
    }
    this.db.insert(schema.bookmarks).values(bookmark).run()
    this.notify()
    return bookmark
  }

  updateBookmark(
    bookmarkId: string,
    patch: Partial<Pick<Bookmark, 'title' | 'note' | 'tags' | 'folderId'>>
  ): void {
    this.db.update(schema.bookmarks).set(patch).where(eq(schema.bookmarks.id, bookmarkId)).run()
    this.notify()
  }

  deleteBookmark(bookmarkId: string): void {
    this.db.delete(schema.bookmarks).where(eq(schema.bookmarks.id, bookmarkId)).run()
    this.notify()
  }

  createBookmarkFolder(name: string, parentId: string | null): BookmarkFolder {
    const folder: BookmarkFolder = {
      id: randomUUID(),
      parentId,
      name,
      order: this.listBookmarkFolders().length
    }
    this.db.insert(schema.bookmarkFolders).values(folder).run()
    this.notify()
    return folder
  }

  deleteBookmarkFolder(folderId: string): void {
    this.db.delete(schema.bookmarkFolders).where(eq(schema.bookmarkFolders.id, folderId)).run()
    this.notify()
  }

  /* ----------------------------------------------------------- settings */

  getAllSettings(): Record<string, unknown> {
    const rows = this.db.select().from(schema.settings).all()
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()
    return row === undefined ? fallback : (row.value as T)
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
  }

  /* -------------------------------------------------------------- usage */

  recordUsage(record: Omit<UsageRecord, 'id' | 'createdAt'>): void {
    this.db
      .insert(schema.usageRecords)
      .values({ ...record, id: randomUUID(), createdAt: Date.now() })
      .run()
  }

  listUsage(sinceMs?: number): UsageRecord[] {
    const query = this.db.select().from(schema.usageRecords)
    const rows = sinceMs
      ? query.where(gte(schema.usageRecords.createdAt, sinceMs)).all()
      : query.all()
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  }
}

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonStore } from '@main/store/JsonStore'
import { StateStore } from '@main/state/StateStore'

/**
 * StateStore against a real JsonStore backed by a temp directory. Exercising
 * the actual persistence path rather than a mock is the point -- the round trip
 * through disk is what catches a mutation that never reached the document.
 */
let directory: string

function makeStore(): StateStore {
  directory = mkdtempSync(join(tmpdir(), 'radius-test-'))
  return new StateStore(new JsonStore(join(directory, 'state.json')))
}

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
})

let store: StateStore
let workspaceId: string

beforeEach(() => {
  store = makeStore()
  store.ensureSeeded()
  workspaceId = store.getActiveWorkspaceId()!
})

const tabsHere = (): ReturnType<StateStore['listTabs']> =>
  store.listTabs().filter((tab) => tab.workspaceId === workspaceId).sort((a, b) => a.order - b.order)

describe('seeding', () => {
  it('creates exactly one workspace and makes it active', () => {
    expect(store.listWorkspaces()).toHaveLength(1)
    expect(workspaceId).toBeTruthy()
  })

  it('is idempotent', () => {
    store.ensureSeeded()
    expect(store.listWorkspaces()).toHaveLength(1)
  })
})

describe('tab ordering', () => {
  it('appends new tabs and numbers them contiguously', () => {
    for (const url of ['a', 'b', 'c']) store.createTab({ workspaceId, url })
    expect(tabsHere().map((tab) => tab.url)).toEqual(['a', 'b', 'c'])
    expect(tabsHere().map((tab) => tab.order)).toEqual([0, 1, 2])
  })

  it('inserts at an index and shifts the rest along', () => {
    for (const url of ['a', 'b', 'c']) store.createTab({ workspaceId, url })
    store.createTab({ workspaceId, url: 'x', index: 1 })
    expect(tabsHere().map((tab) => tab.url)).toEqual(['a', 'x', 'b', 'c'])
  })

  it('moves a tab forwards and renumbers without gaps', () => {
    const created = ['a', 'b', 'c', 'd'].map((url) => store.createTab({ workspaceId, url }))
    store.moveTab({ tabId: created[0]!.id, toIndex: 2 })
    expect(tabsHere().map((tab) => tab.url)).toEqual(['b', 'c', 'a', 'd'])
    expect(tabsHere().map((tab) => tab.order)).toEqual([0, 1, 2, 3])
  })

  it('moves a tab backwards', () => {
    const created = ['a', 'b', 'c'].map((url) => store.createTab({ workspaceId, url }))
    store.moveTab({ tabId: created[2]!.id, toIndex: 0 })
    expect(tabsHere().map((tab) => tab.url)).toEqual(['c', 'a', 'b'])
  })

  it('keeps pinned tabs ahead of unpinned ones', () => {
    const created = ['a', 'b', 'c'].map((url) => store.createTab({ workspaceId, url }))
    store.setPinned(created[2]!.id, true)
    expect(tabsHere().map((tab) => tab.url)).toEqual(['c', 'a', 'b'])
    expect(tabsHere()[0]!.pinned).toBe(true)
  })

  it('pulls a pinned tab back to the front even if asked to move it late', () => {
    const created = ['a', 'b', 'c'].map((url) => store.createTab({ workspaceId, url }))
    store.setPinned(created[0]!.id, true)
    store.moveTab({ tabId: created[0]!.id, toIndex: 2 })
    expect(tabsHere()[0]!.url).toBe('a')
  })
})

describe('groups', () => {
  it('assigns members on creation', () => {
    const tabs = ['a', 'b'].map((url) => store.createTab({ workspaceId, url }))
    const group = store.createGroup({
      workspaceId,
      title: 'Work',
      color: 'green',
      tabIds: [tabs[0]!.id]
    })
    expect(store.getTab(tabs[0]!.id)!.groupId).toBe(group.id)
    expect(store.getTab(tabs[1]!.id)!.groupId).toBeNull()
  })

  it('ungroups members when the group is deleted without closing them', () => {
    const tab = store.createTab({ workspaceId, url: 'a' })
    const group = store.createGroup({ workspaceId, title: 'g', color: 'red', tabIds: [tab.id] })
    const doomed = store.deleteGroup(group.id, false)
    expect(doomed).toEqual([])
    expect(store.getTab(tab.id)!.groupId).toBeNull()
  })

  it('reports members for closing when asked to', () => {
    const tab = store.createTab({ workspaceId, url: 'a' })
    const group = store.createGroup({ workspaceId, title: 'g', color: 'red', tabIds: [tab.id] })
    expect(store.deleteGroup(group.id, true)).toEqual([tab.id])
  })

  it('moves a tab into and back out of a group', () => {
    const tab = store.createTab({ workspaceId, url: 'a' })
    const group = store.createGroup({ workspaceId, title: 'g', color: 'blue', tabIds: [] })
    store.moveTab({ tabId: tab.id, toIndex: 0, groupId: group.id })
    expect(store.getTab(tab.id)!.groupId).toBe(group.id)
    store.moveTab({ tabId: tab.id, toIndex: 0, groupId: null })
    expect(store.getTab(tab.id)!.groupId).toBeNull()
  })
})

describe('closing tabs', () => {
  it('focuses the tab that took the closed tab’s slot', () => {
    const created = ['a', 'b', 'c'].map((url) => store.createTab({ workspaceId, url }))
    store.setActiveTabId(workspaceId, created[1]!.id)
    store.closeTab(created[1]!.id)
    expect(store.getActiveTabId(workspaceId)).toBe(created[2]!.id)
  })

  it('falls back to the last tab when the closed one was last', () => {
    const created = ['a', 'b'].map((url) => store.createTab({ workspaceId, url }))
    store.setActiveTabId(workspaceId, created[1]!.id)
    store.closeTab(created[1]!.id)
    expect(store.getActiveTabId(workspaceId)).toBe(created[0]!.id)
  })

  it('leaves the active tab alone when a different tab closes', () => {
    const created = ['a', 'b'].map((url) => store.createTab({ workspaceId, url }))
    store.setActiveTabId(workspaceId, created[0]!.id)
    store.closeTab(created[1]!.id)
    expect(store.getActiveTabId(workspaceId)).toBe(created[0]!.id)
  })

  it('restores a closed tab in reverse order', () => {
    store.createTab({ workspaceId, url: 'a' })
    const second = store.createTab({ workspaceId, url: 'b' })
    store.closeTab(second.id)
    const reopened = store.popClosedTab()
    expect(reopened?.url).toBe('b')
    expect(store.popClosedTab()).toBeNull()
  })
})

describe('runtime state', () => {
  it('reports a tab with no view as suspended', () => {
    const tab = store.createTab({ workspaceId, url: 'a' })
    store.clearRuntime(tab.id)
    expect(store.getTab(tab.id)!.suspended).toBe(true)
  })

  it('does not persist runtime flags', () => {
    const tab = store.createTab({ workspaceId, url: 'a' })
    store.setRuntime(tab.id, { loading: true, suspended: false })
    expect(store.getTab(tab.id)!.loading).toBe(true)
    store.clearRuntime(tab.id)
    expect(store.getTab(tab.id)!.loading).toBe(false)
  })
})

describe('workspaces', () => {
  it('deletes a workspace and reports the tabs that went with it', () => {
    const second = store.createWorkspace({ name: 'Two', icon: '◈' })
    const tab = store.createTab({ workspaceId: second.id, url: 'a' })
    expect(store.deleteWorkspace(second.id)).toEqual([tab.id])
    expect(store.listWorkspaces()).toHaveLength(1)
  })

  it('moves the active pointer when the active workspace is deleted', () => {
    const second = store.createWorkspace({ name: 'Two', icon: '◈' })
    store.setActiveWorkspaceId(second.id)
    store.deleteWorkspace(second.id)
    expect(store.getActiveWorkspaceId()).toBe(workspaceId)
  })

  it('reorders workspaces', () => {
    const second = store.createWorkspace({ name: 'Two', icon: '◈' })
    store.reorderWorkspaces([second.id, workspaceId])
    expect(store.listWorkspaces().map((w) => w.id)).toEqual([second.id, workspaceId])
  })
})

describe('bookmarks and settings', () => {
  it('round-trips a bookmark with tags', () => {
    const bookmark = store.createBookmark({
      url: 'https://example.com',
      title: 'Example',
      faviconUrl: null,
      folderId: null,
      tags: ['read', 'later'],
      note: ''
    })
    expect(store.listBookmarks()[0]!.tags).toEqual(['read', 'later'])
    store.deleteBookmark(bookmark.id)
    expect(store.listBookmarks()).toHaveLength(0)
  })

  it('upserts settings', () => {
    store.setSetting('searchEngineId', 'kagi')
    store.setSetting('searchEngineId', 'google')
    expect(store.getSetting('searchEngineId', 'duckduckgo')).toBe('google')
  })

  it('returns the fallback for an unset key', () => {
    expect(store.getSetting('nope', 42)).toBe(42)
  })
})

describe('usage', () => {
  it('records and filters by time', () => {
    store.recordUsage({
      providerId: 'anthropic',
      modelId: 'm',
      feature: 'chat',
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0.001
    })
    expect(store.listUsage()).toHaveLength(1)
    expect(store.listUsage(Date.now() + 10_000)).toHaveLength(0)
  })
})

describe('snapshot', () => {
  it('coalesces a burst of mutations into one notification', async () => {
    let calls = 0
    store.subscribe(() => {
      calls += 1
    })
    store.createTab({ workspaceId, url: 'a' })
    store.createTab({ workspaceId, url: 'b' })
    store.createTab({ workspaceId, url: 'c' })
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)
  })
})

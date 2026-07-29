import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonStore, emptyDocument } from '@main/store/JsonStore'
import { StateStore } from '@main/state/StateStore'

let directory: string
let file: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'radius-store-'))
  file = join(directory, 'state.json')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('JsonStore', () => {
  it('starts empty when there is no file', () => {
    const store = new JsonStore(file)
    expect(store.data).toEqual(emptyDocument())
  })

  it('persists and reloads', () => {
    const store = new JsonStore(file)
    store.data.settings.hello = 'world'
    store.touch()
    store.flush()

    expect(new JsonStore(file).data.settings.hello).toBe('world')
  })

  it('writes atomically, leaving no temp file behind', () => {
    const store = new JsonStore(file)
    store.data.settings.a = 1
    store.touch()
    store.flush()

    expect(() => readFileSync(file, 'utf8')).not.toThrow()
    expect(() => readFileSync(`${file}.tmp`, 'utf8')).toThrow()
  })

  it('does not rewrite when nothing changed', () => {
    const store = new JsonStore(file)
    store.data.settings.a = 1
    store.touch()
    store.flush()
    const first = readFileSync(file, 'utf8')

    // No touch() -- flush must be a no-op rather than a redundant write.
    store.flush()
    expect(readFileSync(file, 'utf8')).toBe(first)
  })

  it('quarantines a corrupt document rather than refusing to start', () => {
    writeFileSync(file, '{ this is not json', 'utf8')
    const store = new JsonStore(file)

    expect(store.data).toEqual(emptyDocument())
    // The unreadable original is kept aside for recovery, not deleted.
    expect(() => readFileSync(file, 'utf8')).toThrow()
  })

  it('fills in collections missing from an older document', () => {
    writeFileSync(file, JSON.stringify({ version: 1, settings: { a: 1 } }), 'utf8')
    const store = new JsonStore(file)

    expect(store.data.tabs).toEqual([])
    expect(store.data.downloads).toEqual([])
    expect(store.data.settings.a).toBe(1)
  })

  it('close() flushes pending changes', () => {
    const store = new JsonStore(file)
    store.data.settings.a = 'persisted'
    store.touch()
    store.close()

    expect(new JsonStore(file).data.settings.a).toBe('persisted')
  })
})

describe('history', () => {
  let state: StateStore

  beforeEach(() => {
    state = new StateStore(new JsonStore(file))
  })

  it('records a visit', () => {
    state.recordVisit({ url: 'https://a.test', title: 'A', faviconUrl: null })
    expect(state.listHistory()).toHaveLength(1)
    expect(state.listHistory()[0]!.visitCount).toBe(1)
  })

  it('bumps an existing entry instead of appending a duplicate', () => {
    state.recordVisit({ url: 'https://a.test', title: 'A', faviconUrl: null })
    state.recordVisit({ url: 'https://a.test', title: 'A', faviconUrl: null })
    expect(state.listHistory()).toHaveLength(1)
    expect(state.listHistory()[0]!.visitCount).toBe(2)
  })

  it('ignores non-web URLs', () => {
    state.recordVisit({ url: 'about:blank', title: '', faviconUrl: null })
    state.recordVisit({ url: 'file:///etc/passwd', title: '', faviconUrl: null })
    expect(state.listHistory()).toHaveLength(0)
  })

  it('annotates a late title without counting another visit', () => {
    state.recordVisit({ url: 'https://a.test', title: '', faviconUrl: null })
    state.annotateHistory('https://a.test', { title: 'Arrived late' })

    const entry = state.listHistory()[0]!
    expect(entry.title).toBe('Arrived late')
    expect(entry.visitCount).toBe(1)
  })

  it('sorts most recent first', () => {
    state.recordVisit({ url: 'https://old.test', title: 'old', faviconUrl: null })
    state.recordVisit({ url: 'https://new.test', title: 'new', faviconUrl: null })
    expect(state.listHistory()[0]!.url).toBe('https://new.test')
  })

  it('searches title and url', () => {
    state.recordVisit({ url: 'https://example.com/docs', title: 'Handbook', faviconUrl: null })
    state.recordVisit({ url: 'https://other.test', title: 'Nothing', faviconUrl: null })

    expect(state.searchHistory('handbook')).toHaveLength(1)
    expect(state.searchHistory('example.com')).toHaveLength(1)
    expect(state.searchHistory('')).toHaveLength(2)
    expect(state.searchHistory('nope')).toHaveLength(0)
  })

  it('clears only visits newer than the cutoff', () => {
    state.recordVisit({ url: 'https://a.test', title: 'A', faviconUrl: null })
    // A cutoff in the future is newer than everything, so nothing is cleared.
    state.clearHistory(Date.now() + 60_000)
    expect(state.listHistory()).toHaveLength(1)

    // A cutoff just behind now clears the visit we only just recorded.
    state.clearHistory(Date.now() - 1000)
    expect(state.listHistory()).toHaveLength(0)
  })

  it('clears everything when given a null cutoff', () => {
    state.recordVisit({ url: 'https://b.test', title: 'B', faviconUrl: null })
    state.clearHistory(null)
    expect(state.listHistory()).toHaveLength(0)
  })
})

describe('downloads', () => {
  let state: StateStore

  const item = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    url: `https://files.test/${id}`,
    filename: `${id}.zip`,
    savePath: `/tmp/${id}.zip`,
    state: 'progressing' as const,
    receivedBytes: 0,
    totalBytes: 100,
    startedAt: Date.now(),
    completedAt: null,
    ...overrides
  })

  beforeEach(() => {
    state = new StateStore(new JsonStore(file))
  })

  it('upserts rather than duplicating', () => {
    state.upsertDownload(item('a'))
    state.upsertDownload(item('a', { filename: 'renamed.zip' }))
    expect(state.listDownloads()).toHaveLength(1)
    expect(state.listDownloads()[0]!.filename).toBe('renamed.zip')
  })

  it('updates progress', () => {
    state.upsertDownload(item('a'))
    state.updateDownload('a', { receivedBytes: 50 })
    expect(state.listDownloads()[0]!.receivedBytes).toBe(50)
  })

  it('clears only finished transfers', () => {
    state.upsertDownload(item('done', { state: 'completed' }))
    state.upsertDownload(item('failed', { state: 'interrupted' }))
    state.upsertDownload(item('running'))

    state.clearFinishedDownloads()
    expect(state.listDownloads().map((entry) => entry.id)).toEqual(['running'])
  })

  it('removes one by id', () => {
    state.upsertDownload(item('a'))
    state.removeDownload('a')
    expect(state.listDownloads()).toHaveLength(0)
  })
})

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Radius's persistence engine: one JSON document, held in memory, written
 * atomically.
 *
 * This replaced SQLite deliberately. `better-sqlite3` is a native module, so
 * every install needed a C++ toolchain and a `electron-rebuild` step against
 * Electron's ABI -- by far the most fragile part of getting the app running,
 * and worthless at this data scale. A browser's own state is a few hundred KB:
 * tabs, bookmarks, settings, recent history. Holding that in memory and
 * flushing it is faster than any query planner, and it makes `npm install`
 * followed by `npm run dev` the whole setup.
 *
 * The tradeoff is real and bounded: this does not scale to the full-text and
 * vector search that semantic history wants in M5. That feature can bring its
 * own index without disturbing anything here.
 */

export const STORE_VERSION = 1

/** A stored secret: safeStorage ciphertext, base64. Never plaintext. */
export interface SecretRecord {
  key: string
  ciphertext: string
  updatedAt: number
}

export interface StoreDocument {
  version: number
  workspaces: unknown[]
  groups: unknown[]
  tabs: unknown[]
  closedTabs: unknown[]
  bookmarks: unknown[]
  bookmarkFolders: unknown[]
  history: unknown[]
  downloads: unknown[]
  providers: unknown[]
  usage: unknown[]
  secrets: SecretRecord[]
  settings: Record<string, unknown>
}

export function emptyDocument(): StoreDocument {
  return {
    version: STORE_VERSION,
    workspaces: [],
    groups: [],
    tabs: [],
    closedTabs: [],
    bookmarks: [],
    bookmarkFolders: [],
    history: [],
    downloads: [],
    providers: [],
    usage: [],
    secrets: [],
    settings: {}
  }
}

const FLUSH_DELAY_MS = 300

export class JsonStore {
  private document: StoreDocument
  private flushTimer: NodeJS.Timeout | null = null
  private dirty = false

  constructor(private readonly filePath: string) {
    this.document = load(filePath)
  }

  get data(): StoreDocument {
    return this.document
  }

  /**
   * Marks the document changed and schedules a write.
   *
   * Debounced because a single page load mutates the document several times in
   * a row; writing once per burst keeps a 200-tab session from thrashing the
   * disk. Anything that must survive a crash calls `flush()` directly.
   */
  touch(): void {
    this.dirty = true
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, FLUSH_DELAY_MS)
    this.flushTimer.unref?.()
  }

  /**
   * Writes to a sibling temp file and renames over the target. Rename is
   * atomic on every platform we ship, so a crash mid-write leaves the previous
   * document intact rather than a truncated one.
   */
  flush(): void {
    if (!this.dirty) return
    const temporary = `${this.filePath}.tmp`
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(temporary, JSON.stringify(this.document), 'utf8')
      renameSync(temporary, this.filePath)
      this.dirty = false
    } catch (error) {
      // Losing a write is bad; crashing the browser over it is worse.
      console.error('Failed to persist Radius state:', error)
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
  }
}

/**
 * Reads the document, tolerating absence and corruption.
 *
 * A browser that refuses to start because its state file is malformed is worse
 * than one that starts empty, so an unreadable document is moved aside rather
 * than thrown.
 */
function load(filePath: string): StoreDocument {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return emptyDocument()
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoreDocument>
    return migrate({ ...emptyDocument(), ...parsed })
  } catch {
    try {
      renameSync(filePath, `${filePath}.corrupt-${Date.now()}`)
    } catch {
      // Nothing more to do; start fresh either way.
    }
    return emptyDocument()
  }
}

/** Forward migrations for the stored document shape. */
function migrate(document: StoreDocument): StoreDocument {
  // v1 is current. Future versions branch here on `document.version`.
  document.version = STORE_VERSION
  return document
}

export function storePathFor(userDataDir: string): string {
  return join(userDataDir, 'radius-state.json')
}

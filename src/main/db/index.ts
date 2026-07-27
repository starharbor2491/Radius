import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { MIGRATIONS } from './migrations'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export interface DbHandle {
  db: Db
  sqlite: Database.Database
  close: () => void
}

/**
 * Applies every migration newer than the file's `user_version`, in one
 * transaction per version so a failure leaves the file on the last good schema.
 */
export function migrate(sqlite: Database.Database): number {
  const current = sqlite.pragma('user_version', { simple: true }) as number
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const statements = MIGRATIONS[version]
    if (!statements) continue
    const run = sqlite.transaction(() => {
      for (const statement of statements) sqlite.exec(statement)
    })
    run()
    // Pragmas cannot be parameterised; version is a loop counter, not input.
    sqlite.pragma(`user_version = ${version + 1}`)
  }
  return MIGRATIONS.length
}

export function openDatabase(filePath: string): DbHandle {
  const sqlite = new Database(filePath)
  // WAL keeps the 30-second session snapshot from blocking reads in the UI.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  migrate(sqlite)

  const db = drizzle(sqlite, { schema })
  return {
    db,
    sqlite,
    close: () => sqlite.close()
  }
}

export function databasePathFor(userDataDir: string): string {
  return join(userDataDir, 'radius.db')
}

export { schema }

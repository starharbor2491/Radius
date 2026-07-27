/**
 * Hand-written forward migrations, applied in order and tracked with SQLite's
 * `user_version` pragma.
 *
 * We deliberately do not run drizzle-kit at app start: shipping the DDL as
 * plain statements keeps the packaged app free of a codegen step, and the
 * pragma gives us an atomic "which version is this file at" with no extra
 * table to keep in sync.
 */
export const MIGRATIONS: string[][] = [
  // v1 -- initial schema
  [
    `CREATE TABLE workspaces (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       icon TEXT NOT NULL DEFAULT '◎',
       accent TEXT NOT NULL,
       "order" INTEGER NOT NULL DEFAULT 0,
       theme_id TEXT,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE tab_groups (
       id TEXT PRIMARY KEY,
       workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
       title TEXT NOT NULL DEFAULT '',
       color TEXT NOT NULL DEFAULT 'blue',
       collapsed INTEGER NOT NULL DEFAULT 0,
       "order" INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE TABLE tabs (
       id TEXT PRIMARY KEY,
       workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
       group_id TEXT REFERENCES tab_groups(id) ON DELETE SET NULL,
       url TEXT NOT NULL DEFAULT '',
       title TEXT NOT NULL DEFAULT '',
       favicon_url TEXT,
       pinned INTEGER NOT NULL DEFAULT 0,
       "order" INTEGER NOT NULL DEFAULT 0,
       last_active_at INTEGER NOT NULL DEFAULT 0,
       in_ai_context INTEGER NOT NULL DEFAULT 0,
       scroll_y INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE INDEX idx_tabs_workspace ON tabs(workspace_id, "order")`,
    `CREATE TABLE closed_tabs (
       id TEXT PRIMARY KEY,
       workspace_id TEXT NOT NULL,
       url TEXT NOT NULL,
       title TEXT NOT NULL DEFAULT '',
       favicon_url TEXT,
       group_id TEXT,
       "order" INTEGER NOT NULL DEFAULT 0,
       closed_at INTEGER NOT NULL
     )`,
    `CREATE TABLE bookmark_folders (
       id TEXT PRIMARY KEY,
       parent_id TEXT REFERENCES bookmark_folders(id) ON DELETE CASCADE,
       name TEXT NOT NULL,
       "order" INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE TABLE bookmarks (
       id TEXT PRIMARY KEY,
       folder_id TEXT REFERENCES bookmark_folders(id) ON DELETE SET NULL,
       url TEXT NOT NULL,
       title TEXT NOT NULL DEFAULT '',
       favicon_url TEXT,
       tags TEXT NOT NULL DEFAULT '[]',
       note TEXT NOT NULL DEFAULT '',
       "order" INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
    `CREATE TABLE secrets (
       key TEXT PRIMARY KEY,
       ciphertext TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE providers (
       id TEXT PRIMARY KEY,
       tier TEXT NOT NULL,
       label TEXT NOT NULL,
       adapter TEXT,
       base_url TEXT,
       manifest TEXT,
       models TEXT NOT NULL DEFAULT '[]',
       enabled INTEGER NOT NULL DEFAULT 1,
       "order" INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE TABLE usage_records (
       id TEXT PRIMARY KEY,
       provider_id TEXT NOT NULL,
       model_id TEXT NOT NULL,
       feature TEXT NOT NULL,
       input_tokens INTEGER NOT NULL DEFAULT 0,
       output_tokens INTEGER NOT NULL DEFAULT 0,
       cost_usd REAL NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX idx_usage_created ON usage_records(created_at)`
  ]
]

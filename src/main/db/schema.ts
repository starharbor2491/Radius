import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Local-first storage. Everything Radius knows lives in one SQLite file under
 * the user's data directory -- there is no server component.
 *
 * Secrets are the exception to "just store it": the `secrets` table holds
 * safeStorage ciphertext, never plaintext.
 */

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('◎'),
  accent: text('accent').notNull(),
  order: integer('order').notNull().default(0),
  themeId: text('theme_id'),
  createdAt: integer('created_at').notNull()
})

export const tabGroups = sqliteTable('tab_groups', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  title: text('title').notNull().default(''),
  color: text('color').notNull().default('blue'),
  collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
  order: integer('order').notNull().default(0)
})

export const tabs = sqliteTable('tabs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  groupId: text('group_id'),
  url: text('url').notNull().default(''),
  title: text('title').notNull().default(''),
  faviconUrl: text('favicon_url'),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  order: integer('order').notNull().default(0),
  lastActiveAt: integer('last_active_at').notNull().default(0),
  inAiContext: integer('in_ai_context', { mode: 'boolean' }).notNull().default(false),
  /** Restored into the WebContentsView when a suspended tab wakes up. */
  scrollY: integer('scroll_y').notNull().default(0)
})

/** Ring buffer backing "reopen closed tab". */
export const closedTabs = sqliteTable('closed_tabs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  url: text('url').notNull(),
  title: text('title').notNull().default(''),
  faviconUrl: text('favicon_url'),
  groupId: text('group_id'),
  order: integer('order').notNull().default(0),
  closedAt: integer('closed_at').notNull()
})

export const bookmarkFolders = sqliteTable('bookmark_folders', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  order: integer('order').notNull().default(0)
})

export const bookmarks = sqliteTable('bookmarks', {
  id: text('id').primaryKey(),
  folderId: text('folder_id'),
  url: text('url').notNull(),
  title: text('title').notNull().default(''),
  faviconUrl: text('favicon_url'),
  tags: text('tags', { mode: 'json' }).notNull().$type<string[]>().default([]),
  note: text('note').notNull().default(''),
  order: integer('order').notNull().default(0),
  createdAt: integer('created_at').notNull()
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull().$type<unknown>()
})

/**
 * safeStorage ciphertext, base64-encoded. Decryption only ever happens in the
 * main process, and the plaintext never crosses an IPC boundary.
 */
export const secrets = sqliteTable('secrets', {
  key: text('key').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  tier: text('tier').notNull(),
  label: text('label').notNull(),
  adapter: text('adapter'),
  baseUrl: text('base_url'),
  manifest: text('manifest', { mode: 'json' }).$type<unknown>(),
  models: text('models', { mode: 'json' }).notNull().$type<unknown[]>().default([]),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  order: integer('order').notNull().default(0)
})

export const usageRecords = sqliteTable('usage_records', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull(),
  modelId: text('model_id').notNull(),
  feature: text('feature').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  createdAt: integer('created_at').notNull()
})

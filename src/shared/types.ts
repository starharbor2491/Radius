import { z } from 'zod'
import { LayoutSchema } from './layout'

/** Every persisted entity uses a UUID string id. */
export const IdSchema = z.string().min(1)
export type Id = z.infer<typeof IdSchema>

/* ------------------------------------------------------------------ *
 * Workspaces, groups, tabs
 * ------------------------------------------------------------------ */

export const TAB_GROUP_COLORS = [
  'slate',
  'blue',
  'cyan',
  'teal',
  'green',
  'amber',
  'orange',
  'red',
  'pink',
  'violet'
] as const
export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number]
export const TabGroupColorSchema = z.enum(TAB_GROUP_COLORS)

export const WorkspaceSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** Single glyph or emoji shown in the workspace switcher. */
  icon: z.string(),
  /** OKLCH accent that overrides the theme accent while this workspace is active. */
  accent: z.string(),
  order: z.number().int(),
  /** Theme preset id this workspace pins to, or null to follow the global theme. */
  themeId: z.string().nullable(),
  /**
   * A partial token document merged over whichever theme is in use while this
   * workspace is active -- any subset of the theme shape, not just the accent.
   * A workspace can be denser, or lighter, or drop the blur, and carries only
   * the tokens it actually changes so it inherits every later edit to the base.
   *
   * Defaulted rather than required, so a state document written before this
   * field existed still parses.
   */
  themeOverride: z.record(z.string(), z.unknown()).nullable().default(null),
  /**
   * Where this workspace's panels are docked. Prefaulted, so a workspace
   * persisted before the layout editor existed resolves to the arrangement it
   * already had rather than failing to parse.
   */
  layout: LayoutSchema,
  createdAt: z.number().int()
})
export type Workspace = z.infer<typeof WorkspaceSchema>

export const TabGroupSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  title: z.string(),
  color: TabGroupColorSchema,
  collapsed: z.boolean(),
  order: z.number().int()
})
export type TabGroup = z.infer<typeof TabGroupSchema>

export const TabSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  groupId: IdSchema.nullable(),
  url: z.string(),
  title: z.string(),
  faviconUrl: z.string().nullable(),
  pinned: z.boolean(),
  /** True when the WebContentsView has been torn down to reclaim memory. */
  suspended: z.boolean(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  order: z.number().int(),
  lastActiveAt: z.number().int(),
  /** Whether this tab's extracted content is offered to the AI panel. */
  inAiContext: z.boolean()
})
export type Tab = z.infer<typeof TabSchema>

/* ------------------------------------------------------------------ *
 * Bookmarks
 * ------------------------------------------------------------------ */

export const BookmarkFolderSchema = z.object({
  id: IdSchema,
  parentId: IdSchema.nullable(),
  name: z.string(),
  order: z.number().int()
})
export type BookmarkFolder = z.infer<typeof BookmarkFolderSchema>

export const BookmarkSchema = z.object({
  id: IdSchema,
  folderId: IdSchema.nullable(),
  url: z.string(),
  title: z.string(),
  faviconUrl: z.string().nullable(),
  tags: z.array(z.string()),
  note: z.string(),
  order: z.number().int(),
  createdAt: z.number().int()
})
export type Bookmark = z.infer<typeof BookmarkSchema>

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export const HistoryEntrySchema = z.object({
  id: IdSchema,
  url: z.string(),
  title: z.string(),
  faviconUrl: z.string().nullable(),
  /** Most recent visit. Revisiting an URL updates this rather than adding a row. */
  visitedAt: z.number().int(),
  visitCount: z.number().int()
})
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>

/* ------------------------------------------------------------------ *
 * Downloads
 * ------------------------------------------------------------------ */

export const DownloadStateSchema = z.enum([
  'progressing',
  'paused',
  'completed',
  'cancelled',
  'interrupted'
])
export type DownloadState = z.infer<typeof DownloadStateSchema>

export const DownloadItemSchema = z.object({
  id: IdSchema,
  url: z.string(),
  filename: z.string(),
  savePath: z.string(),
  state: DownloadStateSchema,
  receivedBytes: z.number().int(),
  /** Zero when the server sends no content-length. */
  totalBytes: z.number().int(),
  startedAt: z.number().int(),
  completedAt: z.number().int().nullable()
})
export type DownloadItem = z.infer<typeof DownloadItemSchema>

/* ------------------------------------------------------------------ *
 * Find in page
 * ------------------------------------------------------------------ */

export const FindResultSchema = z.object({
  tabId: IdSchema,
  activeMatchOrdinal: z.number().int(),
  matches: z.number().int()
})
export type FindResult = z.infer<typeof FindResultSchema>

/* ------------------------------------------------------------------ *
 * AI providers
 * ------------------------------------------------------------------ *
 * Three tiers, as described in ARCHITECTURE.md:
 *   native            hand-written adapter, capability-accurate
 *   openai-compatible any endpoint speaking the OpenAI chat-completions shape
 *   manifest          user-supplied JSON describing a non-standard API
 */

export const ProviderTierSchema = z.enum(['native', 'openai-compatible', 'manifest'])
export type ProviderTier = z.infer<typeof ProviderTierSchema>

export const ModelCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  tools: z.boolean(),
  vision: z.boolean(),
  reasoning: z.boolean()
})
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>

export const ModelInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  contextWindow: z.number().int(),
  maxOutputTokens: z.number().int(),
  capabilities: ModelCapabilitiesSchema,
  /** USD per million tokens. Null when the provider does not publish pricing. */
  inputPricePerMTok: z.number().nullable(),
  outputPricePerMTok: z.number().nullable()
})
export type ModelInfo = z.infer<typeof ModelInfoSchema>

/**
 * How a manifest provider authenticates. Covers the shapes we have seen in
 * the wild without needing to execute user code.
 */
export const AuthStyleSchema = z.enum(['bearer', 'x-api-key', 'query-param', 'none'])
export type AuthStyle = z.infer<typeof AuthStyleSchema>

/**
 * Tier 3. A declarative description of a chat endpoint: where to POST, how to
 * authenticate, where the messages go in the request body, and where the text
 * lives in the response. Interpreted at runtime -- it is data, never code.
 */
export const ProviderManifestSchema = z.object({
  /** Absolute URL of the chat/completions endpoint. */
  endpoint: z.string().url(),
  authStyle: AuthStyleSchema,
  /** Header name for `bearer`/`x-api-key`, or query key for `query-param`. */
  authKey: z.string().default('Authorization'),
  /** Extra static headers merged into every request. */
  headers: z.record(z.string(), z.string()).default({}),
  /** Body field the model id is written to. */
  modelField: z.string().default('model'),
  /** Body field the message array is written to. */
  messagesField: z.string().default('messages'),
  /** Static body fields merged into every request. */
  body: z.record(z.string(), z.unknown()).default({}),
  /** Wire format of a streamed response. */
  streamFormat: z.enum(['sse', 'ndjson', 'none']).default('sse'),
  /** Dotted path to the text delta inside each stream chunk. */
  deltaPath: z.string().default('choices.0.delta.content'),
  /** Dotted path to the text inside a non-streamed response. */
  textPath: z.string().default('choices.0.message.content'),
  /** Sentinel that terminates an SSE stream. */
  doneSentinel: z.string().default('[DONE]')
})
export type ProviderManifest = z.infer<typeof ProviderManifestSchema>

export const ProviderConfigSchema = z.object({
  id: IdSchema,
  tier: ProviderTierSchema,
  label: z.string(),
  /** Identifies the built-in adapter for `native` providers (e.g. "anthropic"). */
  adapter: z.string().nullable(),
  /** Base URL for `openai-compatible` providers. */
  baseUrl: z.string().nullable(),
  manifest: ProviderManifestSchema.nullable(),
  models: z.array(ModelInfoSchema),
  enabled: z.boolean(),
  order: z.number().int()
})
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

/**
 * What the renderer is allowed to know about a provider. Deliberately carries
 * `hasKey` rather than the key itself -- secrets never cross the IPC boundary.
 */
export const ProviderStatusSchema = ProviderConfigSchema.extend({
  hasKey: z.boolean()
})
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

export const ChatRoleSchema = z.enum(['system', 'user', 'assistant'])
export type ChatRole = z.infer<typeof ChatRoleSchema>

export const ChatMessageSchema = z.object({
  id: IdSchema,
  role: ChatRoleSchema,
  content: z.string(),
  createdAt: z.number().int()
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int(),
  outputTokens: z.number().int()
})
export type TokenUsage = z.infer<typeof TokenUsageSchema>

/** Events pushed from main to the renderer during a streamed completion. */
export const AiStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ runId: z.string(), type: z.literal('delta'), text: z.string() }),
  z.object({ runId: z.string(), type: z.literal('done'), usage: TokenUsageSchema.nullable() }),
  z.object({ runId: z.string(), type: z.literal('error'), message: z.string() }),
  /**
   * Something the user should know that is not the answer and not a failure --
   * a fallback provider taking over, or a budget warning. Non-terminal: a run
   * that emits a notice still ends with exactly one `done` or `error`.
   */
  z.object({ runId: z.string(), type: z.literal('notice'), message: z.string() }),
  /**
   * A reasoning-model's visible thinking, where the provider streams it.
   *
   * Kept a separate event rather than folded into `delta` because it is not the
   * answer: it must not be shown as the reply, must not be fed back as assistant
   * turn content, and the agent loop has to ignore it when parsing an action.
   */
  z.object({ runId: z.string(), type: z.literal('reasoning'), text: z.string() })
])
export type AiStreamEvent = z.infer<typeof AiStreamEventSchema>

/** A recorded completion, used for the cost meter. */
export const UsageRecordSchema = z.object({
  id: IdSchema,
  providerId: IdSchema,
  modelId: z.string(),
  feature: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  createdAt: z.number().int()
})
export type UsageRecord = z.infer<typeof UsageRecordSchema>

/* ------------------------------------------------------------------ *
 * Page context handed to the AI
 * ------------------------------------------------------------------ */

export const PageContextSchema = z.object({
  tabId: IdSchema,
  url: z.string(),
  title: z.string(),
  /** Readable text extracted from the page, already truncated. */
  text: z.string(),
  selection: z.string()
})
export type PageContext = z.infer<typeof PageContextSchema>

/* ------------------------------------------------------------------ *
 * Aggregate state snapshot
 * ------------------------------------------------------------------ */

export const AppStateSchema = z.object({
  workspaces: z.array(WorkspaceSchema),
  activeWorkspaceId: IdSchema.nullable(),
  groups: z.array(TabGroupSchema),
  tabs: z.array(TabSchema),
  activeTabIdByWorkspace: z.record(z.string(), IdSchema.nullable()),
  bookmarks: z.array(BookmarkSchema),
  bookmarkFolders: z.array(BookmarkFolderSchema),
  /** Most recent first, capped -- the full log is not shipped to the renderer. */
  history: z.array(HistoryEntrySchema),
  downloads: z.array(DownloadItemSchema),
  providers: z.array(ProviderStatusSchema),
  settings: z.record(z.string(), z.unknown())
})
export type AppState = z.infer<typeof AppStateSchema>

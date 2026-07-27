import { z } from 'zod'
import {
  AiStreamEventSchema,
  AppStateSchema,
  BookmarkFolderSchema,
  BookmarkSchema,
  ChatMessageSchema,
  FindResultSchema,
  HistoryEntrySchema,
  IdSchema,
  ModelInfoSchema,
  PageContextSchema,
  ProviderManifestSchema,
  ProviderStatusSchema,
  TabGroupColorSchema,
  TabGroupSchema,
  TabSchema,
  UsageRecordSchema,
  WorkspaceSchema
} from './types'
import { ThemeSchema } from './theme'

/**
 * The single source of truth for the main <-> renderer boundary.
 *
 * Main registers a handler for exactly the channels named here and validates
 * every payload against `request` before the handler runs. A renderer cannot
 * reach a channel that is not in this object, and cannot hand a handler a
 * payload of the wrong shape.
 */

const Empty = z.object({})
const Ok = z.object({ ok: z.literal(true) })

const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})
export type Rect = z.infer<typeof RectSchema>

export const ipcContract = {
  /* -------------------------------------------------------------- state */
  'state:get': { request: Empty, response: AppStateSchema },

  /* --------------------------------------------------------------- tabs */
  'tabs:create': {
    request: z.object({
      workspaceId: IdSchema.optional(),
      url: z.string().optional(),
      groupId: IdSchema.nullable().optional(),
      index: z.number().int().optional(),
      background: z.boolean().optional()
    }),
    response: TabSchema
  },
  'tabs:close': { request: z.object({ tabId: IdSchema }), response: Ok },
  'tabs:activate': { request: z.object({ tabId: IdSchema }), response: Ok },
  'tabs:navigate': { request: z.object({ tabId: IdSchema, url: z.string() }), response: Ok },
  'tabs:goBack': { request: z.object({ tabId: IdSchema }), response: Ok },
  'tabs:goForward': { request: z.object({ tabId: IdSchema }), response: Ok },
  'tabs:reload': { request: z.object({ tabId: IdSchema, hard: z.boolean().optional() }), response: Ok },
  'tabs:stop': { request: z.object({ tabId: IdSchema }), response: Ok },
  'tabs:move': {
    request: z.object({
      tabId: IdSchema,
      toIndex: z.number().int(),
      groupId: IdSchema.nullable().optional(),
      workspaceId: IdSchema.optional()
    }),
    response: Ok
  },
  'tabs:setPinned': { request: z.object({ tabId: IdSchema, pinned: z.boolean() }), response: Ok },
  'tabs:suspend': { request: z.object({ tabId: IdSchema }), response: Ok },
  'tabs:setAiContext': {
    request: z.object({ tabId: IdSchema, inContext: z.boolean() }),
    response: Ok
  },
  'tabs:reopenClosed': { request: Empty, response: TabSchema.nullable() },

  /* ------------------------------------------------------------- groups */
  'groups:create': {
    request: z.object({
      workspaceId: IdSchema,
      title: z.string().default('New group'),
      color: TabGroupColorSchema.default('blue'),
      tabIds: z.array(IdSchema).default([])
    }),
    response: TabGroupSchema
  },
  'groups:update': {
    request: z.object({
      groupId: IdSchema,
      title: z.string().optional(),
      color: TabGroupColorSchema.optional(),
      collapsed: z.boolean().optional()
    }),
    response: Ok
  },
  'groups:delete': {
    request: z.object({ groupId: IdSchema, closeTabs: z.boolean().default(false) }),
    response: Ok
  },

  /* --------------------------------------------------------- workspaces */
  'workspaces:create': {
    request: z.object({
      name: z.string().default('New workspace'),
      icon: z.string().default('◎'),
      accent: z.string().optional()
    }),
    response: WorkspaceSchema
  },
  'workspaces:activate': { request: z.object({ workspaceId: IdSchema }), response: Ok },
  'workspaces:update': {
    request: z.object({
      workspaceId: IdSchema,
      name: z.string().optional(),
      icon: z.string().optional(),
      accent: z.string().optional(),
      themeId: z.string().nullable().optional()
    }),
    response: Ok
  },
  'workspaces:delete': { request: z.object({ workspaceId: IdSchema }), response: Ok },
  'workspaces:reorder': { request: z.object({ orderedIds: z.array(IdSchema) }), response: Ok },

  /* ---------------------------------------------------------- bookmarks */
  'bookmarks:create': {
    request: z.object({
      url: z.string(),
      title: z.string(),
      faviconUrl: z.string().nullable().default(null),
      folderId: IdSchema.nullable().default(null),
      tags: z.array(z.string()).default([]),
      note: z.string().default('')
    }),
    response: BookmarkSchema
  },
  'bookmarks:update': {
    request: z.object({
      bookmarkId: IdSchema,
      title: z.string().optional(),
      note: z.string().optional(),
      tags: z.array(z.string()).optional(),
      folderId: IdSchema.nullable().optional()
    }),
    response: Ok
  },
  'bookmarks:delete': { request: z.object({ bookmarkId: IdSchema }), response: Ok },
  'bookmarkFolders:create': {
    request: z.object({ name: z.string(), parentId: IdSchema.nullable().default(null) }),
    response: BookmarkFolderSchema
  },
  'bookmarkFolders:delete': { request: z.object({ folderId: IdSchema }), response: Ok },

  /* ------------------------------------------------------------- chrome */
  /**
   * The renderer measures its own layout and reports how much room the chrome
   * occupies. Main is the only side that may move a WebContentsView, so this is
   * how a user-dragged sidebar ends up resizing the page.
   */
  'chrome:setInsets': {
    request: z.object({
      top: z.number().min(0),
      right: z.number().min(0),
      bottom: z.number().min(0),
      left: z.number().min(0)
    }),
    response: Ok
  },
  /**
   * Raises the chrome above the page view so popovers, the command palette and
   * the omnibox dropdown can paint over page content. Electron has no
   * per-region hit testing for views, so overlay mode is necessarily modal:
   * while it is active the page cannot receive mouse input. The renderer turns
   * it on when it opens an overlay and off when it closes one.
   */
  'chrome:setOverlay': { request: z.object({ active: z.boolean() }), response: Ok },
  /** Page inset and corner radius, so geometry tokens can reshape the viewport. */
  'chrome:setPageShape': {
    request: z.object({ inset: z.number().min(0).max(64), radius: z.number().min(0).max(48) }),
    response: Ok
  },
  'window:minimize': { request: Empty, response: Ok },
  'window:toggleMaximize': { request: Empty, response: Ok },
  'window:close': { request: Empty, response: Ok },

  /* ------------------------------------------------------------ history */
  'history:search': {
    request: z.object({ query: z.string().default(''), limit: z.number().int().optional() }),
    response: z.array(HistoryEntrySchema)
  },
  'history:delete': { request: z.object({ entryId: IdSchema }), response: Ok },
  /** `sinceMs: null` clears everything; a timestamp clears only newer visits. */
  'history:clear': { request: z.object({ sinceMs: z.number().int().nullable() }), response: Ok },

  /* ---------------------------------------------------------- downloads */
  'downloads:open': { request: z.object({ id: IdSchema }), response: Ok },
  'downloads:reveal': { request: z.object({ id: IdSchema }), response: Ok },
  'downloads:cancel': { request: z.object({ id: IdSchema }), response: Ok },
  'downloads:remove': { request: z.object({ id: IdSchema }), response: Ok },
  'downloads:clearFinished': { request: Empty, response: Ok },

  /* --------------------------------------------------------------- find */
  /**
   * Results arrive as `find:result` events, since a search updates as you type.
   *
   * `findNext` mirrors Electron and reads backwards from what you would guess:
   * `true` means "begin a new find session" (use it for a new or edited query)
   * and `false` means "advance within the existing session" (use it for
   * next/previous). Sending `false` with no session open reports nothing at all.
   */
  'find:start': {
    request: z.object({
      tabId: IdSchema,
      query: z.string(),
      forward: z.boolean().default(true),
      findNext: z.boolean().default(true),
      matchCase: z.boolean().default(false)
    }),
    response: Ok
  },
  'find:stop': {
    request: z.object({ tabId: IdSchema, keepSelection: z.boolean().default(false) }),
    response: Ok
  },

  /* --------------------------------------------------------------- zoom */
  'zoom:set': {
    request: z.object({ tabId: IdSchema, factor: z.number().min(0.25).max(5) }),
    response: z.object({ factor: z.number() })
  },
  'zoom:step': {
    request: z.object({ tabId: IdSchema, direction: z.enum(['in', 'out', 'reset']) }),
    response: z.object({ factor: z.number() })
  },

  /* -------------------------------------------------------- keybindings */
  'keybindings:get': { request: Empty, response: z.record(z.string(), z.string()) },
  'keybindings:set': {
    request: z.object({ bindings: z.record(z.string(), z.string()) }),
    response: Ok
  },

  /* -------------------------------------------------------------- theme */
  'theme:get': {
    request: Empty,
    response: z.object({ theme: ThemeSchema, presets: z.array(ThemeSchema) })
  },
  'theme:set': { request: z.object({ theme: ThemeSchema }), response: Ok },
  'theme:importFile': { request: Empty, response: ThemeSchema.nullable() },
  'theme:exportFile': { request: z.object({ theme: ThemeSchema }), response: Ok },

  /* ----------------------------------------------------------- settings */
  'settings:get': { request: Empty, response: z.record(z.string(), z.unknown()) },
  'settings:set': { request: z.object({ key: z.string(), value: z.unknown() }), response: Ok },

  /* --------------------------------------------------------------- page */
  'page:getContext': { request: z.object({ tabId: IdSchema }), response: PageContextSchema },

  /* ----------------------------------------------------------------- ai */
  'ai:listProviders': { request: Empty, response: z.array(ProviderStatusSchema) },
  'ai:setKey': { request: z.object({ providerId: IdSchema, key: z.string() }), response: Ok },
  'ai:clearKey': { request: z.object({ providerId: IdSchema }), response: Ok },
  'ai:testProvider': {
    request: z.object({ providerId: IdSchema, modelId: z.string().optional() }),
    response: z.object({ ok: z.boolean(), message: z.string() })
  },
  'ai:addOpenAiCompatible': {
    request: z.object({
      label: z.string(),
      baseUrl: z.string().url(),
      models: z.array(ModelInfoSchema).default([])
    }),
    response: ProviderStatusSchema
  },
  'ai:addManifestProvider': {
    request: z.object({
      label: z.string(),
      manifest: ProviderManifestSchema,
      models: z.array(ModelInfoSchema).default([])
    }),
    response: ProviderStatusSchema
  },
  'ai:removeProvider': { request: z.object({ providerId: IdSchema }), response: Ok },
  'ai:discoverModels': {
    request: z.object({ providerId: IdSchema }),
    response: z.array(ModelInfoSchema)
  },
  /**
   * Fire-and-forget: the reply arrives as a series of `ai:stream` events keyed
   * by `runId`, so the renderer can render tokens as they land.
   */
  'ai:send': {
    request: z.object({
      runId: z.string(),
      providerId: IdSchema,
      modelId: z.string(),
      messages: z.array(ChatMessageSchema),
      contextTabIds: z.array(IdSchema).default([]),
      feature: z.string().default('chat')
    }),
    response: Ok
  },
  'ai:cancel': { request: z.object({ runId: z.string() }), response: Ok },
  'ai:usage': {
    request: z.object({ sinceMs: z.number().int().optional() }),
    response: z.array(UsageRecordSchema)
  }
} as const satisfies Record<string, { request: z.ZodType; response: z.ZodType }>

export type IpcContract = typeof ipcContract
export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = z.input<IpcContract[C]['request']>
export type IpcRequestParsed<C extends IpcChannel> = z.output<IpcContract[C]['request']>
export type IpcResponse<C extends IpcChannel> = z.output<IpcContract[C]['response']>

export const IPC_CHANNELS = Object.keys(ipcContract) as IpcChannel[]

export function isIpcChannel(value: string): value is IpcChannel {
  return Object.prototype.hasOwnProperty.call(ipcContract, value)
}

/* ------------------------------------------------------------------ *
 * Main -> renderer events
 * ------------------------------------------------------------------ */

export const ipcEvents = {
  /** A fresh authoritative snapshot. Main owns the state; the renderer mirrors it. */
  'state:changed': AppStateSchema,
  'ai:stream': AiStreamEventSchema,
  /** Match counts for the find bar, pushed as the query is refined. */
  'find:result': FindResultSchema,
  /** A global shortcut or menu item fired a named command. */
  'command:invoke': z.object({ command: z.string() })
} as const satisfies Record<string, z.ZodType>

export type IpcEvents = typeof ipcEvents
export type IpcEventName = keyof IpcEvents
export type IpcEventPayload<E extends IpcEventName> = z.output<IpcEvents[E]>

export const IPC_EVENT_NAMES = Object.keys(ipcEvents) as IpcEventName[]

import { ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  ipcContract,
  type IpcChannel,
  type IpcRequestParsed,
  type IpcResponse
} from '@shared/ipc'
import type { AppState, PageContext } from '@shared/types'
import type { StateStore } from '../state/StateStore'
import type { TabManager } from '../tabs/TabManager'
import type { RadiusWindow } from '../window/RadiusWindow'
import type { ProviderRegistry } from '../ai/ProviderRegistry'
import type { ThemeService } from '../theme/ThemeService'
import type { PageContextService } from '../page/PageContextService'
import type { DownloadService } from '../downloads/DownloadService'
import type { AgentController } from '../agent/AgentController'
import { DEFAULT_KEYBINDINGS } from '@shared/keybindings'
import { withContext } from '../ai/context'

export interface AppServices {
  state: StateStore
  tabs: TabManager
  window: RadiusWindow
  providers: ProviderRegistry
  theme: ThemeService
  pageContext: PageContextService
  downloads: DownloadService
  agent: AgentController
}

const OK = { ok: true } as const

/** The renderer's view of the world: persisted state plus live provider status. */
export function buildState(services: AppServices): AppState {
  return { ...services.state.snapshot(), providers: services.providers.list() }
}

type HandlerMap = {
  [C in IpcChannel]: (payload: IpcRequestParsed<C>) => IpcResponse<C> | Promise<IpcResponse<C>>
}

export function registerIpcHandlers(services: AppServices): void {
  const { state, tabs, window, providers, theme, pageContext, downloads, agent } = services

  /** The agent needs the live view plus its zoom, to convert coordinates. */
  const agentTarget = (tabId: string) => ({
    contents: window.getView(tabId)?.webContents,
    zoom: state.getRuntime(tabId).zoom
  })

  const handlers: HandlerMap = {
    'state:get': () => buildState(services),

    /* ------------------------------------------------------------- tabs */
    'tabs:create': (payload) => tabs.create(payload),
    'tabs:close': ({ tabId }) => {
      tabs.close(tabId)
      return OK
    },
    'tabs:activate': ({ tabId }) => {
      tabs.activate(tabId)
      return OK
    },
    'tabs:navigate': ({ tabId, url }) => {
      tabs.navigate(tabId, url)
      return OK
    },
    'tabs:goBack': ({ tabId }) => {
      tabs.goBack(tabId)
      return OK
    },
    'tabs:goForward': ({ tabId }) => {
      tabs.goForward(tabId)
      return OK
    },
    'tabs:reload': ({ tabId, hard }) => {
      tabs.reload(tabId, hard ?? false)
      return OK
    },
    'tabs:stop': ({ tabId }) => {
      tabs.stop(tabId)
      return OK
    },
    'tabs:move': (payload) => {
      tabs.move(payload)
      return OK
    },
    'tabs:setPinned': ({ tabId, pinned }) => {
      tabs.setPinned(tabId, pinned)
      return OK
    },
    'tabs:suspend': ({ tabId }) => {
      tabs.suspend(tabId)
      return OK
    },
    'tabs:setAiContext': ({ tabId, inContext }) => {
      state.updateTab(tabId, { inAiContext: inContext })
      return OK
    },
    'tabs:reopenClosed': () => tabs.reopenClosed(),

    /* ----------------------------------------------------------- groups */
    'groups:create': (payload) => tabs.createGroup(payload),
    'groups:update': ({ groupId, ...patch }) => {
      state.updateGroup(groupId, patch)
      return OK
    },
    'groups:delete': ({ groupId, closeTabs }) => {
      tabs.deleteGroup(groupId, closeTabs)
      return OK
    },

    /* ------------------------------------------------------- workspaces */
    'workspaces:create': ({ name, icon, accent }) =>
      state.createWorkspace({ name, icon, ...(accent === undefined ? {} : { accent }) }),
    'workspaces:activate': ({ workspaceId }) => {
      tabs.activateWorkspace(workspaceId)
      return OK
    },
    'workspaces:update': ({ workspaceId, ...patch }) => {
      state.updateWorkspace(workspaceId, patch)
      return OK
    },
    'workspaces:delete': ({ workspaceId }) => {
      tabs.deleteWorkspace(workspaceId)
      return OK
    },
    'workspaces:reorder': ({ orderedIds }) => {
      state.reorderWorkspaces(orderedIds)
      return OK
    },

    /* -------------------------------------------------------- bookmarks */
    'bookmarks:create': (payload) => state.createBookmark(payload),
    'bookmarks:update': ({ bookmarkId, ...patch }) => {
      state.updateBookmark(bookmarkId, patch)
      return OK
    },
    'bookmarks:delete': ({ bookmarkId }) => {
      state.deleteBookmark(bookmarkId)
      return OK
    },
    'bookmarkFolders:create': ({ name, parentId }) => state.createBookmarkFolder(name, parentId),
    'bookmarkFolders:delete': ({ folderId }) => {
      state.deleteBookmarkFolder(folderId)
      return OK
    },

    /* ----------------------------------------------------------- chrome */
    'chrome:setInsets': (insets) => {
      window.setInsets(insets)
      return OK
    },
    'chrome:setOverlay': ({ active }) => {
      window.setOverlay(active)
      return OK
    },
    'chrome:setPageShape': ({ inset, radius }) => {
      window.setPageShape({ inset, radius })
      return OK
    },
    'window:minimize': () => {
      window.window.minimize()
      return OK
    },
    'window:toggleMaximize': () => {
      if (window.window.isMaximized()) window.window.unmaximize()
      else window.window.maximize()
      return OK
    },
    'window:close': () => {
      window.window.close()
      return OK
    },

    /* ------------------------------------------------------------ history */
    'history:search': ({ query, limit }) => state.searchHistory(query, limit),
    'history:delete': ({ entryId }) => {
      state.deleteHistoryEntry(entryId)
      return OK
    },
    'history:clear': ({ sinceMs }) => {
      state.clearHistory(sinceMs)
      return OK
    },

    /* ---------------------------------------------------------- downloads */
    'downloads:open': async ({ id }) => {
      await downloads.open(id)
      return OK
    },
    'downloads:reveal': ({ id }) => {
      downloads.reveal(id)
      return OK
    },
    'downloads:cancel': ({ id }) => {
      downloads.cancel(id)
      return OK
    },
    'downloads:remove': ({ id }) => {
      downloads.remove(id)
      return OK
    },
    'downloads:clearFinished': () => {
      state.clearFinishedDownloads()
      return OK
    },

    /* --------------------------------------------------------------- find */
    'find:start': (payload) => {
      tabs.find(payload)
      return OK
    },
    'find:stop': ({ tabId, keepSelection }) => {
      tabs.stopFind(tabId, keepSelection)
      return OK
    },

    /* --------------------------------------------------------------- zoom */
    'zoom:set': ({ tabId, factor }) => ({ factor: tabs.setZoom(tabId, factor) }),
    'zoom:step': ({ tabId, direction }) => ({ factor: tabs.stepZoom(tabId, direction) }),

    /* -------------------------------------------------------------- agent */
    'agent:begin': ({ tabId, label, accent }) => {
      agent.begin(agentTarget(tabId), label, accent)
      return OK
    },
    'agent:describe': ({ tabId }) => agent.describe(agentTarget(tabId)),
    'agent:act': ({ tabId, action }) => agent.perform(agentTarget(tabId), action),
    'agent:stop': ({ tabId }) => {
      agent.stop(agentTarget(tabId))
      return OK
    },

    /* -------------------------------------------------------- keybindings */
    'keybindings:get': () => ({
      ...DEFAULT_KEYBINDINGS,
      ...state.getSetting<Record<string, string>>('keybindings', {})
    }),
    'keybindings:set': ({ bindings }) => {
      state.setSetting('keybindings', bindings)
      state.notify()
      return OK
    },

    /* ------------------------------------------------------------ theme */
    'theme:get': () => ({ theme: theme.get(), presets: theme.presets() }),
    'theme:set': ({ theme: next }) => {
      theme.set(next)
      window.setPageShape({ inset: next.geometry.pageInset, radius: next.geometry.pageRadius })
      return OK
    },
    'theme:importFile': () => theme.importFromFile(),
    'theme:exportFile': async ({ theme: next }) => {
      await theme.exportToFile(next)
      return OK
    },

    /* --------------------------------------------------------- settings */
    'settings:get': () => state.getAllSettings(),
    'settings:set': ({ key, value }) => {
      state.setSetting(key, value)
      if (key === 'suspensionIdleMinutes' && typeof value === 'number') {
        tabs.setSuspensionOptions({ idleMinutes: value })
      }
      state.notify()
      return OK
    },

    /* ------------------------------------------------------------- page */
    'page:getContext': async ({ tabId }) => {
      const tab = state.getTab(tabId)
      return pageContext.extract(tabId, window.getView(tabId)?.webContents, tab?.url ?? '')
    },

    /* --------------------------------------------------------------- ai */
    'ai:listProviders': () => providers.list(),
    'ai:setKey': ({ providerId, key }) => {
      providers.setKey(providerId, key)
      state.notify()
      return OK
    },
    'ai:clearKey': ({ providerId }) => {
      providers.clearKey(providerId)
      state.notify()
      return OK
    },
    'ai:testProvider': ({ providerId, modelId }) => providers.test(providerId, modelId),
    'ai:addOpenAiCompatible': (payload) => {
      const created = providers.addOpenAiCompatible(payload)
      state.notify()
      return created
    },
    'ai:addManifestProvider': (payload) => {
      const created = providers.addManifestProvider(payload)
      state.notify()
      return created
    },
    'ai:removeProvider': ({ providerId }) => {
      providers.remove(providerId)
      state.notify()
      return OK
    },
    'ai:discoverModels': async ({ providerId }) => {
      const models = await providers.discoverModels(providerId)
      state.notify()
      return models
    },
    'ai:send': (payload) => {
      // Returns immediately; the reply arrives as `ai:stream` events. Context
      // extraction happens inside the task so a slow page never blocks the UI.
      void (async () => {
        const contexts = await collectContexts(services, payload.contextTabIds)
        const messages = withContext(payload.messages, contexts)
        await providers.run(
          {
            runId: payload.runId,
            providerId: payload.providerId,
            modelId: payload.modelId,
            messages,
            feature: payload.feature
          },
          (event) => {
            if (window.chromeView.webContents.isDestroyed()) return
            window.chromeView.webContents.send('ai:stream', event)
          }
        )
      })()
      return OK
    },
    'ai:cancel': ({ runId }) => {
      providers.cancel(runId)
      return OK
    },
    'ai:usage': ({ sinceMs }) => state.listUsage(sinceMs),

    /* ------------------------------------------------ routing & budget */
    'ai:getRouting': () => providers.routing(),
    'ai:setRouting': ({ config }) => {
      providers.setRouting(config)
      // Both documents live in settings, so the snapshot carries them to every
      // panel that renders them -- no second subscription.
      state.notify()
      return OK
    },
    'ai:getBudget': () => providers.budget(),
    'ai:setBudget': ({ config }) => {
      providers.setBudget(config)
      state.notify()
      return OK
    }
  }

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (_event, raw: unknown) => {
      // Validate before the handler sees it: a renderer is never trusted to
      // send a well-formed payload, even though ours always does.
      const parsed = ipcContract[channel].request.parse(raw ?? {})
      const handler = handlers[channel] as (payload: unknown) => unknown
      return handler(parsed)
    })
  }
}

async function collectContexts(
  services: AppServices,
  tabIds: string[]
): Promise<PageContext[]> {
  const results = await Promise.all(
    tabIds.map((tabId) => {
      const tab = services.state.getTab(tabId)
      return services.pageContext.extract(
        tabId,
        services.window.getView(tabId)?.webContents,
        tab?.url ?? ''
      )
    })
  )
  return results.filter((context) => context.text.length > 0 || context.selection.length > 0)
}

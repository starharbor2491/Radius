import { join } from 'node:path'
import { app, Menu, session, shell, type MenuItemConstructorOptions } from 'electron'
import { DEFAULT_KEYBINDINGS, electronAccelerator } from '@shared/keybindings'
import { JsonStore, storePathFor } from './store/JsonStore'
import { StateStore } from './state/StateStore'
import { SecretStore } from './ai/SecretStore'
import { ProviderRegistry } from './ai/ProviderRegistry'
import { ThemeService } from './theme/ThemeService'
import { PageContextService } from './page/PageContextService'
import { DownloadService } from './downloads/DownloadService'
import { AgentController } from './agent/AgentController'
import { RadiusWindow } from './window/RadiusWindow'
import { TabManager } from './tabs/TabManager'
import { buildState, registerIpcHandlers, type AppServices } from './ipc/handlers'

const PARTITION = 'persist:radius'

let store: JsonStore | null = null
let services: AppServices | null = null

function rendererEntry(): { devUrl?: string; filePath: string } {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  return {
    ...(devUrl ? { devUrl } : {}),
    filePath: join(__dirname, '../renderer/index.html')
  }
}

/**
 * Web content gets nothing it does not ask for and nothing we cannot justify.
 * The default answer to every permission prompt is no; individual grants come
 * later, per-site, from an explicit user action.
 */
function hardenSession(): void {
  const partition = session.fromPartition(PARTITION)
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  partition.setPermissionCheckHandler(() => false)
}

/**
 * The native menu, built from the live binding map.
 *
 * Accelerators used to be hardcoded here, which meant the menu quietly
 * disagreed with the rest of the app: applying the Vim set left Cmd+T opening a
 * tab from the File menu, and remapping a command did nothing to its menu item.
 * `electronAccelerator` returns null for a chord -- an Electron accelerator is
 * one combination and cannot express a sequence -- so those items keep working
 * but print no shortcut rather than one the OS would refuse to register.
 */
function buildMenu(
  bindings: Record<string, string>,
  send: (command: string) => void
): void {
  const isMac = process.platform === 'darwin'
  const command = (label: string, id: string): MenuItemConstructorOptions => {
    const binding = bindings[id]
    const accelerator = binding ? electronAccelerator(binding) : null
    return { label, ...(accelerator ? { accelerator } : {}), click: () => send(id) }
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        command('New Tab', 'tab.new'),
        command('Close Tab', 'tab.close'),
        command('Reopen Closed Tab', 'tab.reopen'),
        { type: 'separator' },
        command('New Workspace', 'workspace.new'),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        command('Focus Address Bar', 'omnibox.focus'),
        command('Command Palette', 'palette.open'),
        command('Toggle AI Panel', 'ai.toggle'),
        command('Toggle Sidebar', 'sidebar.toggle'),
        { type: 'separator' },
        command('Reload Page', 'tab.reload'),
        command('Theme Studio', 'theme.open'),
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, ...(isMac ? [{ role: 'zoom' as const }] : [])]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Radius on GitHub',
          click: () => void shell.openExternal('https://github.com/starharbor2491/radius')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function bootstrap(): void {
  hardenSession()

  const jsonStore = new JsonStore(storePathFor(app.getPath('userData')))
  store = jsonStore

  const state = new StateStore(jsonStore)
  state.ensureSeeded()

  const secrets = new SecretStore(jsonStore)
  const providers = new ProviderRegistry(jsonStore, secrets, state)
  providers.seedBuiltIns()

  const theme = new ThemeService(state)
  const pageContext = new PageContextService()
  const downloads = new DownloadService(state, PARTITION)
  downloads.attach()
  const agent = new AgentController()

  // The window's page-view callbacks need the TabManager, which needs the
  // window. The indirection through `tabs` resolves that cycle: nothing fires
  // until a page view exists, which is after both are constructed.
  let tabs: TabManager | null = null
  const window = new RadiusWindow(join(__dirname, '../preload'), rendererEntry(), {
    onTitle: (tabId, title) => tabs?.handleTitle(tabId, title),
    onFavicon: (tabId, favicon) => tabs?.handleFavicon(tabId, favicon),
    onLoading: (tabId, loading) => tabs?.handleLoading(tabId, loading),
    onNavigate: (tabId, url, back, forward) => tabs?.handleNavigate(tabId, url, back, forward),
    onOpenUrl: (url, background) => tabs?.handleOpenUrl(url, background),
    onFoundInPage: (tabId, activeMatchOrdinal, matches) => {
      if (window.chromeView.webContents.isDestroyed()) return
      window.chromeView.webContents.send('find:result', { tabId, activeMatchOrdinal, matches })
    }
  })

  tabs = new TabManager(state, window)
  const activeTheme = theme.get()
  window.setPageShape({
    inset: activeTheme.geometry.pageInset,
    radius: activeTheme.geometry.pageRadius
  })

  services = { state, tabs, window, providers, theme, pageContext, downloads, agent }
  registerIpcHandlers(services)

  state.subscribe((snapshot) => {
    if (window.chromeView.webContents.isDestroyed()) return
    window.chromeView.webContents.send('state:changed', {
      ...snapshot,
      providers: providers.list()
    })
  })

  /*
   * The menu is rebuilt whenever the bindings change, so remapping a command or
   * applying a preset set updates its menu item too. Rebuilt only when the map
   * actually differs -- `state.subscribe` fires on every mutation, and
   * reconstructing the application menu on each tab title change would be
   * visible on macOS.
   */
  const invoke = (commandId: string): void => {
    if (window.chromeView.webContents.isDestroyed()) return
    window.chromeView.webContents.send('command:invoke', { command: commandId })
  }
  const currentBindings = (): Record<string, string> => ({
    ...DEFAULT_KEYBINDINGS,
    ...state.getSetting<Record<string, string>>('keybindings', {})
  })

  let menuSignature = JSON.stringify(currentBindings())
  buildMenu(currentBindings(), invoke)

  state.subscribe(() => {
    const signature = JSON.stringify(currentBindings())
    if (signature === menuSignature) return
    menuSignature = signature
    buildMenu(currentBindings(), invoke)
  })

  // Restore only once the chrome can receive the snapshot it triggers.
  window.chromeView.webContents.once('did-finish-load', () => {
    tabs?.restore()
    tabs?.startSuspensionSweep()
    window.chromeView.webContents.send('state:changed', buildState(services!))
  })

  window.window.on('closed', () => {
    tabs?.stopSuspensionSweep()
    providers.cancelAll()
  })
}

// A second instance should focus the first rather than fight over the state file.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = services?.window.window
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    console.error('Failed to start Radius:', error)
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (!services) bootstrap()
  })

  app.on('before-quit', () => {
    services?.providers.cancelAll()
    services?.tabs.stopSuspensionSweep()
    store?.close()
    store = null
  })
}

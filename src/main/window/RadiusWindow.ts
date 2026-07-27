import { join } from 'node:path'
import { BaseWindow, WebContentsView, shell, type Rectangle } from 'electron'

export interface ChromeInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PageShape {
  inset: number
  radius: number
}

export interface PageViewCallbacks {
  onTitle: (tabId: string, title: string) => void
  onFavicon: (tabId: string, faviconUrl: string | null) => void
  onLoading: (tabId: string, loading: boolean) => void
  onNavigate: (tabId: string, url: string, canGoBack: boolean, canGoForward: boolean) => void
  onOpenUrl: (url: string, background: boolean) => void
}

const DEFAULT_INSETS: ChromeInsets = { top: 44, right: 0, bottom: 0, left: 248 }
const PARTITION = 'persist:radius'

/**
 * One browser window.
 *
 * Z-order is the whole trick here. The chrome is a full-window WebContentsView
 * sitting *underneath* the active page view; the page is inset from the window
 * edges, so the chrome is what you see in the surrounding margin and the page
 * covers the hole in the middle. Because the page is on top, it receives mouse
 * input normally -- which a full-window chrome overlay would otherwise swallow.
 *
 * When the renderer needs to paint over page content (command palette, omnibox
 * results, a menu) it asks for overlay mode and we raise the chrome above the
 * page. That is modal by construction, which is the behaviour those surfaces
 * want anyway.
 */
export class RadiusWindow {
  readonly window: BaseWindow
  readonly chromeView: WebContentsView

  private readonly pageViews = new Map<string, WebContentsView>()
  private activeTabId: string | null = null
  private insets: ChromeInsets = { ...DEFAULT_INSETS }
  private pageShape: PageShape = { inset: 8, radius: 12 }
  private overlayActive = false

  constructor(
    private readonly preloadDir: string,
    private readonly rendererEntry: { devUrl?: string; filePath: string },
    private readonly callbacks: PageViewCallbacks
  ) {
    this.window = new BaseWindow({
      width: 1440,
      height: 900,
      minWidth: 620,
      minHeight: 420,
      show: false,
      backgroundColor: '#00000000',
      ...RadiusWindow.platformChrome()
    })

    this.chromeView = new WebContentsView({
      webPreferences: {
        preload: join(this.preloadDir, 'chrome.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // The chrome is our own bundle; it never loads remote content.
        webSecurity: true,
        transparent: true
      }
    })
    this.chromeView.setBackgroundColor('#00000000')
    this.window.contentView.addChildView(this.chromeView)

    this.window.on('resize', () => this.layout())
    this.window.on('resized', () => this.layout())

    // BaseWindow has no `ready-to-show`; the chrome finishing its first paint
    // is the equivalent signal, and waiting for it avoids a white flash.
    this.chromeView.webContents.once('did-finish-load', () => this.window.show())

    void this.loadChrome()
    this.layout()
  }

  /**
   * Platform-specific window dressing. macOS keeps its native traffic lights
   * over a vibrant backdrop; Windows 11 gets acrylic; Linux has no guaranteed
   * compositor so it falls back to an opaque frameless window and the
   * `overlay` glass mode in CSS.
   */
  private static platformChrome(): Record<string, unknown> {
    if (process.platform === 'darwin') {
      return {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 14, y: 15 },
        vibrancy: 'under-window',
        visualEffectState: 'active',
        transparent: true
      }
    }
    if (process.platform === 'win32') {
      return { frame: false, backgroundMaterial: 'acrylic' }
    }
    return { frame: false, backgroundColor: '#12121a' }
  }

  private async loadChrome(): Promise<void> {
    if (this.rendererEntry.devUrl) {
      await this.chromeView.webContents.loadURL(this.rendererEntry.devUrl)
    } else {
      await this.chromeView.webContents.loadFile(this.rendererEntry.filePath)
    }
  }

  /* ------------------------------------------------------------ layout */

  setInsets(insets: ChromeInsets): void {
    this.insets = insets
    this.layout()
  }

  setPageShape(shape: PageShape): void {
    this.pageShape = shape
    this.layout()
  }

  setOverlay(active: boolean): void {
    if (this.overlayActive === active) return
    this.overlayActive = active
    this.applyStacking()
  }

  /** Bounds of the active page view in window-content coordinates. */
  private pageBounds(): Rectangle {
    const { width, height } = this.window.getContentBounds()
    const gap = this.pageShape.inset
    const x = Math.round(this.insets.left + gap)
    const y = Math.round(this.insets.top + gap)
    return {
      x,
      y,
      width: Math.max(0, Math.round(width - this.insets.left - this.insets.right - gap * 2)),
      height: Math.max(0, Math.round(height - this.insets.top - this.insets.bottom - gap * 2))
    }
  }

  private layout(): void {
    const { width, height } = this.window.getContentBounds()
    this.chromeView.setBounds({ x: 0, y: 0, width, height })

    const bounds = this.pageBounds()
    for (const [tabId, view] of this.pageViews) {
      view.setBounds(bounds)
      setBorderRadius(view, this.pageShape.radius)
      view.setVisible(tabId === this.activeTabId)
    }
  }

  /**
   * Re-adds views in the order we want. `addChildView` moves an existing child
   * to the top of the stack, so this is how z-order is expressed.
   */
  private applyStacking(): void {
    const active = this.activeTabId ? this.pageViews.get(this.activeTabId) : undefined
    if (this.overlayActive) {
      if (active) this.window.contentView.addChildView(active)
      this.window.contentView.addChildView(this.chromeView)
    } else {
      this.window.contentView.addChildView(this.chromeView)
      if (active) this.window.contentView.addChildView(active)
    }
  }

  /* -------------------------------------------------------- page views */

  hasView(tabId: string): boolean {
    return this.pageViews.has(tabId)
  }

  /** Creates the WebContentsView for a tab and wires its lifecycle events. */
  createView(tabId: string, url: string): WebContentsView {
    const existing = this.pageViews.get(tabId)
    if (existing) return existing

    const view = new WebContentsView({
      webPreferences: {
        preload: join(this.preloadDir, 'page.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        partition: PARTITION,
        // Web content is untrusted; keep every escape hatch shut.
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        safeDialogs: true
      }
    })

    const { webContents } = view
    webContents.on('page-title-updated', (_event, title) => this.callbacks.onTitle(tabId, title))
    webContents.on('page-favicon-updated', (_event, favicons) =>
      this.callbacks.onFavicon(tabId, favicons[0] ?? null)
    )
    webContents.on('did-start-loading', () => this.callbacks.onLoading(tabId, true))
    webContents.on('did-stop-loading', () => this.callbacks.onLoading(tabId, false))

    const reportNavigation = (): void => {
      this.callbacks.onNavigate(
        tabId,
        webContents.getURL(),
        webContents.navigationHistory.canGoBack(),
        webContents.navigationHistory.canGoForward()
      )
    }
    webContents.on('did-navigate', reportNavigation)
    webContents.on('did-navigate-in-page', reportNavigation)

    // target=_blank and window.open become Radius tabs rather than popups.
    webContents.setWindowOpenHandler(({ url: target, disposition }) => {
      this.callbacks.onOpenUrl(target, disposition === 'background-tab')
      return { action: 'deny' }
    })

    // Anything that is not http(s) is handed to the OS instead of loaded.
    webContents.on('will-navigate', (event, target) => {
      if (!isWebUrl(target)) {
        event.preventDefault()
        void shell.openExternal(target)
      }
    })

    this.pageViews.set(tabId, view)
    this.window.contentView.addChildView(view)
    view.setBounds(this.pageBounds())
    setBorderRadius(view, this.pageShape.radius)
    view.setVisible(false)

    if (url) void webContents.loadURL(url).catch(() => undefined)
    this.applyStacking()
    return view
  }

  getView(tabId: string): WebContentsView | undefined {
    return this.pageViews.get(tabId)
  }

  destroyView(tabId: string): void {
    const view = this.pageViews.get(tabId)
    if (!view) return
    this.pageViews.delete(tabId)
    this.window.contentView.removeChildView(view)
    // `close()` tears down the renderer process behind the view.
    view.webContents.close()
    if (this.activeTabId === tabId) this.activeTabId = null
  }

  setActiveTab(tabId: string | null): void {
    this.activeTabId = tabId
    for (const [id, view] of this.pageViews) {
      view.setVisible(id === tabId)
    }
    this.applyStacking()
    this.layout()
  }

  getActiveTabId(): string | null {
    return this.activeTabId
  }

  listViewTabIds(): string[] {
    return [...this.pageViews.keys()]
  }

  destroy(): void {
    for (const tabId of [...this.pageViews.keys()]) this.destroyView(tabId)
    this.window.destroy()
  }
}

/** `View.setBorderRadius` is recent; degrade to square corners if absent. */
function setBorderRadius(view: WebContentsView, radius: number): void {
  const candidate = view as unknown as { setBorderRadius?: (value: number) => void }
  if (typeof candidate.setBorderRadius === 'function') candidate.setBorderRadius(radius)
}

export function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

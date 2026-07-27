/**
 * Stub bridge for the renderer smoke test.
 *
 * Stands in for src/preload/chrome.ts so the chrome can be booted without the
 * main process, its SQLite database, or any provider. It answers the handful of
 * channels the renderer calls during startup with fixed data.
 */
const { contextBridge } = require('electron')

const WORKSPACE_ID = 'ws-1'

const tab = (id, title, url, extra = {}) => ({
  id,
  workspaceId: WORKSPACE_ID,
  groupId: null,
  url,
  title,
  faviconUrl: null,
  pinned: false,
  suspended: false,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  order: 0,
  lastActiveAt: 0,
  inAiContext: false,
  ...extra
})

const STATE = {
  workspaces: [
    {
      id: WORKSPACE_ID,
      name: 'Personal',
      icon: '◎',
      accent: 'oklch(0.70 0.17 285)',
      order: 0,
      themeId: null,
      createdAt: 0
    },
    {
      id: 'ws-2',
      name: 'Research',
      icon: '◈',
      accent: 'oklch(0.74 0.15 175)',
      order: 1,
      themeId: null,
      createdAt: 0
    }
  ],
  activeWorkspaceId: WORKSPACE_ID,
  groups: [
    {
      id: 'g-1',
      workspaceId: WORKSPACE_ID,
      title: 'Reading',
      color: 'green',
      collapsed: false,
      order: 0
    }
  ],
  tabs: [
    tab('t-0', 'Pinned docs', 'https://docs.example.com', { pinned: true, order: 0 }),
    tab('t-1', 'Radius architecture', 'https://radius.example/architecture', { order: 1 }),
    tab('t-2', 'A grouped article', 'https://news.example/story', { groupId: 'g-1', order: 2 }),
    tab('t-3', 'Another grouped tab', 'https://blog.example/post', {
      groupId: 'g-1',
      order: 3,
      suspended: true
    }),
    tab('t-4', 'Loading something', 'https://slow.example', { order: 4, loading: true })
  ],
  activeTabIdByWorkspace: { [WORKSPACE_ID]: 't-1' },
  bookmarks: [
    {
      id: 'b-1',
      folderId: null,
      url: 'https://example.com',
      title: 'Example',
      faviconUrl: null,
      tags: ['reference'],
      note: '',
      order: 0,
      createdAt: 0
    }
  ],
  bookmarkFolders: [],
  history: [
    {
      id: 'h-1',
      url: 'https://example.com/article',
      title: 'An article read earlier',
      faviconUrl: null,
      visitedAt: Date.now() - 3_600_000,
      visitCount: 3
    }
  ],
  downloads: [
    {
      id: 'd-1',
      url: 'https://files.example/report.pdf',
      filename: 'report.pdf',
      savePath: '/tmp/report.pdf',
      state: 'progressing',
      receivedBytes: 512_000,
      totalBytes: 2_048_000,
      startedAt: Date.now() - 20_000,
      completedAt: null
    }
  ],
  providers: [],
  settings: { searchEngineId: 'duckduckgo' }
}

const RESPONSES = {
  'state:get': STATE,
  'settings:get': STATE.settings,
  'ai:listProviders': [],
  'ai:usage': [],
  'history:search': [],
  // Empty on purpose: the editor must fall back to its defaults.
  'keybindings:get': {},
  // An empty document: ThemeProvider re-parses it, so this exercises the
  // schema's defaulting path all the way to the CSS variables.
  'theme:get': { theme: {}, presets: [] }
}

contextBridge.exposeInMainWorld('radius', {
  invoke: (channel) => Promise.resolve(RESPONSES[channel] ?? { ok: true }),
  on: () => () => {},
  platform: process.platform
})

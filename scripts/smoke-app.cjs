/**
 * End-to-end smoke test: boots the real application.
 *
 * Unlike `smoke-renderer.cjs`, which stubs the bridge, this requires the actual
 * built main bundle -- the same code path `npm run dev` takes. It gets the real
 * JsonStore, the real tab engine, real IPC. It then reaches into Electron to
 * screenshot the chrome and assert the window came up.
 *
 *   xvfb-run -a npx electron --no-sandbox scripts/smoke-app.cjs out.png
 *
 * Nothing here is imported by the app; the app has no idea it is being tested.
 */
const { app, BaseWindow, webContents } = require('electron')
const { createServer } = require('node:http')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

/**
 * A local page to navigate to. Using a real HTTP server (rather than a data:
 * URL) means the navigation goes through the same path a website would --
 * will-navigate, history recording, the page preload, find-in-page.
 */
const PAGE_HTML = `<!doctype html><html><head><title>Radius Test Page</title></head>
<body><main><h1>Hello from a real page</h1>
<p>The word marmalade appears here. And marmalade again, twice.</p>
<p>Some further body text so extraction has something to find.</p>
<input id="field" placeholder="Type here" style="font-size:16px;padding:8px;width:260px">
<button id="go" style="font-size:16px;padding:8px 16px" onclick="document.title='Clicked by the agent'">Press me</button>
</main></body></html>`

let server
function startServer() {
  return new Promise((resolve) => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(PAGE_HTML)
    })
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

const OUTPUT =
  process.argv.slice(1).find((arg) => arg.endsWith('.png')) ?? join(__dirname, '..', 'smoke-app.png')

// Point the app at a scratch profile so a test run never touches real state.
const profile = mkdtempSync(join(tmpdir(), 'radius-smoke-'))
app.setPath('userData', profile)

const failures = []
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`)
    failures.push(label)
  }
}

const consoleErrors = []

const watchdog = setTimeout(() => {
  console.log('  FAIL  timed out after 90s')
  console.log('RESULT: timeout\n')
  app.exit(1)
}, 90_000)

// Boot the real application.
require('../out/main/index.js')

app.whenReady().then(() => run().catch((error) => {
  console.log(`  FAIL  smoke script threw -- ${error && error.message ? error.message : error}`)
  failures.push('script error')
  finish()
}))

async function run() {
  // Give bootstrap time to open the window, load the chrome and restore a tab.
  await new Promise((resolve) => setTimeout(resolve, 6000))

  const windows = BaseWindow.getAllWindows()
  check('the app opened a window', windows.length === 1, `saw ${windows.length}`)

  const allContents = webContents.getAllWebContents()
  const chrome = allContents.find((contents) => contents.getURL().includes('renderer/index.html'))
  check('the chrome loaded', Boolean(chrome), allContents.map((c) => c.getURL()).join(' | '))
  if (!chrome) return finish()

  chrome.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(String(event.message))
  })

  const probe = await chrome.executeJavaScript(`(() => {
    const root = document.documentElement
    const read = (name) => getComputedStyle(root).getPropertyValue(name).trim()
    return {
      mounted: Boolean(document.querySelector('.rx-shell')),
      tabCount: document.querySelectorAll('.rx-tab').length,
      workspaceChips: document.querySelectorAll('.rx-workspace-chip').length,
      omnibox: Boolean(document.querySelector('.rx-omnibox-input')),
      toolbarButtons: document.querySelectorAll('.rx-toolbar .rx-icon-button').length,
      accent: read('--rx-color-accent'),
      backdrop: (() => {
        const surface = document.querySelector('.rx-glass[data-surface="chrome"]')
        return surface ? getComputedStyle(surface).backdropFilter : null
      })()
    }
  })()`)

  console.log('\nRadius end-to-end smoke test')
  console.log('----------------------------')
  check('React mounted against the real main process', probe.mounted)
  check('the restored session produced a tab', probe.tabCount >= 1, `saw ${probe.tabCount}`)
  check('the seeded workspace rendered', probe.workspaceChips >= 2, `saw ${probe.workspaceChips}`)
  check('omnibox present', probe.omnibox)
  check(
    'toolbar rendered its controls',
    probe.toolbarButtons >= 10,
    `saw ${probe.toolbarButtons}`
  )
  check('theme tokens applied', String(probe.accent).startsWith('oklch'), probe.accent)
  check(
    'glass resolved to a real backdrop-filter',
    typeof probe.backdrop === 'string' && probe.backdrop.includes('blur'),
    String(probe.backdrop)
  )

  // Exercise a couple of the new IPC paths through the real handlers.
  const history = await chrome.executeJavaScript(
    `window.radius.invoke('history:search', { query: '' }).then((r) => r.length)`
  )
  check('history search answered over real IPC', typeof history === 'number', String(history))

  const bindings = await chrome.executeJavaScript(
    `window.radius.invoke('keybindings:get', {}).then((b) => Object.keys(b).length)`
  )
  check('keybindings loaded from the real store', bindings > 20, String(bindings))

  const zoom = await chrome.executeJavaScript(`(async () => {
    const state = await window.radius.invoke('state:get', {})
    const tab = state.tabs[0]
    if (!tab) return null
    const result = await window.radius.invoke('zoom:step', { tabId: tab.id, direction: 'in' })
    return result.factor
  })()`)
  check('zoom stepped through the real tab engine', zoom === 1.1, String(zoom))

  /* ------------------------------------------------- real navigation */

  const port = await startServer()
  const navigated = await chrome.executeJavaScript(`(async () => {
    const state = await window.radius.invoke('state:get', {})
    const tab = state.tabs[0]
    await window.radius.invoke('tabs:navigate', { tabId: tab.id, url: 'http://127.0.0.1:${port}/' })
    return tab.id
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 3000))

  const afterNav = await chrome.executeJavaScript(
    `window.radius.invoke('state:get', {}).then((s) => ({
      title: s.tabs[0].title,
      url: s.tabs[0].url,
      history: s.history.length,
      historyTitle: s.history[0] ? s.history[0].title : null
    }))`
  )
  check('the page actually loaded', afterNav.url.startsWith('http://127.0.0.1'), afterNav.url)
  check('the tab picked up the page title', afterNav.title === 'Radius Test Page', afterNav.title)
  check('the visit was recorded in history', afterNav.history >= 1, String(afterNav.history))
  check(
    'history picked up the late-arriving title',
    afterNav.historyTitle === 'Radius Test Page',
    String(afterNav.historyTitle)
  )

  /* ---------------------------------------------------- page context */

  const context = await chrome.executeJavaScript(
    `window.radius.invoke('page:getContext', { tabId: ${JSON.stringify(navigated)} })`
  )
  check(
    'the page preload extracted readable text',
    context.text.includes('marmalade'),
    JSON.stringify(context.text).slice(0, 120)
  )

  /* ------------------------------------------------------ find in page */

  const findResult = await chrome.executeJavaScript(`(() => new Promise((resolve) => {
    const off = window.radius.on('find:result', (payload) => { off(); resolve(payload) })
    window.radius.invoke('find:start', {
      tabId: ${JSON.stringify(navigated)},
      query: 'marmalade',
      forward: true,
      findNext: true,
      matchCase: false
    })
    setTimeout(() => resolve(null), 5000)
  }))()`)
  check(
    'find in page counted the matches',
    findResult && findResult.matches === 2,
    JSON.stringify(findResult)
  )

  /* ---------------------------------------------------- agent control */

  const pageContents = webContents
    .getAllWebContents()
    .find((contents) => contents.getURL().startsWith('http://127.0.0.1'))
  check('found the page webContents', Boolean(pageContents))

  await chrome.executeJavaScript(
    `window.radius.invoke('agent:begin', { tabId: ${JSON.stringify(navigated)}, label: 'Assistant', accent: 'oklch(0.70 0.17 285)' })`
  )
  await new Promise((resolve) => setTimeout(resolve, 400))

  const cursorPresent = await pageContents.executeJavaScript(
    `(() => { const h = document.querySelector('[data-radius-agent]'); return h ? h.dataset.visible : null })()`
  )
  check('the agent cursor appeared in the page', cursorPresent === 'true', String(cursorPresent))

  const map = await chrome.executeJavaScript(
    `window.radius.invoke('agent:describe', { tabId: ${JSON.stringify(navigated)} })`
  )
  const buttonIndex = map.elements.findIndex((el) => el.label === 'Press me')
  const fieldIndex = map.elements.findIndex((el) => el.tag === 'input')
  check(
    'the agent sees the page elements',
    buttonIndex !== -1 && fieldIndex !== -1,
    JSON.stringify(map.elements.map((e) => e.label))
  )

  // Typing: click the field, then send characters as a person would.
  const typed = await chrome.executeJavaScript(
    `window.radius.invoke('agent:act', { tabId: ${JSON.stringify(navigated)}, action: { kind: 'type', text: 'hello agent', index: ${fieldIndex} } })`
  )
  check('the type action reported success', typed.ok, typed.detail)
  const fieldValue = await pageContents.executeJavaScript(`document.getElementById('field').value`)
  check('the keyboard actually typed into the page', fieldValue === 'hello agent', String(fieldValue))

  // Clicking: the button rewrites document.title, so the effect is observable.
  const clicked = await chrome.executeJavaScript(
    `window.radius.invoke('agent:act', { tabId: ${JSON.stringify(navigated)}, action: { kind: 'click', index: ${buttonIndex} } })`
  )
  check('the click action reported success', clicked.ok, clicked.detail)
  const newTitle = await pageContents.executeJavaScript(`document.title`)
  check('the mouse actually clicked the button', newTitle === 'Clicked by the agent', newTitle)

  const cursorMoved = await pageContents.executeJavaScript(
    `(() => { const h = document.querySelector('[data-radius-agent]'); return { x: Number(h.dataset.x), y: Number(h.dataset.y) } })()`
  )
  check(
    'the cursor moved to what it clicked',
    cursorMoved.x > 0 && cursorMoved.y > 0,
    JSON.stringify(cursorMoved)
  )

  // Capture the page itself, cursor and all, before hiding it again.
  const pageShot = await pageContents.capturePage()
  writeFileSync(OUTPUT.replace(/\.png$/, '-agent.png'), pageShot.toPNG())

  await chrome.executeJavaScript(
    `window.radius.invoke('agent:stop', { tabId: ${JSON.stringify(navigated)} })`
  )
  await new Promise((resolve) => setTimeout(resolve, 300))
  const cursorHidden = await pageContents.executeJavaScript(
    `document.querySelector('[data-radius-agent]').dataset.visible`
  )
  check('stopping hides the cursor', cursorHidden === 'false', String(cursorHidden))

  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.join(' | '))

  const image = await chrome.capturePage()
  writeFileSync(OUTPUT, image.toPNG())
  console.log(`\nscreenshot: ${OUTPUT}`)

  finish()
}

function finish() {
  clearTimeout(watchdog)
  server?.close()
  console.log(failures.length === 0 ? 'RESULT: pass\n' : `RESULT: ${failures.length} failed\n`)
  app.exit(failures.length === 0 ? 0 : 1)
}

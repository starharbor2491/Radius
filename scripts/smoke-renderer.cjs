/**
 * Renderer smoke test.
 *
 * Boots the built chrome bundle inside a real Electron BaseWindow +
 * WebContentsView with a stubbed bridge, then asserts that React mounted, the
 * theme tokens reached `:root`, and the glass surfaces resolved to an actual
 * backdrop filter. Writes a screenshot alongside the assertions so a failure is
 * inspectable rather than just a count.
 *
 *   xvfb-run -a npx electron --no-sandbox scripts/smoke-renderer.cjs out.png
 *
 * This deliberately does not touch SQLite or any provider: it covers the half
 * of the app that runs without a native module built for Electron's ABI.
 */
const { app, BaseWindow, WebContentsView } = require('electron')
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')

// Electron rewrites argv (its own switches, the script path), so pick the
// output by extension rather than by position -- indexing it wrongly once meant
// the screenshot was written over this very file.
const OUTPUT =
  process.argv.slice(1).find((arg) => arg.endsWith('.png')) ?? join(__dirname, '..', 'smoke.png')
const ENTRY = join(__dirname, '..', 'out', 'renderer', 'index.html')

const failures = []
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`)
    failures.push(label)
  }
}

app.disableHardwareAcceleration()

// Hard watchdog: a hung load or capture must fail the run, not wedge the shell.
const watchdog = setTimeout(() => {
  console.log('  FAIL  timed out after 60s')
  console.log('RESULT: timeout\n')
  app.exit(1)
}, 60_000)

app.whenReady().then(async () => {
  // capturePage on an unshown window can block indefinitely; under xvfb showing
  // it is still headless.
  const window = new BaseWindow({ width: 1280, height: 800, show: true, frame: false })
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, 'smoke-preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  window.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 1280, height: 800 })

  const consoleErrors = []
  view.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      consoleErrors.push(String(event.message))
    }
  })

  await view.webContents.loadFile(ENTRY)
  // Give React a few frames to mount and the theme effect to run.
  await new Promise((resolve) => setTimeout(resolve, 1500))

  // Open a panel if asked, so a screenshot can show more than the default view.
  const panel = process.argv.find((arg) => arg.startsWith('--panel='))
  if (panel) {
    await view.webContents.executeJavaScript(
      `document.querySelector('[aria-label="${panel.slice(8)}"]')?.click(); true`
    )
    await new Promise((resolve) => setTimeout(resolve, 900))
  }

  const probe = await view.webContents.executeJavaScript(`(() => {
    const root = document.documentElement
    const read = (name) => getComputedStyle(root).getPropertyValue(name).trim()
    const chrome = document.querySelector('.rx-glass[data-surface="chrome"]')
    return {
      mounted: Boolean(document.querySelector('.rx-shell')),
      tabCount: document.querySelectorAll('.rx-tab').length,
      groupCount: document.querySelectorAll('.rx-group').length,
      workspaceChips: document.querySelectorAll('.rx-workspace-chip').length,
      omnibox: Boolean(document.querySelector('.rx-omnibox-input')),
      accent: read('--rx-color-accent'),
      radius: read('--rx-radius-md'),
      spring: read('--rx-spring-tabDrag-stiffness'),
      scheme: root.dataset.scheme,
      computedBackdrop: chrome ? getComputedStyle(chrome).backdropFilter : null
    }
  })()`)

  console.log('\nRadius renderer smoke test')
  console.log('--------------------------')
  check('React mounted the shell', probe.mounted)
  check('tab strip rendered rows', probe.tabCount >= 4, `saw ${probe.tabCount}`)
  check('group block rendered', probe.groupCount === 1, `saw ${probe.groupCount}`)
  check('workspace rail rendered', probe.workspaceChips >= 3, `saw ${probe.workspaceChips}`)
  check('omnibox present', probe.omnibox)
  check('theme tokens on :root', probe.accent.startsWith('oklch'), probe.accent)
  check('geometry token resolved', probe.radius === '10px', probe.radius)
  check('spring token resolved', Number(probe.spring) > 0, probe.spring)
  check('scheme attribute set', probe.scheme === 'dark', String(probe.scheme))
  check(
    'glass resolved to a real backdrop-filter',
    typeof probe.computedBackdrop === 'string' && probe.computedBackdrop.includes('blur'),
    String(probe.computedBackdrop)
  )
  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.join(' | '))

  const image = await view.webContents.capturePage()
  writeFileSync(OUTPUT, image.toPNG())
  clearTimeout(watchdog)

  console.log(`\nscreenshot: ${OUTPUT}`)
  console.log(failures.length === 0 ? 'RESULT: pass\n' : `RESULT: ${failures.length} failed\n`)
  app.exit(failures.length === 0 ? 0 : 1)
})

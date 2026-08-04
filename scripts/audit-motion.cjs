/**
 * Frame-rate audit for the motion pass.
 *
 *   npm run audit:motion
 *
 * Nothing here is imported by the app.
 *
 * Boots the real app, loads it up with tabs and groups, then drives each
 * animation while sampling `requestAnimationFrame` deltas in the chrome. It
 * reports the worst frame and the share of frames over budget, because a mean
 * of 60fps with one 200ms stall is a janky UI that averages fine.
 *
 * Runs the whole suite twice: once with motion on, once with it off. The second
 * pass is the one that proves "motion off" actually stops things rather than
 * merely shortening them -- a disabled animation should produce no frames at
 * all beyond the ones React needs to re-render.
 */
const { app, webContents } = require('electron')
const { createServer } = require('node:http')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

app.setPath('userData', mkdtempSync(join(tmpdir(), 'radius-fps-')))

const PAGE = `<!doctype html><html><head><title>Sample</title></head>
<body style="font:16px system-ui;padding:40px"><h1>Sample page</h1>
<p>Body text for extraction.</p></body></html>`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function serve() {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGE)
    })
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

const failures = []
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/** Installs a sampler in the chrome that records rAF deltas while armed. */
const SAMPLER = `
window.__fps = {
  frames: [],
  running: false,
  start() {
    this.frames = []
    this.running = true
    let last = performance.now()
    const tick = (now) => {
      if (!this.running) return
      this.frames.push(now - last)
      last = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  },
  stop() {
    this.running = false
    const f = this.frames.slice(1)
    if (f.length === 0) return { count: 0, worst: 0, overBudget: 0 }
    const sorted = [...f].sort((a, b) => a - b)
    return {
      count: f.length,
      worst: Math.round(Math.max(...f) * 10) / 10,
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
      overBudget: f.filter((d) => d > 16.7).length
    }
  }
}
true
`

async function main() {
  const port = await serve()
  await sleep(6000)
  const chrome = webContents.getAllWebContents().find((c) => c.getURL().includes('index.html'))
  if (!chrome) throw new Error('no chrome')

  const js = (source) => chrome.executeJavaScript(source)
  await js(SAMPLER)

  // Load it up: animation cost scales with what is on screen.
  await js(`(async () => {
    for (let i = 0; i < 12; i += 1) {
      await window.radius.invoke('tabs:create', { url: 'http://127.0.0.1:${port}/' })
    }
    const s = await window.radius.invoke('state:get', {})
    const mine = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    const g = await window.radius.invoke('groups:create', {
      workspaceId: s.activeWorkspaceId, title: 'Research', color: 'violet',
      tabIds: mine.slice(0, 4).map((t) => t.id)
    })
    await window.radius.invoke('workspaces:create', { name: 'Second' })
    return { tabs: mine.length, group: g.id }
  })()`)
  await sleep(2500)

  /** Runs one scenario and returns its frame stats. */
  async function measure(name, drive, settle = 1400) {
    await js(`window.__fps.start()`)
    await drive()
    await sleep(settle)
    const stats = await js(`window.__fps.stop()`)
    console.log(`     ${name}: ${stats.count} frames, worst ${stats.worst}ms, p95 ${stats.p95}ms, ${stats.overBudget} over 16.7ms`)
    return stats
  }

  /** This machine's idle frame interval, with nothing animating. */
  await js(`window.__fps.start()`)
  await sleep(1500)
  const baseline = await js(`window.__fps.stop()`)
  const floor = Math.max(16.7, baseline.p95)
  console.log(`  baseline (idle): p95 ${baseline.p95}ms over ${baseline.count} frames`)
  console.log('  Absolute times are meaningless under software rendering; the')
  console.log('  budget below is a multiple of this machine\'s own floor.\n')

  let worstWithMotion = 0
  let worstWithoutMotion = 0

  const scenarios = [
    [
      'hovering every tab in turn',
      async () => {
        await js(`(async () => {
          const rows = [...document.querySelectorAll('.rx-tab')]
          for (const row of rows) {
            row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
            row.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
            await new Promise((r) => setTimeout(r, 60))
            row.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
          }
          return rows.length
        })()`)
      }
    ],
    [
      'opening the command palette',
      async () => {
        await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`)
        await sleep(900)
        await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      }
    ],
    [
      'switching workspace and back',
      async () => {
        await js(`(async () => {
          const s = await window.radius.invoke('state:get', {})
          const other = s.workspaces.find((w) => w.id !== s.activeWorkspaceId)
          await window.radius.invoke('workspaces:activate', { workspaceId: other.id })
          await new Promise((r) => setTimeout(r, 700))
          await window.radius.invoke('workspaces:activate', { workspaceId: s.activeWorkspaceId })
          return true
        })()`)
      },
      2000
    ],
    [
      'pressing every toolbar button',
      async () => {
        await js(`(async () => {
          const buttons = [...document.querySelectorAll('.rx-toolbar .rx-icon-button')]
          for (const b of buttons) {
            const r = b.getBoundingClientRect()
            b.dispatchEvent(new PointerEvent('pointerdown', {
              bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
            }))
            await new Promise((res) => setTimeout(res, 70))
          }
          return buttons.length
        })()`)
      }
    ]
  ]

  for (const motionOn of [true, false]) {
    console.log(`\n  motion ${motionOn ? 'on' : 'off'}`)
    // There is no partial theme channel; read, patch, write the whole document.
    await js(`(async () => {
      const theme = await window.radius.invoke('theme:get', {})
      const next = { ...theme.theme ?? theme, motion: { ...(theme.theme ?? theme).motion, enabled: ${motionOn} } }
      await window.radius.invoke('theme:set', { theme: next })
      return true
    })()`)
    await sleep(800)

    let worstOverall = 0
    let overBudgetTotal = 0
    for (const [name, drive, settle] of scenarios) {
      const stats = await measure(name, drive, settle)
      worstOverall = Math.max(worstOverall, stats.worst)
      overBudgetTotal += stats.overBudget
    }

    // Recorded, not asserted: with the default glass these numbers are
    // dominated by compositing a 48px backdrop blur in software, which is an
    // artefact of a headless session with no GPU rather than anything the
    // chrome is doing wrong. The attributable measurement is the flat-glass run
    // below.
    console.log(`     worst frame, default glass, motion ${motionOn ? 'on' : 'off'}: ${worstOverall}ms (${overBudgetTotal} frames over budget)`)
    if (motionOn) worstWithMotion = worstOverall
    else worstWithoutMotion = worstOverall
  }

  /*
   * Does motion-off actually stop things, or just shorten them?
   *
   * Counting frames cannot answer this: the sampler is itself a rAF loop, so it
   * produces frames whether or not anything is animating. `getAnimations()`
   * reports what the document is genuinely playing, which is the real question.
   */
  console.log('\n  with glass blur removed (isolating backdrop-filter cost)')
  await js(`(async () => {
    const { theme } = await window.radius.invoke('theme:get', {})
    const flat = { ...theme.glass }
    for (const k of Object.keys(flat)) flat[k] = { ...flat[k], blur: 0, mode: 'solid' }
    await window.radius.invoke('theme:set', {
      theme: { ...theme, glass: flat, motion: { ...theme.motion, enabled: true } }
    })
    return true
  })()`)
  await sleep(900)
  let flatWorst = 0
  for (const [name, drive, settle] of scenarios) {
    const stats = await measure(name, drive, settle)
    flatWorst = Math.max(flatWorst, stats.worst)
  }
  console.log(`     worst frame without glass: ${flatWorst}ms`)

  /*
   * The real budget.
   *
   * With the glass flattened, what is left is the motion pass plus React. That
   * is the part this milestone is responsible for and the part that has to hold
   * up. Eight frames is generous, but a stall a user would notice is what we
   * are hunting, not a missed frame at the start of a spring.
   */
  check(
    `motion holds up with glass flattened (under ${Math.round(floor * 8)}ms)`,
    flatWorst <= floor * 8,
    `worst ${flatWorst}ms, idle floor ${floor}ms`
  )
  /*
   * Reported, not asserted.
   *
   * These three numbers come from three separate passes over the same
   * scenarios, and on a software-rendered machine the same scenario varies by
   * around 100ms run to run. A strict inequality between two of them is a coin
   * flip, not a test -- it failed once with flat glass measuring *worse* than
   * glass, which says nothing about either. The assertion that holds is the
   * absolute one above; this is here to be read.
   */
  console.log(
    `\n  worst frame -- glass+motion ${worstWithMotion}ms · glass only ${worstWithoutMotion}ms · ` +
      `motion only ${flatWorst}ms · idle floor ${floor}ms`
  )
  console.log('  A large gap between the first and the last is the glass, not the motion.')

  // Back to motion off for the stillness check.
  await js(`(async () => {
    const { theme } = await window.radius.invoke('theme:get', {})
    await window.radius.invoke('theme:set', {
      theme: { ...theme, motion: { ...theme.motion, enabled: false } }
    })
    return true
  })()`)
  await sleep(900)

  const playing = await js(`document
    .getAnimations()
    .filter((a) => a.playState === 'running')
    .map((a) => (a.effect && a.effect.target && a.effect.target.className) || 'unknown')`)
  console.log(`     running animations with motion off: ${JSON.stringify(playing)}`)
  check(
    'nothing is animating while idle with motion off',
    playing.length === 0,
    playing.join(', ')
  )

  const errors = await js(`(window.__radiusErrors || []).length`)
  check('no renderer console errors', errors === 0, String(errors))

  console.log(`\nRESULT: ${failures.length === 0 ? 'pass' : 'fail'}\n`)
}

require('../out/main/index.js')
app.whenReady().then(() =>
  main()
    .catch((e) => {
      console.log('  FAIL  script threw --', e && e.message)
      failures.push('script')
    })
    .finally(() => app.exit(failures.length === 0 ? 0 : 1))
)

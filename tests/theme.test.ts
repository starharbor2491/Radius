import { describe, expect, it } from 'vitest'
import {
  applyThemeOverride,
  auditThemeContrast,
  failingContrast,
  flattenThemeOverride,
  mergeThemeDocuments,
  parseTheme,
  parseThemeDocument,
  resolveThemeOverride,
  resolveThemeVars,
  sanitizeUserCss,
  themeOverrideDiff,
  themeToCss,
  THEME_SCHEMA_VERSION,
  withoutThemeOverridePath
} from '@shared/theme'
import { getPreset, THEME_PRESETS } from '@shared/theme-presets'

describe('parseTheme', () => {
  it('fills a complete theme from an empty document', () => {
    const theme = parseTheme({})
    expect(theme.version).toBe(THEME_SCHEMA_VERSION)
    expect(theme.colors.accent).toMatch(/^oklch/)
    expect(theme.glass.chrome.blur).toBeGreaterThan(0)
    expect(theme.motion.springs.tabDrag.stiffness).toBeGreaterThan(0)
    expect(theme.elevation.level5).toContain('oklch')
  })

  it('keeps a partial override and defaults everything else', () => {
    // This is the property that lets a user ship a three-line theme file.
    const theme = parseTheme({ colors: { accent: 'oklch(0.8 0.2 30)' } })
    expect(theme.colors.accent).toBe('oklch(0.8 0.2 30)')
    expect(theme.colors.bg).toBe(parseTheme({}).colors.bg)
    expect(theme.glass.popover.blur).toBe(parseTheme({}).glass.popover.blur)
  })

  it('defaults a nested glass surface that names only one token', () => {
    const theme = parseTheme({ glass: { chrome: { blur: 4 } } })
    expect(theme.glass.chrome.blur).toBe(4)
    expect(theme.glass.chrome.saturation).toBe(parseTheme({}).glass.chrome.saturation)
    expect(theme.glass.panel.blur).toBe(parseTheme({}).glass.panel.blur)
  })

  it('rejects tokens outside their allowed range', () => {
    expect(() => parseTheme({ glass: { chrome: { blur: 5000 } } })).toThrow()
    expect(() => parseTheme({ motion: { scale: -1 } })).toThrow()
  })
})

describe('resolveThemeVars', () => {
  it('emits the custom properties the stylesheet depends on', () => {
    const vars = resolveThemeVars(parseTheme({}))
    for (const name of [
      '--rx-color-bg',
      '--rx-color-accent',
      '--rx-glass-chrome-backdrop',
      '--rx-glass-popover-bg',
      '--rx-radius-md',
      '--rx-space-4',
      '--rx-text-0',
      '--rx-duration-fast',
      '--rx-spring-tabDrag-stiffness',
      '--rx-color-group-violet',
      '--rx-color-scrim',
      '--rx-opacity-disabled'
    ]) {
      expect(vars[name], name).toBeDefined()
    }
  })

  it('composes the backdrop filter from blur, saturation and brightness', () => {
    const vars = resolveThemeVars(parseTheme({ glass: { chrome: { blur: 12, saturation: 2 } } }))
    expect(vars['--rx-glass-chrome-backdrop']).toBe('blur(12px) saturate(2) brightness(1)')
  })

  it('drops the blur entirely in solid mode', () => {
    const vars = resolveThemeVars(parseTheme({ glass: { chrome: { mode: 'solid', blur: 40 } } }))
    expect(vars['--rx-glass-chrome-backdrop']).toBe('none')
    // Solid surfaces must be opaque or the chrome would show the window through.
    expect(vars['--rx-glass-chrome-bg']).not.toContain('/')
  })

  it('collapses every duration to zero when motion is disabled', () => {
    const vars = resolveThemeVars(parseTheme({ motion: { enabled: false } }))
    expect(vars['--rx-motion-enabled']).toBe('0')
    expect(vars['--rx-duration-normal']).toBe('0ms')
    expect(vars['--rx-rubber-band']).toBe('0')
  })

  it('scales durations by the motion multiplier', () => {
    const base = resolveThemeVars(parseTheme({}))
    const slow = resolveThemeVars(parseTheme({ motion: { scale: 2 } }))
    expect(Number.parseInt(slow['--rx-duration-fast']!, 10)).toBe(
      Number.parseInt(base['--rx-duration-fast']!, 10) * 2
    )
  })

  it('lets a light theme dim with its own scrim rather than black', () => {
    // 28% black is a whisper over a dark window and a bruise over a light one.
    const light = getPreset('daylight')!
    expect(light.colors.scrim).not.toBe(parseTheme({}).colors.scrim)
    expect(resolveThemeVars(light)['--rx-color-scrim']).toBe(light.colors.scrim)
  })

  it('scales spacing with density', () => {
    const compact = resolveThemeVars(parseTheme({ geometry: { density: 'compact' } }))
    const comfortable = resolveThemeVars(parseTheme({ geometry: { density: 'comfortable' } }))
    expect(Number.parseInt(compact['--rx-space-4']!, 10)).toBeLessThan(
      Number.parseInt(comfortable['--rx-space-4']!, 10)
    )
  })
})

describe('themeToCss', () => {
  it('produces a :root block and appends user CSS verbatim', () => {
    const css = themeToCss(parseTheme({ userCss: '.rx-tab { color: red; }' }))
    expect(css.startsWith(':root {')).toBe(true)
    expect(css).toContain('--rx-color-accent:')
    expect(css.endsWith('.rx-tab { color: red; }')).toBe(true)
  })
})

describe('presets', () => {
  it('all parse into complete themes with unique ids', () => {
    const ids = THEME_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of THEME_PRESETS) {
      expect(preset.colors.accent).toMatch(/^oklch/)
      expect(() => resolveThemeVars(preset)).not.toThrow()
    }
  })

  it('exposes light and dark schemes', () => {
    expect(THEME_PRESETS.some((preset) => preset.colors.scheme === 'light')).toBe(true)
    expect(THEME_PRESETS.some((preset) => preset.colors.scheme === 'dark')).toBe(true)
  })

  it('ships a preset with no blur for low-power machines', () => {
    expect(getPreset('carbon')!.glass.chrome.mode).toBe('solid')
  })

  it('is a set of different designs rather than one design recoloured', () => {
    // Six recolours of one theme would all resolve to the same geometry and
    // motion. These are the axes that make a preset feel like another browser.
    const distinct = (values: unknown[]): number => new Set(values.map(String)).size
    expect(distinct(THEME_PRESETS.map((p) => p.geometry.density))).toBe(3)
    expect(distinct(THEME_PRESETS.map((p) => p.geometry.radiusMd))).toBeGreaterThanOrEqual(5)
    expect(distinct(THEME_PRESETS.map((p) => p.glass.chrome.mode))).toBeGreaterThanOrEqual(3)
    expect(distinct(THEME_PRESETS.map((p) => p.typography.fontSans))).toBeGreaterThanOrEqual(2)
    expect(distinct(THEME_PRESETS.map((p) => p.motion.scale))).toBeGreaterThanOrEqual(6)
    expect(THEME_PRESETS.filter((p) => p.colors.scheme === 'light').length).toBeGreaterThanOrEqual(3)
  })

  it('describes each preset without inventing an author', () => {
    for (const preset of THEME_PRESETS) {
      expect(preset.description.length, preset.id).toBeGreaterThan(10)
    }
  })
})

/* ------------------------------------------------------------------ *
 * Reading a document a human wrote
 * ------------------------------------------------------------------ */

describe('parseThemeDocument', () => {
  it('accepts a three-line file that sets two tokens', () => {
    const result = parseThemeDocument(
      JSON.parse('{\n  "name": "Two tokens",\n  "colors": { "accent": "oklch(0.8 0.2 30)" }\n}')
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.theme.colors.accent).toBe('oklch(0.8 0.2 30)')
    expect(result.theme.glass.popover.blur).toBe(parseTheme({}).glass.popover.blur)
    expect(result.theme.motion.springs.tabDrag.stiffness).toBeGreaterThan(0)
  })

  it('names the field that failed, not just "invalid"', () => {
    const result = parseThemeDocument({ glass: { chrome: { blur: 5000 } } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.path).toBe('glass.chrome.blur')
    expect(result.issues[0]!.message.length).toBeGreaterThan(0)
  })

  it('reports every bad field, not only the first', () => {
    const result = parseThemeDocument({
      colors: { scheme: 'sepia' },
      motion: { scale: -1 },
      geometry: { pageInset: 900 }
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.path).sort()).toEqual([
      'colors.scheme',
      'geometry.pageInset',
      'motion.scale'
    ])
  })

  it('reports a wrong-typed token at its own path', () => {
    const result = parseThemeDocument({ typography: { baseSize: 'large' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]!.path).toBe('typography.baseSize')
  })

  it('explains a document that is not an object at all', () => {
    for (const input of [null, 42, 'oklch(0.7 0.1 200)', ['colors']]) {
      const result = parseThemeDocument(input)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.issues[0]!.path).toBe('(document)')
      expect(result.issues[0]!.message).toContain('expected a JSON object')
    }
  })

  it('round-trips an exported theme', () => {
    const exported = JSON.parse(JSON.stringify(getPreset('vapor')))
    const result = parseThemeDocument(exported)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.theme).toEqual(getPreset('vapor'))
  })
})

/* ------------------------------------------------------------------ *
 * Partial documents: merging, diffing, workspace overrides
 * ------------------------------------------------------------------ */

describe('mergeThemeDocuments', () => {
  it('merges nested objects key by key without mutating either side', () => {
    const base = { colors: { accent: 'a', bg: 'b' }, motion: { scale: 1 } }
    const patch = { colors: { accent: 'z' } }
    const merged = mergeThemeDocuments(base, patch) as typeof base
    expect(merged).toEqual({ colors: { accent: 'z', bg: 'b' }, motion: { scale: 1 } })
    expect(base.colors.accent).toBe('a')
    expect(patch).toEqual({ colors: { accent: 'z' } })
  })

  it('replaces scalars and skips undefined', () => {
    expect(mergeThemeDocuments({ a: 1, b: 2 }, { a: 5, b: undefined })).toEqual({ a: 5, b: 2 })
  })
})

describe('workspace overrides', () => {
  const base = parseTheme({})

  it('merges any subset of the document over the base theme', () => {
    const merged = applyThemeOverride(base, {
      colors: { accent: 'oklch(0.7 0.2 30)' },
      geometry: { density: 'compact' },
      glass: { chrome: { blur: 4 } }
    })
    expect(merged.colors.accent).toBe('oklch(0.7 0.2 30)')
    expect(merged.geometry.density).toBe('compact')
    expect(merged.glass.chrome.blur).toBe(4)
    // Everything the override did not name still comes from the base.
    expect(merged.glass.chrome.saturation).toBe(base.glass.chrome.saturation)
    expect(merged.colors.bg).toBe(base.colors.bg)
  })

  it('leaves the base visible when the override is nonsense, and says why', () => {
    const result = resolveThemeOverride(base, { motion: { scale: 99 } })
    expect(result.theme).toEqual(base)
    expect(result.issues[0]!.path).toBe('motion.scale')
  })

  it('treats an empty or absent override as no override', () => {
    expect(resolveThemeOverride(base, {}).theme).toBe(base)
    expect(resolveThemeOverride(base, null).theme).toBe(base)
  })

  it('stores only the difference from the base', () => {
    const edited = parseTheme({ ...base, geometry: { ...base.geometry, density: 'comfortable' } })
    expect(themeOverrideDiff(base, edited)).toEqual({ geometry: { density: 'comfortable' } })
  })

  it('drops a token from the diff once it matches the base again', () => {
    const edited = { ...base, colors: { ...base.colors, accent: 'x' } }
    const reverted = { ...edited, colors: { ...edited.colors, accent: base.colors.accent } }
    expect(themeOverrideDiff(base, edited)).toEqual({ colors: { accent: 'x' } })
    expect(themeOverrideDiff(base, reverted)).toEqual({})
  })

  it('lists what an override changes, one leaf per row', () => {
    const leaves = flattenThemeOverride({
      colors: { accent: 'x' },
      glass: { chrome: { blur: 2, noise: 0 } }
    })
    expect(leaves).toEqual([
      { path: 'colors.accent', value: 'x' },
      { path: 'glass.chrome.blur', value: 2 },
      { path: 'glass.chrome.noise', value: 0 }
    ])
  })

  it('removes one token path and prunes the parent it emptied', () => {
    const override = { colors: { accent: 'x' }, glass: { chrome: { blur: 2 } } }
    expect(withoutThemeOverridePath(override, 'glass.chrome.blur')).toEqual({
      colors: { accent: 'x' }
    })
    expect(withoutThemeOverridePath(override, 'colors.accent')).toEqual({
      glass: { chrome: { blur: 2 } }
    })
    // Unknown paths are a no-op rather than a throw; the document is user data.
    expect(withoutThemeOverridePath(override, 'nope.nothing')).toEqual(override)
  })

  it('composes over a pinned preset as easily as over the global theme', () => {
    const pinned = getPreset('daylight')!
    const merged = applyThemeOverride(pinned, { geometry: { density: 'compact' } })
    expect(merged.colors.scheme).toBe('light')
    expect(merged.geometry.density).toBe('compact')
  })
})

/* ------------------------------------------------------------------ *
 * User CSS
 * ------------------------------------------------------------------ */

describe('sanitizeUserCss', () => {
  it('passes ordinary rules through untouched', () => {
    const css = '[data-radius-part="tab"] { text-transform: uppercase; }'
    expect(sanitizeUserCss(css)).toEqual({ css, warnings: [] })
  })

  it('removes @import and says so', () => {
    const result = sanitizeUserCss('@import url("https://cdn.example/x.css");\n.rx-tab { color: red; }')
    expect(result.css).not.toContain('@import')
    expect(result.css).toContain('.rx-tab')
    expect(result.warnings[0]).toContain('@import')
  })

  it('removes a remote url() but keeps a data: URI', () => {
    const remote = sanitizeUserCss('.a { background: url(https://example.com/x.png); }')
    expect(remote.css).not.toContain('example.com')
    expect(remote.warnings).toHaveLength(1)

    const inline = '.a { background: url(data:image/png;base64,AAAA); }'
    expect(sanitizeUserCss(inline)).toEqual({ css: inline, warnings: [] })
  })

  it('removes the legacy script-in-CSS vectors', () => {
    const result = sanitizeUserCss(
      '.a { width: expression(alert(1)); -moz-binding: url(x.xml); behavior: url(#default#time2); }'
    )
    expect(result.css).not.toContain('expression(')
    expect(result.css).not.toContain('-moz-binding')
    expect(result.css).not.toContain('behavior:')
    expect(result.warnings).toHaveLength(3)
  })

  it('never lets markup through, even though it is applied as text', () => {
    const result = sanitizeUserCss('</style><script>alert(1)</script>')
    expect(result.css).not.toContain('</style>')
    expect(result.warnings).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ *
 * Contrast
 * ------------------------------------------------------------------ */

describe('auditThemeContrast', () => {
  it('grades every pair the chrome actually renders', () => {
    const findings = auditThemeContrast(parseTheme({}))
    expect(findings.map((finding) => finding.id).sort()).toEqual([
      'accent-surface',
      'accent-text',
      'faint-surface',
      'muted-surface',
      'text-bg',
      'text-surface'
    ])
    for (const finding of findings) {
      expect(finding.ratio, finding.id).not.toBeNull()
      expect(finding.passes, `${finding.id} ${finding.ratio}`).toBe(true)
    }
  })

  it('fails a pair that misses AA, and keeps the number', () => {
    const theme = parseTheme({
      colors: { text: 'oklch(0.55 0.02 265)', surface1: 'oklch(0.50 0.02 265)' }
    })
    const finding = auditThemeContrast(theme).find((entry) => entry.id === 'text-surface')!
    expect(finding.passes).toBe(false)
    expect(finding.grade).toBe('fail')
    expect(finding.ratio).toBeLessThan(4.5)
    expect(finding.minimum).toBe(4.5)
    expect(finding.reason).toBe('body text')
  })

  it('holds hint text and non-text UI to 3:1 rather than 4.5:1', () => {
    const findings = auditThemeContrast(parseTheme({}))
    expect(findings.find((entry) => entry.id === 'faint-surface')!.minimum).toBe(3)
    expect(findings.find((entry) => entry.id === 'accent-surface')!.minimum).toBe(3)
  })

  it('says a colour is unmeasurable rather than guessing at it', () => {
    // Nothing corrects the value: a hex string is legal CSS and stays applied.
    const theme = parseTheme({ colors: { text: '#ff0000' } })
    const finding = auditThemeContrast(theme).find((entry) => entry.id === 'text-surface')!
    expect(finding.ratio).toBeNull()
    expect(finding.grade).toBeNull()
    expect(finding.passes).toBe(false)
  })

  it('does not correct a failing pair', () => {
    const theme = parseTheme({ colors: { text: 'oklch(0.30 0 0)', surface1: 'oklch(0.28 0 0)' } })
    expect(theme.colors.text).toBe('oklch(0.30 0 0)')
    expect(resolveThemeVars(theme)['--rx-color-text']).toBe('oklch(0.30 0 0)')
  })

  it('ships no preset that fails its own check', () => {
    for (const preset of THEME_PRESETS) {
      expect(failingContrast(preset).map((finding) => finding.id), preset.id).toEqual([])
    }
  })
})

describe('motion tokens', () => {
  it('emits a separate, much slower duration for looping animations', () => {
    const vars = resolveThemeVars(parseTheme({}))
    // A loop that runs at the one-shot "fast" duration is a strobe, not a hint.
    expect(Number.parseInt(vars['--rx-duration-pulse']!, 10)).toBeGreaterThan(
      Number.parseInt(vars['--rx-duration-normal']!, 10) * 4
    )
    expect(vars['--rx-duration-spin']).toBeTruthy()
    expect(vars['--rx-duration-shimmer']).toBeTruthy()
  })

  it('collapses every duration and every distance when motion is off', () => {
    const vars = resolveThemeVars(parseTheme({ motion: { enabled: false } }))

    // Durations: an animation that still has a duration has not been disabled.
    for (const [name, value] of Object.entries(vars)) {
      if (name.startsWith('--rx-duration-')) expect(value, name).toBe('0ms')
    }

    // Amounts: turning motion off has to mean nothing moves, not that it moves
    // the same distance instantly.
    expect(vars['--rx-hover-lift']).toBe('0px')
    expect(vars['--rx-press-scale']).toBe('1')
    expect(vars['--rx-ripple']).toBe('0')
    expect(vars['--rx-rubber-band']).toBe('0')
    expect(vars['--rx-stagger']).toBe('0s')
  })

  it('keeps the amounts when motion is on', () => {
    const vars = resolveThemeVars(
      parseTheme({ motion: { enabled: true, hoverLift: 3, pressScale: 0.9, ripple: 0.4 } })
    )
    expect(vars['--rx-hover-lift']).toBe('3px')
    expect(vars['--rx-press-scale']).toBe('0.9')
    expect(vars['--rx-ripple']).toBe('0.4')
  })

  it('scales loop durations with the speed multiplier like everything else', () => {
    const slow = resolveThemeVars(parseTheme({ motion: { scale: 2 } }))
    const base = resolveThemeVars(parseTheme({ motion: { scale: 1 } }))
    expect(Number.parseInt(slow['--rx-duration-pulse']!, 10)).toBe(
      Number.parseInt(base['--rx-duration-pulse']!, 10) * 2
    )
  })

  it('rejects a hover lift big enough to make the chrome jump', () => {
    // The schema bounds this: a 40px lift on a 28px control is not a hover.
    expect(() => parseTheme({ motion: { hoverLift: 40 } })).toThrow()
  })
})

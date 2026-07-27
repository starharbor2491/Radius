import { describe, expect, it } from 'vitest'
import { parseTheme, resolveThemeVars, themeToCss, THEME_SCHEMA_VERSION } from '@shared/theme'
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
      '--rx-color-group-violet'
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
})

import { z } from 'zod'
import { TAB_GROUP_COLORS } from './types'
import {
  checkContrast,
  formatOklch,
  parseOklch,
  withAlpha,
  AA_LARGE,
  AA_TEXT,
  type ContrastGrade
} from './color'

/**
 * The Radius token engine.
 *
 * One JSON document describes every visual and motion decision in the app. It
 * resolves to a flat map of CSS custom properties that the chrome renderer
 * writes onto `:root`, so changing any token repaints instantly with no
 * rebuild and no reload.
 *
 * Every leaf carries a default. That is deliberate: it means a user's
 * `.radius-theme.json` can contain three lines overriding three tokens and
 * still parse into a complete theme.
 */

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

const groupColorDefaults: Record<(typeof TAB_GROUP_COLORS)[number], string> = {
  slate: 'oklch(0.62 0.03 265)',
  blue: 'oklch(0.66 0.16 255)',
  cyan: 'oklch(0.72 0.12 210)',
  teal: 'oklch(0.70 0.11 180)',
  green: 'oklch(0.72 0.15 150)',
  amber: 'oklch(0.80 0.14 85)',
  orange: 'oklch(0.72 0.16 55)',
  red: 'oklch(0.64 0.19 25)',
  pink: 'oklch(0.68 0.17 350)',
  violet: 'oklch(0.64 0.18 300)'
}

const GroupColorsSchema = z.object(
  Object.fromEntries(
    TAB_GROUP_COLORS.map((name) => [name, z.string().default(groupColorDefaults[name])])
  ) as { [K in (typeof TAB_GROUP_COLORS)[number]]: z.ZodDefault<z.ZodString> }
)

export const ColorTokensSchema = z
  .object({
    scheme: z.enum(['dark', 'light']).default('dark'),
    /** Window backdrop. Visible through the glass in overlay mode. */
    bg: z.string().default('oklch(0.16 0.012 265)'),
    surface1: z.string().default('oklch(0.21 0.014 265)'),
    surface2: z.string().default('oklch(0.26 0.016 265)'),
    surface3: z.string().default('oklch(0.32 0.018 265)'),
    text: z.string().default('oklch(0.96 0.005 265)'),
    textMuted: z.string().default('oklch(0.74 0.012 265)'),
    textFaint: z.string().default('oklch(0.56 0.014 265)'),
    accent: z.string().default('oklch(0.70 0.17 285)'),
    accentText: z.string().default('oklch(0.16 0.02 285)'),
    border: z.string().default('oklch(1 0 0 / 0.10)'),
    borderStrong: z.string().default('oklch(1 0 0 / 0.20)'),
    /**
     * The dim behind a modal surface.
     *
     * Authored rather than derived from `bg`: the same black at 28% is a
     * whisper over a dark window and a bruise over a light one, so a light
     * theme has to be able to set its own.
     */
    scrim: z.string().default('oklch(0 0 0 / 0.28)'),
    success: z.string().default('oklch(0.74 0.15 150)'),
    warning: z.string().default('oklch(0.80 0.14 85)'),
    danger: z.string().default('oklch(0.65 0.19 25)'),
    group: GroupColorsSchema.prefault({})
  })
  .prefault({})
export type ColorTokens = z.infer<typeof ColorTokensSchema>

/* ------------------------------------------------------------------ *
 * Glass
 * ------------------------------------------------------------------ */

/**
 * `native`          OS vibrancy / acrylic behind a translucent chrome
 * `overlay`         backdrop-filter over the window background (default)
 * `content-sampled` throttled capturePage() of the region beneath the surface
 * `solid`           no blur at all, for low-power machines and clarity
 *
 * See ARCHITECTURE.md for why these are not interchangeable: a WebContentsView
 * is a native view, so CSS in the chrome cannot blur page pixels directly.
 */
export const GlassModeSchema = z.enum(['native', 'overlay', 'content-sampled', 'solid'])
export type GlassMode = z.infer<typeof GlassModeSchema>

const glassSurface = (defaults: {
  blur: number
  tintAlpha: number
  borderAlpha: number
  shadowLevel: number
}) =>
  z
    .object({
      mode: GlassModeSchema.default('overlay'),
      /** Backdrop blur radius in px. */
      blur: z.number().min(0).max(200).default(defaults.blur),
      /** Backdrop saturation multiplier -- what makes glass feel "wet". */
      saturation: z.number().min(0).max(4).default(1.7),
      /** Backdrop brightness multiplier. */
      brightness: z.number().min(0).max(3).default(1),
      tint: z.string().default('oklch(0.22 0.015 265)'),
      tintAlpha: z.number().min(0).max(1).default(defaults.tintAlpha),
      /** Film grain over the surface, 0..1. Kills banding on large blurs. */
      noise: z.number().min(0).max(1).default(0.035),
      /** Alpha of the bright top edge that sells the "pane of glass" read. */
      borderAlpha: z.number().min(0).max(1).default(defaults.borderAlpha),
      /** Angle of the specular edge gradient, in degrees. */
      borderAngle: z.number().default(145),
      /** Inner top highlight intensity. */
      innerGlow: z.number().min(0).max(1).default(0.07),
      shadowLevel: z.number().int().min(0).max(5).default(defaults.shadowLevel)
    })
    .prefault({})

export const GlassTokensSchema = z
  .object({
    chrome: glassSurface({ blur: 30, tintAlpha: 0.55, borderAlpha: 0.1, shadowLevel: 1 }),
    panel: glassSurface({ blur: 24, tintAlpha: 0.62, borderAlpha: 0.12, shadowLevel: 2 }),
    popover: glassSurface({ blur: 36, tintAlpha: 0.72, borderAlpha: 0.16, shadowLevel: 4 }),
    overlay: glassSurface({ blur: 48, tintAlpha: 0.5, borderAlpha: 0.14, shadowLevel: 5 })
  })
  .prefault({})
export type GlassTokens = z.infer<typeof GlassTokensSchema>
export type GlassSurfaceName = keyof GlassTokens

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

export const GeometryTokensSchema = z
  .object({
    radiusSm: z.number().default(6),
    radiusMd: z.number().default(10),
    radiusLg: z.number().default(16),
    radiusXl: z.number().default(24),
    radiusPill: z.number().default(999),
    /** Base spacing unit in px; the scale is multiples of this. */
    spaceUnit: z.number().default(4),
    borderWidth: z.number().default(1),
    /** Multiplies every spacing and control height. */
    density: z.enum(['compact', 'normal', 'comfortable']).default('normal'),
    /**
     * How far a disabled control fades. A token because "disabled" is a
     * legibility decision, not a constant: a high-contrast theme needs to raise
     * it, and 0.55 of a faint colour is close to invisible.
     */
    disabledOpacity: z.number().min(0).max(1).default(0.55),
    /** Gap between the chrome and the inset page view, in px. */
    pageInset: z.number().min(0).max(64).default(8),
    /** Corner radius applied to the page view itself. */
    pageRadius: z.number().min(0).max(48).default(12),
    /**
     * The narrowest the page is allowed to get, in px.
     *
     * A floor rather than a preference: docked panels shrink to respect it, so
     * a layout carried onto a smaller screen gives ground in the chrome instead
     * of squeezing the web page down to nothing.
     */
    viewportMin: z.number().min(0).max(800).default(240)
  })
  .prefault({})
export type GeometryTokens = z.infer<typeof GeometryTokensSchema>

const densityScale: Record<GeometryTokens['density'], number> = {
  compact: 0.85,
  normal: 1,
  comfortable: 1.2
}

/* ------------------------------------------------------------------ *
 * Typography
 * ------------------------------------------------------------------ */

export const TypographyTokensSchema = z
  .object({
    fontSans: z
      .string()
      .default(
        'ui-sans-serif, -apple-system, "Segoe UI Variable Text", Inter, system-ui, sans-serif'
      ),
    fontMono: z
      .string()
      .default('ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", monospace'),
    baseSize: z.number().default(13),
    /** Ratio between adjacent steps of the type scale. */
    scaleRatio: z.number().default(1.15),
    lineHeight: z.number().default(1.5),
    trackingTight: z.number().default(-0.01),
    weightNormal: z.number().int().default(450),
    weightMedium: z.number().int().default(560),
    weightBold: z.number().int().default(680)
  })
  .prefault({})
export type TypographyTokens = z.infer<typeof TypographyTokensSchema>

/* ------------------------------------------------------------------ *
 * Motion
 * ------------------------------------------------------------------ */

const SpringSchema = (stiffness: number, damping: number, mass = 1) =>
  z
    .object({
      stiffness: z.number().min(1).max(2000).default(stiffness),
      damping: z.number().min(0).max(200).default(damping),
      mass: z.number().min(0.1).max(10).default(mass)
    })
    .prefault({})

export const SpringTokenSchema = SpringSchema(400, 30)
export type SpringToken = z.infer<typeof SpringTokenSchema>

/**
 * Every micro-interaction in Radius reads its physics from here rather than
 * hardcoding numbers, which is what makes "tune the tab-drag spring" a user
 * setting instead of a code change.
 */
export const MotionTokensSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Global speed multiplier. >1 is slower, <1 is snappier. */
    scale: z.number().min(0.1).max(4).default(1),
    /** When true, `prefers-reduced-motion` is ignored (explicit user opt-out). */
    overrideReducedMotion: z.boolean().default(false),
    springs: z
      .object({
        tabDrag: SpringSchema(620, 34),
        tabHover: SpringSchema(500, 28),
        panel: SpringSchema(320, 32),
        popover: SpringSchema(520, 30),
        workspaceSwitch: SpringSchema(240, 30, 1.1),
        press: SpringSchema(900, 26)
      })
      .prefault({}),
    durations: z
      .object({
        instant: z.number().default(80),
        fast: z.number().default(140),
        normal: z.number().default(220),
        slow: z.number().default(380),
        /**
         * One cycle of a repeating animation -- the spinner's rotation, the
         * assistant's thinking pulse, the shimmer travelling over a streaming
         * reply. Separate from the one-shot durations because a loop that is
         * "fast" is a strobe: these are deliberately an order slower.
         */
        pulse: z.number().default(1600),
        spin: z.number().default(700),
        shimmer: z.number().default(1200)
      })
      .prefault({}),
    easings: z
      .object({
        standard: z.string().default('cubic-bezier(0.2, 0, 0, 1)'),
        entrance: z.string().default('cubic-bezier(0.05, 0.7, 0.1, 1)'),
        exit: z.string().default('cubic-bezier(0.3, 0, 0.8, 0.15)')
      })
      .prefault({}),
    /** Delay between children in a staggered list, in seconds. */
    stagger: z.number().min(0).max(0.5).default(0.026),
    /** Amplitude of the rubber-band overscroll effect, 0 disables it. */
    rubberBand: z.number().min(0).max(1).default(0.35),
    /**
     * How far a control lifts on hover, in pixels. One number rather than one
     * per component, so "everything lifts a bit less" is a single edit.
     */
    hoverLift: z.number().min(0).max(8).default(1),
    /** How far a pressed control sinks. Expressed as a scale factor. */
    pressScale: z.number().min(0.8).max(1).default(0.97),
    /** Opacity of the press ripple at its start. 0 disables the ripple. */
    ripple: z.number().min(0).max(1).default(0.22)
  })
  .prefault({})
export type MotionTokens = z.infer<typeof MotionTokensSchema>

/** Named motion presets exposed in Settings, mapped onto the tokens above. */
export const MOTION_PRESETS = {
  reduced: { enabled: false, scale: 1 },
  snappy: { enabled: true, scale: 0.7 },
  balanced: { enabled: true, scale: 1 },
  expressive: { enabled: true, scale: 1.35 }
} as const satisfies Record<string, Partial<MotionTokens>>

/* ------------------------------------------------------------------ *
 * Elevation
 * ------------------------------------------------------------------ */

export const ElevationTokensSchema = z
  .object({
    level0: z.string().default('none'),
    level1: z.string().default('0 1px 2px oklch(0 0 0 / 0.24)'),
    level2: z.string().default('0 2px 8px oklch(0 0 0 / 0.28)'),
    level3: z.string().default('0 6px 18px oklch(0 0 0 / 0.32)'),
    level4: z.string().default('0 12px 32px oklch(0 0 0 / 0.38)'),
    level5: z.string().default('0 24px 64px oklch(0 0 0 / 0.46)')
  })
  .prefault({})
export type ElevationTokens = z.infer<typeof ElevationTokensSchema>

/* ------------------------------------------------------------------ *
 * Theme document
 * ------------------------------------------------------------------ */

export const THEME_SCHEMA_VERSION = 1

export const ThemeSchema = z.object({
  /** Bumped when the token shape changes so old files can be migrated. */
  version: z.number().int().default(THEME_SCHEMA_VERSION),
  id: z.string().default('custom'),
  name: z.string().default('Custom'),
  author: z.string().default(''),
  /** One line of prose for the gallery card. Optional; never invented. */
  description: z.string().default(''),
  colors: ColorTokensSchema,
  glass: GlassTokensSchema,
  geometry: GeometryTokensSchema,
  typography: TypographyTokensSchema,
  motion: MotionTokensSchema,
  elevation: ElevationTokensSchema,
  /** Raw CSS appended after the generated variables. Chrome-scoped only. */
  userCss: z.string().default('')
})
export type Theme = z.infer<typeof ThemeSchema>

/** Parses a partial theme document, filling every unspecified token. */
export function parseTheme(input: unknown): Theme {
  return ThemeSchema.parse(input ?? {})
}

export const defaultTheme = (): Theme => parseTheme({})

/* ------------------------------------------------------------------ *
 * Reading a document a human wrote
 * ------------------------------------------------------------------ */

export const ThemeIssueSchema = z.object({
  /** Dotted token path, e.g. `glass.chrome.blur`. `(document)` for the root. */
  path: z.string(),
  message: z.string()
})
export type ThemeIssue = z.infer<typeof ThemeIssueSchema>

export type ThemeParseResult =
  | { ok: true; theme: Theme }
  | { ok: false; issues: ThemeIssue[] }

const ROOT_PATH = '(document)'

function issuePath(path: ReadonlyArray<PropertyKey>): string {
  return path.length === 0 ? ROOT_PATH : path.map((part) => String(part)).join('.')
}

/**
 * Parses a theme document and, when it fails, says *which field* failed.
 *
 * "Invalid theme" is useless to someone hand-editing a JSON file: the whole
 * point of a token document is that you can write three lines of it, so the one
 * line that is wrong has to be namable. zod already knows the path; this only
 * has to keep it rather than throwing it away.
 */
export function parseThemeDocument(input: unknown): ThemeParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        {
          path: ROOT_PATH,
          message: `expected a JSON object of tokens, received ${describeValue(input)}`
        }
      ]
    }
  }

  const result = ThemeSchema.safeParse(input)
  if (result.success) return { ok: true, theme: result.data }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issuePath(issue.path),
      message: issue.message
    }))
  }
}

/**
 * What came back from the import dialog.
 *
 * Flat rather than a discriminated union because it crosses IPC and gets
 * rendered directly: every field is present, `status` says which ones matter.
 */
export const ThemeImportResultSchema = z.object({
  status: z.enum(['imported', 'cancelled', 'failed']),
  theme: ThemeSchema.nullable().default(null),
  path: z.string().nullable().default(null),
  /** Token paths the file actually named, so the studio can report the count. */
  setPaths: z.array(z.string()).default([]),
  issues: z.array(ThemeIssueSchema).default([]),
  /** A failure that is not a token problem: unreadable file, malformed JSON. */
  error: z.string().default('')
})
export type ThemeImportResult = z.infer<typeof ThemeImportResultSchema>

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`
  return `a ${typeof value}`
}

/* ------------------------------------------------------------------ *
 * Partial documents: overrides, merging, diffing
 * ------------------------------------------------------------------ */

/**
 * A partial token document: any subset of the theme shape.
 *
 * A workspace stores one of these rather than a copy of the whole theme, so a
 * workspace that only wants a denser layout carries two tokens and inherits
 * every later change to the base theme.
 */
export const ThemeOverrideSchema = z.record(z.string(), z.unknown())
export type ThemeOverride = z.infer<typeof ThemeOverrideSchema>

type JsonRecord = Record<string, unknown>

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-merges a partial document over a base one. Objects merge key by key;
 * anything else replaces. Neither input is mutated.
 */
export function mergeThemeDocuments(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch
  const result: JsonRecord = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    result[key] = isPlainObject(value) ? mergeThemeDocuments(result[key], value) : value
  }
  return result
}

/**
 * Applies a partial override to a resolved theme.
 *
 * Merging happens on the *document*, not on resolved CSS variables, so the
 * result goes back through the schema and an override naming a token that does
 * not exist -- or a value out of range -- is reported rather than silently
 * painting something wrong.
 */
export function resolveThemeOverride(
  theme: Theme,
  override: ThemeOverride | null | undefined
): { theme: Theme; issues: ThemeIssue[] } {
  if (!override || Object.keys(override).length === 0) return { theme, issues: [] }
  const merged = mergeThemeDocuments(theme, override)
  const result = parseThemeDocument(merged)
  // A broken override leaves the base theme visible rather than a broken app;
  // the issues travel with it so the studio can say what was ignored.
  return result.ok ? { theme: result.theme, issues: [] } : { theme, issues: result.issues }
}

export function applyThemeOverride(
  theme: Theme,
  override: ThemeOverride | null | undefined
): Theme {
  return resolveThemeOverride(theme, override).theme
}

/**
 * The minimal document that turns `base` into `next`.
 *
 * This is what makes "edit this workspace" work with the same controls as
 * "edit the theme": the studio writes a whole theme, and the diff against the
 * base is what gets stored on the workspace.
 */
export function themeOverrideDiff(base: unknown, next: unknown): ThemeOverride {
  const diff: JsonRecord = {}
  if (!isPlainObject(base) || !isPlainObject(next)) return diff
  for (const [key, value] of Object.entries(next)) {
    const previous = base[key]
    if (isPlainObject(value) && isPlainObject(previous)) {
      const nested = themeOverrideDiff(previous, value)
      if (Object.keys(nested).length > 0) diff[key] = nested
    } else if (!Object.is(previous, value)) {
      diff[key] = value
    }
  }
  return diff
}

/** Flattens an override to `{ path, value }` leaves, for showing what it changes. */
export function flattenThemeOverride(
  override: ThemeOverride | null | undefined,
  prefix = ''
): Array<{ path: string; value: unknown }> {
  if (!override) return []
  const leaves: Array<{ path: string; value: unknown }> = []
  for (const [key, value] of Object.entries(override)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) leaves.push(...flattenThemeOverride(value, path))
    else leaves.push({ path, value })
  }
  return leaves
}

/** Removes one dotted token path from an override, pruning empty parents. */
export function withoutThemeOverridePath(
  override: ThemeOverride,
  path: string
): ThemeOverride {
  const [head, ...rest] = path.split('.')
  if (head === undefined) return override
  const next: JsonRecord = { ...override }
  if (rest.length === 0) {
    delete next[head]
    return next
  }
  const child = next[head]
  if (!isPlainObject(child)) return next
  const pruned = withoutThemeOverridePath(child, rest.join('.'))
  if (Object.keys(pruned).length === 0) delete next[head]
  else next[head] = pruned
  return next
}

/* ------------------------------------------------------------------ *
 * User CSS
 * ------------------------------------------------------------------ */

export interface UserCssResult {
  css: string
  /** What was removed, in the user's terms. Never silent. */
  warnings: string[]
}

/**
 * Prepares user CSS for injection into the chrome.
 *
 * This is the one place a user hands Radius something free-form, so it is worth
 * being explicit about what it is: a stylesheet, injected into the chrome view
 * only, never into a page view, and never evaluated as script. It is applied by
 * assigning `textContent` on a `<style>` element, so it cannot introduce markup.
 *
 * Two constructs are stripped rather than trusted, and both are reported:
 *
 * - `@import`, which would fetch a stylesheet from the network. A theme is a
 *   local document; nothing about picking a colour should make a request.
 * - remote `url()`, which leaks a request (and therefore the fact that the
 *   chrome is open) to a third party. `data:` URIs are kept -- they are inert
 *   and are how a self-contained theme ships an image.
 *
 * Legacy script-in-CSS vectors (`expression()`, `-moz-binding`, `behavior`)
 * are stripped too. No engine Radius runs on supports them; they go because
 * "does not execute third-party code" should not rest on that.
 */
export function sanitizeUserCss(input: string): UserCssResult {
  const warnings: string[] = []
  let css = input

  const drop = (pattern: RegExp, warning: string): void => {
    if (!pattern.test(css)) return
    css = css.replace(pattern, '')
    warnings.push(warning)
  }

  drop(/@import[^;{]*(;|$)/gi, '@import was removed: user CSS may not fetch from the network.')
  drop(
    /url\(\s*(['"]?)(?!data:)[a-z0-9+.-]*:\/\/[^)]*\1\s*\)/gi,
    'A remote url() was removed: user CSS may not load from the network. Inline it as a data: URI.'
  )
  drop(/expression\s*\(/gi, 'expression() was removed: user CSS is never evaluated as script.')
  drop(/-moz-binding\s*:[^;}]*/gi, '-moz-binding was removed: user CSS may not bind behaviour.')
  drop(/(^|[;{\s])behavior\s*:[^;}]*/gi, 'behavior was removed: user CSS may not bind behaviour.')
  // Belt and braces: `textContent` cannot introduce markup, but a future caller
  // that builds a stylesheet string should not be the one to discover that.
  drop(/<\/?style[^>]*>/gi, 'A <style> tag was removed: this field takes CSS, not HTML.')

  return { css, warnings }
}

/* ------------------------------------------------------------------ *
 * Contrast honesty
 * ------------------------------------------------------------------ */

export interface ContrastFinding {
  id: string
  label: string
  /** Dotted token paths, so the studio can point at the control that owns it. */
  foreground: string
  background: string
  /** WCAG minimum this pair is held to, and why it is that number. */
  minimum: number
  reason: string
  /** null when a colour is not an OKLCH string we can measure. */
  ratio: number | null
  grade: ContrastGrade | null
  passes: boolean
}

const CONTRAST_PAIRS: Array<{
  id: string
  label: string
  foreground: string
  background: string
  minimum: number
  reason: string
}> = [
  {
    id: 'text-surface',
    label: 'Text on a panel',
    foreground: 'colors.text',
    background: 'colors.surface1',
    minimum: AA_TEXT,
    reason: 'body text'
  },
  {
    id: 'text-bg',
    label: 'Text on the window backdrop',
    foreground: 'colors.text',
    background: 'colors.bg',
    minimum: AA_TEXT,
    reason: 'body text'
  },
  {
    id: 'muted-surface',
    label: 'Muted text on a panel',
    foreground: 'colors.textMuted',
    background: 'colors.surface1',
    minimum: AA_TEXT,
    reason: 'body text'
  },
  {
    id: 'faint-surface',
    label: 'Faint text on a panel',
    foreground: 'colors.textFaint',
    background: 'colors.surface1',
    minimum: AA_LARGE,
    reason: 'labels and hints'
  },
  {
    id: 'accent-text',
    label: 'Label on an accent button',
    foreground: 'colors.accentText',
    background: 'colors.accent',
    minimum: AA_TEXT,
    reason: 'body text'
  },
  {
    id: 'accent-surface',
    label: 'Accent against a panel',
    foreground: 'colors.accent',
    background: 'colors.surface1',
    minimum: AA_LARGE,
    reason: 'non-text UI (WCAG 1.4.11)'
  }
]

function tokenAt(theme: Theme, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>((node, key) => (isPlainObject(node) ? node[key] : undefined), theme)
  return typeof value === 'string' ? value : undefined
}

/**
 * Grades every colour pair the chrome actually renders.
 *
 * The token engine is the only thing that can answer this: a computed style
 * cannot grade a colour that has not been applied yet, and a theme is edited
 * live. Nothing here corrects a value -- a user who wants a low-contrast theme
 * gets one, and is told what it costs.
 */
export function auditThemeContrast(theme: Theme): ContrastFinding[] {
  return CONTRAST_PAIRS.map((pair) => {
    const foreground = tokenAt(theme, pair.foreground)
    const background = tokenAt(theme, pair.background)
    const measured =
      foreground && background ? checkContrast(foreground, background) : null
    return {
      ...pair,
      ratio: measured?.ratio ?? null,
      grade: measured?.grade ?? null,
      passes: measured !== null && measured.ratio >= pair.minimum
    }
  })
}

/** Just the pairs that fail, which is what a warning surface wants. */
export function failingContrast(theme: Theme): ContrastFinding[] {
  return auditThemeContrast(theme).filter((finding) => !finding.passes)
}

/* ------------------------------------------------------------------ *
 * Resolution to CSS custom properties
 * ------------------------------------------------------------------ */

function tint(color: string, alpha: number): string {
  const parsed = parseOklch(color)
  if (!parsed) return color
  return formatOklch(withAlpha(parsed, parsed.alpha * alpha))
}

function glassVars(name: string, surface: GlassTokens[GlassSurfaceName]): Record<string, string> {
  const prefix = `--rx-glass-${name}`
  const filters =
    surface.mode === 'solid'
      ? 'none'
      : `blur(${surface.blur}px) saturate(${surface.saturation}) brightness(${surface.brightness})`

  // In `solid` mode the tint has to carry the whole surface, so it goes opaque.
  const alpha = surface.mode === 'solid' ? 1 : surface.tintAlpha

  return {
    [`${prefix}-mode`]: surface.mode,
    [`${prefix}-backdrop`]: filters,
    [`${prefix}-bg`]: tint(surface.tint, alpha),
    [`${prefix}-noise`]: String(surface.noise),
    [`${prefix}-border`]: `oklch(1 0 0 / ${surface.borderAlpha})`,
    [`${prefix}-border-angle`]: `${surface.borderAngle}deg`,
    [`${prefix}-glow`]: `oklch(1 0 0 / ${surface.innerGlow})`,
    [`${prefix}-shadow`]: `var(--rx-elevation-${surface.shadowLevel})`
  }
}

/**
 * The caret a `<select>` paints for itself.
 *
 * A native select draws its arrow in the OS palette, which looks pasted on
 * inside the chrome. The stylesheet replaces it with this background image --
 * and because a background SVG cannot read `currentColor`, the colour has to be
 * baked in here, where it stays a function of the theme rather than a literal
 * in the stylesheet.
 */
function selectChevron(color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function springVars(name: string, spring: SpringToken, scale: number): Record<string, string> {
  return {
    [`--rx-spring-${name}-stiffness`]: String(spring.stiffness),
    // Slowing motion down means softening the spring, not just stretching time.
    [`--rx-spring-${name}-damping`]: String(spring.damping),
    [`--rx-spring-${name}-mass`]: String(spring.mass * scale)
  }
}

/**
 * Flattens a theme into the `--rx-*` custom properties consumed by the
 * stylesheet. Pure and synchronous so it can be unit tested and called on
 * every keystroke in the Theme Studio.
 */
export function resolveThemeVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {}
  const { colors, geometry, typography, motion, elevation } = theme

  vars['--rx-scheme'] = colors.scheme
  vars['--rx-color-bg'] = colors.bg
  vars['--rx-color-surface-1'] = colors.surface1
  vars['--rx-color-surface-2'] = colors.surface2
  vars['--rx-color-surface-3'] = colors.surface3
  vars['--rx-color-text'] = colors.text
  vars['--rx-color-text-muted'] = colors.textMuted
  vars['--rx-color-text-faint'] = colors.textFaint
  vars['--rx-color-accent'] = colors.accent
  vars['--rx-color-accent-text'] = colors.accentText
  vars['--rx-color-border'] = colors.border
  vars['--rx-color-border-strong'] = colors.borderStrong
  vars['--rx-color-scrim'] = colors.scrim
  vars['--rx-color-success'] = colors.success
  vars['--rx-color-warning'] = colors.warning
  vars['--rx-color-danger'] = colors.danger
  for (const name of TAB_GROUP_COLORS) {
    vars[`--rx-color-group-${name}`] = colors.group[name]
  }
  // Derived, not authored: the select caret has to carry its colour inside the
  // image, so it is regenerated whenever the muted text token changes.
  vars['--rx-select-chevron'] = selectChevron(colors.textMuted)

  for (const [level, shadow] of Object.entries(elevation)) {
    vars[`--rx-elevation-${level.replace('level', '')}`] = shadow
  }

  for (const [name, surface] of Object.entries(theme.glass)) {
    Object.assign(vars, glassVars(name, surface))
  }

  const density = densityScale[geometry.density]
  vars['--rx-radius-sm'] = `${geometry.radiusSm}px`
  vars['--rx-radius-md'] = `${geometry.radiusMd}px`
  vars['--rx-radius-lg'] = `${geometry.radiusLg}px`
  vars['--rx-radius-xl'] = `${geometry.radiusXl}px`
  vars['--rx-radius-pill'] = `${geometry.radiusPill}px`
  vars['--rx-border-width'] = `${geometry.borderWidth}px`
  vars['--rx-density'] = String(density)
  vars['--rx-opacity-disabled'] = String(geometry.disabledOpacity)
  vars['--rx-page-inset'] = `${geometry.pageInset}px`
  vars['--rx-viewport-min'] = `${geometry.viewportMin}px`
  vars['--rx-page-radius'] = `${geometry.pageRadius}px`
  for (let step = 1; step <= 12; step += 1) {
    vars[`--rx-space-${step}`] = `${Math.round(geometry.spaceUnit * step * density)}px`
  }

  vars['--rx-font-sans'] = typography.fontSans
  vars['--rx-font-mono'] = typography.fontMono
  vars['--rx-line-height'] = String(typography.lineHeight)
  vars['--rx-tracking-tight'] = `${typography.trackingTight}em`
  vars['--rx-weight-normal'] = String(typography.weightNormal)
  vars['--rx-weight-medium'] = String(typography.weightMedium)
  vars['--rx-weight-bold'] = String(typography.weightBold)
  // Type scale steps -2..+4 around the base size.
  for (let step = -2; step <= 4; step += 1) {
    const size = typography.baseSize * typography.scaleRatio ** step
    vars[`--rx-text-${step < 0 ? `n${Math.abs(step)}` : step}`] = `${Math.round(size * 100) / 100}px`
  }

  const motionScale = motion.enabled ? motion.scale : 0
  vars['--rx-motion-enabled'] = motion.enabled ? '1' : '0'
  vars['--rx-motion-scale'] = String(motionScale)
  /*
   * Zero when motion is off, not the unscaled value.
   *
   * The `|| 1` that used to be here kept the full stagger alive with animation
   * disabled, so a twelve-row list still took a third of a second to finish
   * appearing -- rows arriving one after another with no animation on any of
   * them, which is the worst of both. `useMotionTokens().stagger()` already
   * returned 0 in that case, so the CSS variable disagreed with the JS helper.
   */
  vars['--rx-stagger'] = `${motion.enabled ? motion.stagger * motion.scale : 0}s`
  vars['--rx-rubber-band'] = String(motion.enabled ? motion.rubberBand : 0)
  // Every "how far does it move" amount collapses to nothing when motion is
  // off. Turning motion off has to mean the UI stops moving, not that it moves
  // the same distance instantly.
  vars['--rx-hover-lift'] = `${motion.enabled ? motion.hoverLift : 0}px`
  vars['--rx-press-scale'] = String(motion.enabled ? motion.pressScale : 1)
  vars['--rx-ripple'] = String(motion.enabled ? motion.ripple : 0)
  for (const [name, duration] of Object.entries(motion.durations)) {
    vars[`--rx-duration-${name}`] = `${Math.round(duration * motionScale)}ms`
  }
  for (const [name, easing] of Object.entries(motion.easings)) {
    vars[`--rx-ease-${name}`] = easing
  }
  for (const [name, spring] of Object.entries(motion.springs)) {
    Object.assign(vars, springVars(name, spring, motion.enabled ? motion.scale : 1))
  }

  return vars
}

/** Serialises resolved vars into a `:root { ... }` block for injection. */
export function themeToCss(theme: Theme): string {
  const vars = resolveThemeVars(theme)
  const body = Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n')
  // User CSS is appended sanitised: anything producing a string of CSS is a
  // thing that might get injected, and the guarantee should not depend on which
  // caller it was.
  return `:root {\n${body}\n}\n${sanitizeUserCss(theme.userCss).css}`
}

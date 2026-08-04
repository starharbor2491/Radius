import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import {
  applyThemeOverride,
  defaultTheme,
  flattenThemeOverride,
  mergeThemeDocuments,
  parseTheme,
  resolveThemeOverride,
  resolveThemeVars,
  sanitizeUserCss,
  themeOverrideDiff,
  type Theme,
  type ThemeIssue,
  type ThemeOverride
} from '@shared/theme'
import { bridge, send } from '../lib/bridge'
import { useActiveWorkspace } from '../store/useAppStore'

/** Which document an edit lands in. */
export type ThemeScope = 'global' | 'workspace'

interface ThemeContextValue {
  /** What is on screen: the base theme with any workspace override composed in. */
  theme: Theme
  /** The persisted global document, before any workspace override. */
  baseTheme: Theme
  presets: Theme[]
  /** Merges a partial token patch into whichever document `scope` names. */
  update: (patch: DeepPartial<Theme>) => void
  /** Replaces the global document wholesale -- import, revert, preset apply. */
  applyTheme: (theme: Theme) => void
  applyPreset: (presetId: string) => void
  scope: ThemeScope
  setScope: (scope: ThemeScope) => void
  /** The active workspace's override document, if it has one. */
  workspaceOverride: ThemeOverride | null
  setWorkspaceOverride: (override: ThemeOverride | null) => void
  /** The preset the workspace pins as its base, or null to follow the global theme. */
  workspaceThemeId: string | null
  setWorkspaceThemeId: (id: string | null) => void
  /** Non-fatal complaints about the workspace override, ignored but not hidden. */
  overrideIssues: ThemeIssue[]
  /** What `sanitizeUserCss` stripped on the way in. Never silent. */
  userCssWarnings: string[]
  reducedMotion: boolean
  canEditWorkspace: boolean
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const USER_CSS_ELEMENT_ID = 'rx-user-css'

/**
 * Applies the token document to the document root.
 *
 * This is the whole "change a token, see it instantly" mechanism: tokens
 * resolve to `--rx-*` custom properties, every stylesheet reads only those, so
 * a write here repaints the entire chrome with no React re-render needed for
 * the visual change itself.
 */
function applyThemeToRoot(theme: Theme, reducedMotion: boolean): void {
  const root = document.documentElement
  const effective =
    reducedMotion && !theme.motion.overrideReducedMotion
      ? { ...theme, motion: { ...theme.motion, enabled: false } }
      : theme

  for (const [name, value] of Object.entries(resolveThemeVars(effective))) {
    root.style.setProperty(name, value)
  }
  root.dataset.scheme = theme.colors.scheme

  // User CSS goes in its own element so replacing it never disturbs the
  // generated variables above it. It is assigned as text, never parsed as
  // markup, and only ever into this view -- a page view never sees it.
  let element = document.getElementById(USER_CSS_ELEMENT_ID)
  if (!element) {
    element = document.createElement('style')
    element.id = USER_CSS_ELEMENT_ID
    document.head.append(element)
  }
  element.textContent = sanitizeUserCss(theme.userCss).css
}

function mergeDeep<T>(base: T, patch: DeepPartial<T>): T {
  return mergeThemeDocuments(base, patch) as T
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [presets, setPresets] = useState<Theme[]>([])
  const [reducedMotion, setReducedMotion] = useState(false)
  const [scope, setScope] = useState<ThemeScope>('global')
  const workspace = useActiveWorkspace()

  useEffect(() => {
    void bridge.invoke('theme:get', {}).then((result) => {
      // Re-parse rather than trusting the payload: a theme written by an older
      // build is missing tokens this one reads, and defaults are cheaper than
      // a crash on first paint.
      setTheme(parseTheme(result.theme))
      setPresets((result.presets ?? []).map((preset) => parseTheme(preset)))
    })
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(query.matches)
    const listener = (event: MediaQueryListEvent): void => setReducedMotion(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  const workspaceOverride = (workspace?.themeOverride ?? null) as ThemeOverride | null
  const workspaceThemeId = workspace?.themeId ?? null

  /**
   * The document an edit in global scope lands in.
   *
   * A workspace may pin a preset as its base; when it does, the global theme is
   * still what "Global" edits write to, and the studio says so rather than
   * quietly redirecting the edit.
   */
  const baseTheme = useMemo<Theme>(() => {
    if (!workspaceThemeId) return theme
    return presets.find((preset) => preset.id === workspaceThemeId) ?? theme
  }, [theme, presets, workspaceThemeId])

  /**
   * Composition order, most specific last:
   *   global theme (or the workspace's pinned preset)
   *     → the workspace's partial override document
   *
   * `workspace.accent` is deliberately *not* in that chain. It is the
   * workspace's identity colour in the rail, and it is assigned at creation
   * from a rotating palette -- nobody chose it. Letting it mask the theme's
   * accent meant applying a theme never changed the accent, which made the
   * gallery lie about what a preset looks like. A workspace that wants a
   * different accent overrides `colors.accent` like any other token, and the
   * studio keeps the chip in step when it does.
   */
  const compose = useCallback(
    (source: Theme): Theme => applyThemeOverride(source, workspaceOverride),
    [workspaceOverride]
  )

  const overrideIssues = useMemo(
    () => resolveThemeOverride(baseTheme, workspaceOverride).issues,
    [baseTheme, workspaceOverride]
  )

  const effectiveTheme = useMemo<Theme>(() => compose(baseTheme), [compose, baseTheme])

  const userCssWarnings = useMemo(
    () => sanitizeUserCss(effectiveTheme.userCss).warnings,
    [effectiveTheme.userCss]
  )

  useEffect(() => {
    applyThemeToRoot(effectiveTheme, reducedMotion)
  }, [effectiveTheme, reducedMotion])

  /*
   * Page geometry lives in main, because main owns view bounds. Tokens can move
   * it -- a preset or a workspace override may change the inset -- so the shape
   * is pushed whenever the resolved value changes rather than only when a
   * slider is dragged.
   */
  const shape = useRef({ inset: -1, radius: -1 })
  useEffect(() => {
    const next = {
      inset: effectiveTheme.geometry.pageInset,
      radius: effectiveTheme.geometry.pageRadius
    }
    if (shape.current.inset === next.inset && shape.current.radius === next.radius) return
    shape.current = next
    send('chrome:setPageShape', next)
  }, [effectiveTheme.geometry.pageInset, effectiveTheme.geometry.pageRadius])

  const applyTheme = useCallback((next: Theme) => {
    setTheme(next)
    send('theme:set', { theme: next })
  }, [])

  const setWorkspaceOverride = useCallback(
    (override: ThemeOverride | null) => {
      if (!workspace) return
      send('workspaces:update', {
        workspaceId: workspace.id,
        themeOverride: override && Object.keys(override).length > 0 ? override : null
      })
    },
    [workspace]
  )

  const setWorkspaceThemeId = useCallback(
    (id: string | null) => {
      if (!workspace) return
      send('workspaces:update', { workspaceId: workspace.id, themeId: id })
    },
    [workspace]
  )

  const update = useCallback(
    (patch: DeepPartial<Theme>) => {
      if (scope === 'workspace' && workspace) {
        // Store the *difference* from the base, not a copy of the theme: the
        // workspace should inherit later edits to every token it did not touch.
        const next = mergeDeep(applyThemeOverride(baseTheme, workspaceOverride), patch)
        const override = themeOverrideDiff(baseTheme, next)
        const accent = flattenThemeOverride(override).find((leaf) => leaf.path === 'colors.accent')
        send('workspaces:update', {
          workspaceId: workspace.id,
          themeOverride: Object.keys(override).length > 0 ? override : null,
          // Keep the workspace chip the colour the workspace actually paints.
          ...(typeof accent?.value === 'string' ? { accent: accent.value } : {})
        })
        return
      }
      setTheme((current) => {
        const next = mergeDeep(current, patch)
        send('theme:set', { theme: next })
        return next
      })
    },
    [scope, workspace, baseTheme, workspaceOverride]
  )

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = presets.find((candidate) => candidate.id === presetId)
      if (!preset) return
      if (scope === 'workspace' && workspace) {
        send('workspaces:update', { workspaceId: workspace.id, themeId: presetId })
        return
      }
      applyTheme(preset)
    },
    [presets, scope, workspace, applyTheme]
  )

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: effectiveTheme,
      baseTheme,
      presets,
      update,
      applyTheme,
      applyPreset,
      scope,
      setScope,
      workspaceOverride,
      setWorkspaceOverride,
      workspaceThemeId,
      setWorkspaceThemeId,
      overrideIssues,
      userCssWarnings,
      reducedMotion,
      canEditWorkspace: Boolean(workspace)
    }),
    [
      effectiveTheme,
      baseTheme,
      presets,
      update,
      applyTheme,
      applyPreset,
      scope,
      workspaceOverride,
      setWorkspaceOverride,
      workspaceThemeId,
      setWorkspaceThemeId,
      overrideIssues,
      userCssWarnings,
      reducedMotion,
      workspace
    ]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider')
  return context
}

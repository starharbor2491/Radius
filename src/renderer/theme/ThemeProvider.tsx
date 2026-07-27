import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import { defaultTheme, parseTheme, resolveThemeVars, type Theme } from '@shared/theme'
import { bridge, send } from '../lib/bridge'
import { useActiveWorkspace } from '../store/useAppStore'

interface ThemeContextValue {
  theme: Theme
  presets: Theme[]
  /** Merges a partial token patch into the live theme and persists it. */
  update: (patch: DeepPartial<Theme>) => void
  applyPreset: (presetId: string) => void
  reducedMotion: boolean
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
function applyTheme(theme: Theme, reducedMotion: boolean): void {
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
  // generated variables above it.
  let element = document.getElementById(USER_CSS_ELEMENT_ID)
  if (!element) {
    element = document.createElement('style')
    element.id = USER_CSS_ELEMENT_ID
    document.head.append(element)
  }
  element.textContent = theme.userCss
}

function mergeDeep<T>(base: T, patch: DeepPartial<T>): T {
  const result = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue
    const current = result[key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof current === 'object' && current !== null) {
      result[key] = mergeDeep(current, value as DeepPartial<unknown>)
    } else {
      result[key] = value
    }
  }
  return result as T
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [presets, setPresets] = useState<Theme[]>([])
  const [reducedMotion, setReducedMotion] = useState(false)
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

  // A workspace can pin its own accent, which overrides the theme's while that
  // workspace is active without editing the theme itself.
  const effectiveTheme = useMemo<Theme>(() => {
    if (!workspace?.accent) return theme
    return { ...theme, colors: { ...theme.colors, accent: workspace.accent } }
  }, [theme, workspace?.accent])

  useEffect(() => {
    applyTheme(effectiveTheme, reducedMotion)
  }, [effectiveTheme, reducedMotion])

  const update = useCallback((patch: DeepPartial<Theme>) => {
    setTheme((current) => {
      const next = mergeDeep(current, patch)
      send('theme:set', { theme: next })
      return next
    })
  }, [])

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = presets.find((candidate) => candidate.id === presetId)
      if (!preset) return
      setTheme(preset)
      send('theme:set', { theme: preset })
    },
    [presets]
  )

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: effectiveTheme, presets, update, applyPreset, reducedMotion }),
    [effectiveTheme, presets, update, applyPreset, reducedMotion]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider')
  return context
}

import { parseTheme, type Theme } from './theme'

/**
 * Shipped presets. Each is a *partial* token document -- everything not named
 * here falls back to the schema defaults, which keeps these readable and makes
 * them a decent template for a user's own `.radius-theme.json`.
 */
const presetSources: Array<Record<string, unknown>> = [
  {
    id: 'obsidian',
    name: 'Obsidian',
    author: 'Radius',
    colors: { scheme: 'dark' }
  },
  {
    id: 'aurora',
    name: 'Aurora',
    author: 'Radius',
    colors: {
      scheme: 'dark',
      bg: 'oklch(0.17 0.03 200)',
      surface1: 'oklch(0.22 0.035 200)',
      surface2: 'oklch(0.27 0.04 200)',
      surface3: 'oklch(0.33 0.042 200)',
      accent: 'oklch(0.78 0.14 175)',
      accentText: 'oklch(0.18 0.03 175)'
    },
    glass: {
      chrome: { blur: 44, saturation: 2.1, tint: 'oklch(0.24 0.05 200)', tintAlpha: 0.5 },
      panel: { blur: 36, saturation: 2.0, tint: 'oklch(0.24 0.05 200)' },
      popover: { blur: 52, saturation: 2.2, tint: 'oklch(0.26 0.05 200)' }
    }
  },
  {
    id: 'daylight',
    name: 'Daylight',
    author: 'Radius',
    colors: {
      scheme: 'light',
      bg: 'oklch(0.96 0.006 265)',
      surface1: 'oklch(0.99 0.003 265)',
      surface2: 'oklch(0.94 0.006 265)',
      surface3: 'oklch(0.89 0.008 265)',
      text: 'oklch(0.24 0.014 265)',
      textMuted: 'oklch(0.46 0.014 265)',
      textFaint: 'oklch(0.62 0.012 265)',
      accent: 'oklch(0.56 0.18 275)',
      accentText: 'oklch(0.99 0.005 275)',
      border: 'oklch(0.20 0.01 265 / 0.12)',
      borderStrong: 'oklch(0.20 0.01 265 / 0.22)'
    },
    glass: {
      chrome: { tint: 'oklch(0.99 0.004 265)', tintAlpha: 0.62, borderAlpha: 0.5, innerGlow: 0.6 },
      panel: { tint: 'oklch(0.99 0.004 265)', tintAlpha: 0.7, borderAlpha: 0.55, innerGlow: 0.6 },
      popover: { tint: 'oklch(1 0 0)', tintAlpha: 0.82, borderAlpha: 0.6, innerGlow: 0.7 },
      overlay: { tint: 'oklch(0.98 0.004 265)', tintAlpha: 0.6, borderAlpha: 0.5 }
    },
    elevation: {
      level1: '0 1px 2px oklch(0.2 0.02 265 / 0.10)',
      level2: '0 2px 8px oklch(0.2 0.02 265 / 0.12)',
      level3: '0 6px 18px oklch(0.2 0.02 265 / 0.14)',
      level4: '0 12px 32px oklch(0.2 0.02 265 / 0.16)',
      level5: '0 24px 64px oklch(0.2 0.02 265 / 0.20)'
    }
  },
  {
    id: 'carbon',
    name: 'Carbon',
    author: 'Radius',
    // Deliberately cheap: no blur, no springs. The preset to pick on a laptop
    // that is already fighting for GPU time.
    colors: {
      scheme: 'dark',
      bg: 'oklch(0.13 0 0)',
      surface1: 'oklch(0.18 0 0)',
      surface2: 'oklch(0.23 0 0)',
      surface3: 'oklch(0.29 0 0)',
      accent: 'oklch(0.78 0.02 265)',
      accentText: 'oklch(0.14 0 0)'
    },
    glass: {
      chrome: { mode: 'solid', tint: 'oklch(0.18 0 0)', noise: 0 },
      panel: { mode: 'solid', tint: 'oklch(0.18 0 0)', noise: 0 },
      popover: { mode: 'solid', tint: 'oklch(0.21 0 0)', noise: 0 },
      overlay: { mode: 'solid', tint: 'oklch(0.16 0 0)', noise: 0 }
    },
    geometry: { radiusMd: 6, radiusLg: 8, pageInset: 0, pageRadius: 0, density: 'compact' },
    motion: { scale: 0.6 }
  },
  {
    id: 'vapor',
    name: 'Vapor',
    author: 'Radius',
    colors: {
      scheme: 'dark',
      bg: 'oklch(0.18 0.06 320)',
      surface1: 'oklch(0.24 0.07 320)',
      surface2: 'oklch(0.30 0.08 318)',
      surface3: 'oklch(0.36 0.09 316)',
      accent: 'oklch(0.76 0.19 340)',
      accentText: 'oklch(0.18 0.05 340)',
      borderStrong: 'oklch(0.85 0.12 330 / 0.35)'
    },
    glass: {
      chrome: { blur: 56, saturation: 2.4, tint: 'oklch(0.28 0.09 320)', tintAlpha: 0.45, noise: 0.06 },
      panel: { blur: 48, saturation: 2.3, tint: 'oklch(0.28 0.09 320)', noise: 0.06 },
      popover: { blur: 64, saturation: 2.5, tint: 'oklch(0.30 0.10 320)', noise: 0.05 },
      overlay: { blur: 72, saturation: 2.4, tint: 'oklch(0.24 0.09 320)' }
    },
    geometry: { radiusMd: 14, radiusLg: 22, radiusXl: 32, pageRadius: 18, density: 'comfortable' },
    motion: { scale: 1.35, rubberBand: 0.55 }
  },
  {
    id: 'paper',
    name: 'Paper',
    author: 'Radius',
    colors: {
      scheme: 'light',
      bg: 'oklch(0.95 0.014 85)',
      surface1: 'oklch(0.98 0.010 85)',
      surface2: 'oklch(0.93 0.013 85)',
      surface3: 'oklch(0.88 0.016 82)',
      text: 'oklch(0.27 0.02 60)',
      textMuted: 'oklch(0.48 0.02 60)',
      textFaint: 'oklch(0.64 0.018 60)',
      accent: 'oklch(0.55 0.13 45)',
      accentText: 'oklch(0.98 0.01 45)',
      border: 'oklch(0.30 0.02 60 / 0.14)',
      borderStrong: 'oklch(0.30 0.02 60 / 0.26)'
    },
    glass: {
      chrome: { blur: 12, saturation: 1.2, tint: 'oklch(0.98 0.012 85)', tintAlpha: 0.75, borderAlpha: 0.5, innerGlow: 0.5 },
      panel: { blur: 10, saturation: 1.2, tint: 'oklch(0.98 0.012 85)', tintAlpha: 0.8, borderAlpha: 0.5, innerGlow: 0.5 },
      popover: { blur: 16, saturation: 1.3, tint: 'oklch(0.99 0.010 85)', tintAlpha: 0.88, borderAlpha: 0.55 },
      overlay: { blur: 20, saturation: 1.2, tint: 'oklch(0.97 0.012 85)', tintAlpha: 0.7 }
    },
    typography: { scaleRatio: 1.18, lineHeight: 1.55 },
    geometry: { radiusMd: 8, radiusLg: 12 },
    motion: { scale: 0.9 }
  }
]

export const THEME_PRESETS: Theme[] = presetSources.map((source) => parseTheme(source))

export const DEFAULT_THEME_ID = 'obsidian'

export function getPreset(id: string): Theme | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id)
}

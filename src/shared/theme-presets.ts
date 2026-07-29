import { parseTheme, type Theme } from './theme'

/**
 * Shipped presets. Each is a *partial* token document -- everything not named
 * here falls back to the schema defaults, which keeps these readable and makes
 * them a decent template for a user's own `.radius-theme.json`.
 *
 * They are meant to be genuinely different browsers to sit in, not one design
 * in six colours: light and dark, dense and airy, glass that is a sheet of
 * frosted acrylic and glass that is not there at all. Between them they cover
 * every axis the token engine has -- scheme, density, radius, blur mode, type
 * scale and motion -- so "what can this thing do" is answerable by clicking.
 */
const presetSources: Array<Record<string, unknown>> = [
  {
    id: 'obsidian',
    name: 'Obsidian',
    author: 'Radius',
    description: 'The default. Cool near-black, overlay glass, balanced motion.',
    colors: { scheme: 'dark' }
  },
  {
    id: 'aurora',
    name: 'Aurora',
    author: 'Radius',
    description: 'Deep teal with wet, heavily saturated glass.',
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
    description: 'Neutral light, roomy, pale glass over a near-white backdrop.',
    colors: {
      scheme: 'light',
      bg: 'oklch(0.96 0.006 265)',
      surface1: 'oklch(0.99 0.003 265)',
      surface2: 'oklch(0.94 0.006 265)',
      surface3: 'oklch(0.89 0.008 265)',
      text: 'oklch(0.24 0.014 265)',
      textMuted: 'oklch(0.46 0.014 265)',
      textFaint: 'oklch(0.58 0.012 265)',
      accent: 'oklch(0.56 0.18 275)',
      accentText: 'oklch(0.99 0.005 275)',
      // A black scrim over a near-white window reads as a bruise; light themes
      // dim with their own surface colour instead.
      scrim: 'oklch(0.42 0.02 265 / 0.20)',
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
    description: 'No blur, no springs, no grain. For a laptop already fighting for GPU.',
    // Deliberately cheap: no blur, no springs. The preset to pick on a laptop
    // that is already fighting for GPU time.
    colors: {
      scheme: 'dark',
      bg: 'oklch(0.13 0 0)',
      surface1: 'oklch(0.18 0 0)',
      surface2: 'oklch(0.23 0 0)',
      surface3: 'oklch(0.29 0 0)',
      textFaint: 'oklch(0.60 0 0)',
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
    description: 'Magenta haze, the widest blur that ships, and slow expressive motion.',
    colors: {
      scheme: 'dark',
      bg: 'oklch(0.18 0.06 320)',
      surface1: 'oklch(0.24 0.07 320)',
      surface2: 'oklch(0.30 0.08 318)',
      surface3: 'oklch(0.36 0.09 316)',
      textFaint: 'oklch(0.62 0.04 320)',
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
    description: 'Warm off-white, barely any blur, a slightly larger type scale.',
    colors: {
      scheme: 'light',
      bg: 'oklch(0.95 0.014 85)',
      surface1: 'oklch(0.98 0.010 85)',
      surface2: 'oklch(0.93 0.013 85)',
      surface3: 'oklch(0.88 0.016 82)',
      text: 'oklch(0.27 0.02 60)',
      textMuted: 'oklch(0.48 0.02 60)',
      textFaint: 'oklch(0.60 0.018 60)',
      accent: 'oklch(0.55 0.13 45)',
      accentText: 'oklch(0.98 0.01 45)',
      scrim: 'oklch(0.45 0.03 60 / 0.20)',
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
  },
  {
    id: 'meridian',
    name: 'Meridian',
    author: 'Radius',
    description: 'A dense light theme: small type, tight corners, hairline rules.',
    // The counterpart to Daylight rather than a recolour of it -- everything
    // that makes Daylight roomy is turned the other way.
    colors: {
      scheme: 'light',
      bg: 'oklch(0.93 0.008 250)',
      surface1: 'oklch(0.985 0.004 250)',
      surface2: 'oklch(0.95 0.006 250)',
      surface3: 'oklch(0.90 0.008 250)',
      text: 'oklch(0.22 0.02 250)',
      textMuted: 'oklch(0.44 0.02 250)',
      textFaint: 'oklch(0.56 0.018 250)',
      accent: 'oklch(0.48 0.14 235)',
      accentText: 'oklch(0.99 0.004 235)',
      scrim: 'oklch(0.40 0.03 250 / 0.22)',
      border: 'oklch(0.22 0.02 250 / 0.16)',
      borderStrong: 'oklch(0.22 0.02 250 / 0.30)'
    },
    glass: {
      chrome: { blur: 16, saturation: 1.4, tint: 'oklch(0.985 0.004 250)', tintAlpha: 0.8, borderAlpha: 0.45, innerGlow: 0.45 },
      panel: { blur: 14, saturation: 1.4, tint: 'oklch(0.99 0.004 250)', tintAlpha: 0.86, borderAlpha: 0.45, innerGlow: 0.4 },
      popover: { blur: 22, saturation: 1.5, tint: 'oklch(1 0 0)', tintAlpha: 0.92, borderAlpha: 0.5 },
      overlay: { blur: 26, saturation: 1.3, tint: 'oklch(0.96 0.004 250)', tintAlpha: 0.72, borderAlpha: 0.45 }
    },
    typography: { baseSize: 12, scaleRatio: 1.12, lineHeight: 1.4 },
    geometry: {
      radiusSm: 3,
      radiusMd: 5,
      radiusLg: 8,
      radiusXl: 12,
      density: 'compact',
      pageInset: 4,
      pageRadius: 6
    },
    elevation: {
      level1: '0 1px 1px oklch(0.2 0.02 250 / 0.10)',
      level2: '0 2px 6px oklch(0.2 0.02 250 / 0.11)',
      level3: '0 4px 12px oklch(0.2 0.02 250 / 0.12)',
      level4: '0 8px 22px oklch(0.2 0.02 250 / 0.14)',
      level5: '0 16px 40px oklch(0.2 0.02 250 / 0.18)'
    },
    motion: { scale: 0.75, stagger: 0.014 }
  },
  {
    id: 'mist',
    name: 'Mist',
    author: 'Radius',
    description: 'Airy pale violet: wide corners, generous spacing, soft slow motion.',
    colors: {
      scheme: 'light',
      bg: 'oklch(0.94 0.02 290)',
      surface1: 'oklch(0.985 0.008 290)',
      surface2: 'oklch(0.95 0.014 290)',
      surface3: 'oklch(0.90 0.02 290)',
      text: 'oklch(0.28 0.04 290)',
      textMuted: 'oklch(0.47 0.04 290)',
      textFaint: 'oklch(0.60 0.03 290)',
      accent: 'oklch(0.55 0.16 300)',
      accentText: 'oklch(0.99 0.005 300)',
      scrim: 'oklch(0.46 0.05 290 / 0.18)',
      border: 'oklch(0.32 0.04 290 / 0.12)',
      borderStrong: 'oklch(0.32 0.04 290 / 0.22)'
    },
    glass: {
      chrome: { blur: 60, saturation: 1.8, tint: 'oklch(0.98 0.012 290)', tintAlpha: 0.55, borderAlpha: 0.6, innerGlow: 0.7, noise: 0.02 },
      panel: { blur: 50, saturation: 1.8, tint: 'oklch(0.99 0.010 290)', tintAlpha: 0.62, borderAlpha: 0.6, innerGlow: 0.7, noise: 0.02 },
      popover: { blur: 70, saturation: 1.9, tint: 'oklch(1 0.004 290)', tintAlpha: 0.78, borderAlpha: 0.65, innerGlow: 0.8 },
      overlay: { blur: 80, saturation: 1.7, tint: 'oklch(0.97 0.012 290)', tintAlpha: 0.55, borderAlpha: 0.55 }
    },
    typography: { baseSize: 13.5, scaleRatio: 1.2, lineHeight: 1.6 },
    geometry: {
      radiusSm: 10,
      radiusMd: 18,
      radiusLg: 26,
      radiusXl: 36,
      spaceUnit: 4,
      density: 'comfortable',
      pageInset: 14,
      pageRadius: 22
    },
    elevation: {
      level1: '0 1px 3px oklch(0.3 0.04 290 / 0.08)',
      level2: '0 4px 14px oklch(0.3 0.04 290 / 0.10)',
      level3: '0 10px 28px oklch(0.3 0.04 290 / 0.12)',
      level4: '0 18px 48px oklch(0.3 0.04 290 / 0.14)',
      level5: '0 32px 80px oklch(0.3 0.04 290 / 0.18)'
    },
    motion: { scale: 1.25, stagger: 0.04, rubberBand: 0.5 }
  },
  {
    id: 'ember',
    name: 'Ember',
    author: 'Radius',
    description: 'Warm charcoal and a hot accent, with film grain instead of blur.',
    colors: {
      scheme: 'dark',
      bg: 'oklch(0.15 0.018 45)',
      surface1: 'oklch(0.20 0.022 45)',
      surface2: 'oklch(0.25 0.026 45)',
      surface3: 'oklch(0.31 0.030 42)',
      text: 'oklch(0.95 0.012 60)',
      textMuted: 'oklch(0.74 0.02 55)',
      textFaint: 'oklch(0.58 0.024 50)',
      accent: 'oklch(0.72 0.18 45)',
      accentText: 'oklch(0.16 0.03 45)',
      border: 'oklch(0.9 0.04 60 / 0.12)',
      borderStrong: 'oklch(0.9 0.06 55 / 0.26)'
    },
    glass: {
      chrome: { blur: 14, saturation: 1.5, tint: 'oklch(0.21 0.026 45)', tintAlpha: 0.78, noise: 0.10 },
      panel: { blur: 12, saturation: 1.5, tint: 'oklch(0.21 0.026 45)', tintAlpha: 0.82, noise: 0.10 },
      popover: { blur: 18, saturation: 1.6, tint: 'oklch(0.24 0.03 45)', tintAlpha: 0.88, noise: 0.08 },
      overlay: { blur: 22, saturation: 1.5, tint: 'oklch(0.17 0.024 45)', tintAlpha: 0.72, noise: 0.08 }
    },
    typography: { baseSize: 13.5, scaleRatio: 1.16 },
    geometry: { radiusSm: 4, radiusMd: 8, radiusLg: 12, radiusXl: 18, pageInset: 10, pageRadius: 10 },
    elevation: {
      level1: '0 1px 2px oklch(0 0 0 / 0.34)',
      level2: '0 3px 10px oklch(0 0 0 / 0.40)',
      level3: '0 8px 22px oklch(0 0 0 / 0.46)',
      level4: '0 16px 40px oklch(0 0 0 / 0.52)',
      level5: '0 30px 72px oklch(0 0 0 / 0.60)'
    },
    motion: { scale: 0.95 }
  },
  {
    id: 'terminal',
    name: 'Terminal',
    author: 'Radius',
    description: 'Monospace everywhere, square corners, phosphor green, motion nearly off.',
    colors: {
      scheme: 'dark',
      bg: 'oklch(0.10 0.012 150)',
      surface1: 'oklch(0.15 0.014 150)',
      surface2: 'oklch(0.20 0.016 150)',
      surface3: 'oklch(0.26 0.018 150)',
      text: 'oklch(0.90 0.06 150)',
      textMuted: 'oklch(0.72 0.07 150)',
      textFaint: 'oklch(0.56 0.06 150)',
      accent: 'oklch(0.82 0.19 145)',
      accentText: 'oklch(0.12 0.03 145)',
      border: 'oklch(0.82 0.10 150 / 0.20)',
      borderStrong: 'oklch(0.82 0.14 150 / 0.42)'
    },
    glass: {
      chrome: { mode: 'solid', tint: 'oklch(0.13 0.014 150)', noise: 0 },
      panel: { mode: 'solid', tint: 'oklch(0.13 0.014 150)', noise: 0 },
      popover: { mode: 'solid', tint: 'oklch(0.17 0.016 150)', noise: 0 },
      overlay: { mode: 'solid', tint: 'oklch(0.10 0.012 150)', noise: 0 }
    },
    typography: {
      fontSans: 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", monospace',
      baseSize: 12.5,
      scaleRatio: 1.1,
      lineHeight: 1.45,
      trackingTight: 0,
      weightNormal: 400,
      weightMedium: 500,
      weightBold: 700
    },
    geometry: {
      radiusSm: 0,
      radiusMd: 0,
      radiusLg: 0,
      radiusXl: 0,
      radiusPill: 0,
      density: 'compact',
      pageInset: 2,
      pageRadius: 0
    },
    elevation: {
      level1: 'none',
      level2: 'none',
      level3: '0 2px 0 oklch(0 0 0 / 0.5)',
      level4: '0 3px 0 oklch(0 0 0 / 0.5)',
      level5: '0 4px 0 oklch(0 0 0 / 0.6)'
    },
    motion: { scale: 0.45, stagger: 0, rubberBand: 0 }
  },
  {
    id: 'nocturne',
    name: 'Nocturne',
    author: 'Radius',
    description: 'Indigo, and the only preset that asks the OS for real vibrancy.',
    // `native` samples the desktop rather than the page -- see ARCHITECTURE.md.
    // It is the honest option on macOS and Windows 11; elsewhere it degrades to
    // overlay, which is what the rest of these use anyway.
    colors: {
      scheme: 'dark',
      bg: 'oklch(0.14 0.04 275)',
      surface1: 'oklch(0.20 0.045 275)',
      surface2: 'oklch(0.25 0.05 275)',
      surface3: 'oklch(0.31 0.055 273)',
      text: 'oklch(0.95 0.015 275)',
      textMuted: 'oklch(0.75 0.03 275)',
      textFaint: 'oklch(0.58 0.035 275)',
      accent: 'oklch(0.70 0.15 255)',
      accentText: 'oklch(0.15 0.04 255)',
      border: 'oklch(0.85 0.06 275 / 0.14)',
      borderStrong: 'oklch(0.85 0.08 275 / 0.28)'
    },
    glass: {
      chrome: { mode: 'native', blur: 34, saturation: 1.9, tint: 'oklch(0.20 0.05 275)', tintAlpha: 0.42 },
      panel: { mode: 'native', blur: 28, saturation: 1.8, tint: 'oklch(0.20 0.05 275)', tintAlpha: 0.5 },
      popover: { blur: 40, saturation: 2.0, tint: 'oklch(0.23 0.055 275)', tintAlpha: 0.74 },
      overlay: { blur: 52, saturation: 1.9, tint: 'oklch(0.16 0.045 275)', tintAlpha: 0.55 }
    },
    geometry: { radiusMd: 12, radiusLg: 18, radiusXl: 26, pageInset: 10, pageRadius: 14 },
    motion: { scale: 1.1 }
  }
]

export const THEME_PRESETS: Theme[] = presetSources.map((source) => parseTheme(source))

export const DEFAULT_THEME_ID = 'obsidian'

export function getPreset(id: string): Theme | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id)
}

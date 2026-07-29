/**
 * Minimal OKLCH -> sRGB conversion plus WCAG contrast maths.
 *
 * Radius stores every colour token as an OKLCH string so that generated ramps
 * stay perceptually even when a user drags a lightness slider. The Theme Studio
 * needs to warn when a chosen pair fails WCAG AA, which means we need real
 * luminance numbers rather than a browser's computed style.
 */

export interface Oklch {
  /** Perceptual lightness, 0..1 */
  l: number
  /** Chroma, 0..~0.4 */
  c: number
  /** Hue in degrees, 0..360 */
  h: number
  /** Alpha, 0..1 */
  alpha: number
}

export interface Rgb {
  r: number
  g: number
  b: number
}

const OKLCH_PATTERN =
  /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.-]+)(?:deg)?\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i

function parseComponent(raw: string, percentBase: number): number {
  if (raw.endsWith('%')) return (Number.parseFloat(raw) / 100) * percentBase
  return Number.parseFloat(raw)
}

/** Parses `oklch(0.72 0.15 265)` / `oklch(72% 0.15 265deg / 50%)`. */
export function parseOklch(input: string): Oklch | null {
  const match = OKLCH_PATTERN.exec(input.trim())
  if (!match) return null
  const [, lRaw, cRaw, hRaw, alphaRaw] = match
  if (lRaw === undefined || cRaw === undefined || hRaw === undefined) return null
  const parsed: Oklch = {
    l: parseComponent(lRaw, 1),
    c: parseComponent(cRaw, 0.4),
    h: Number.parseFloat(hRaw),
    alpha: alphaRaw === undefined ? 1 : parseComponent(alphaRaw, 1)
  }
  if (Number.isNaN(parsed.l) || Number.isNaN(parsed.c) || Number.isNaN(parsed.h)) return null
  return parsed
}

export function formatOklch({ l, c, h, alpha }: Oklch): string {
  const base = `${round(l, 4)} ${round(c, 4)} ${round(h, 2)}`
  return alpha >= 1 ? `oklch(${base})` : `oklch(${base} / ${round(alpha, 3)})`
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** OKLCH -> linear-light sRGB. Components may fall outside 0..1 (out of gamut). */
export function oklchToLinearSrgb({ l, c, h }: Oklch): Rgb {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  const lp = l + 0.3963377774 * a + 0.2158037573 * b
  const mp = l - 0.1055613458 * a - 0.0638541728 * b
  const sp = l - 0.0894841775 * a - 1.291485548 * b

  const lc = lp * lp * lp
  const mc = mp * mp * mp
  const sc = sp * sp * sp

  return {
    r: 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    g: -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    b: -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function encodeGamma(value: number): number {
  const v = clamp01(value)
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

/** OKLCH -> gamma-encoded sRGB in 0..255, clipped to gamut. */
export function oklchToRgb255(color: Oklch): Rgb {
  const linear = oklchToLinearSrgb(color)
  return {
    r: Math.round(encodeGamma(linear.r) * 255),
    g: Math.round(encodeGamma(linear.g) * 255),
    b: Math.round(encodeGamma(linear.b) * 255)
  }
}

export function toHex(color: Oklch): string {
  const { r, g, b } = oklchToRgb255(color)
  const hex = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * WCAG 2.1 relative luminance. The spec linearises gamma-encoded sRGB, which
 * is exactly what `oklchToLinearSrgb` already produces -- we only need to clip
 * out-of-gamut values first.
 */
export function relativeLuminance(color: Oklch): number {
  const { r, g, b } = oklchToLinearSrgb(color)
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b)
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

export type ContrastGrade = 'fail' | 'AA-large' | 'AA' | 'AAA'

/**
 * The three WCAG 2.1 thresholds Radius holds a token pair to. Named rather than
 * inlined because every warning in the UI has to be able to say *which* rule a
 * colour missed, not just that it missed one.
 */
/** 1.4.6 Contrast (Enhanced), body text. */
export const AAA_TEXT = 7
/** 1.4.3 Contrast (Minimum), body text. */
export const AA_TEXT = 4.5
/** 1.4.3 for large text, and 1.4.11 for non-text UI. */
export const AA_LARGE = 3

export function gradeContrast(ratio: number): ContrastGrade {
  if (ratio >= AAA_TEXT) return 'AAA'
  if (ratio >= AA_TEXT) return 'AA'
  if (ratio >= AA_LARGE) return 'AA-large'
  return 'fail'
}

/**
 * Checks a foreground/background pair given as OKLCH strings. Returns null when
 * either string is unparseable, so callers can skip the warning rather than
 * showing a bogus one.
 */
export function checkContrast(
  foreground: string,
  background: string
): { ratio: number; grade: ContrastGrade } | null {
  const fg = parseOklch(foreground)
  const bg = parseOklch(background)
  if (!fg || !bg) return null
  const ratio = contrastRatio(fg, bg)
  return { ratio: round(ratio, 2), grade: gradeContrast(ratio) }
}

/** Shifts lightness while preserving hue and chroma -- used to build ramps. */
export function withLightness(color: Oklch, l: number): Oklch {
  return { ...color, l: clamp01(l) }
}

export function withAlpha(color: Oklch, alpha: number): Oklch {
  return { ...color, alpha: clamp01(alpha) }
}

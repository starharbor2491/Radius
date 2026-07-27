import { describe, expect, it } from 'vitest'
import {
  checkContrast,
  contrastRatio,
  formatOklch,
  gradeContrast,
  parseOklch,
  relativeLuminance,
  toHex
} from '@shared/color'

describe('parseOklch', () => {
  it('parses plain and percentage forms', () => {
    expect(parseOklch('oklch(0.72 0.15 265)')).toEqual({ l: 0.72, c: 0.15, h: 265, alpha: 1 })
    expect(parseOklch('oklch(72% 0.15 265deg / 50%)')).toEqual({
      l: 0.72,
      c: 0.15,
      h: 265,
      alpha: 0.5
    })
  })

  it('returns null for anything that is not oklch', () => {
    expect(parseOklch('#ff0000')).toBeNull()
    expect(parseOklch('rgb(1,2,3)')).toBeNull()
    expect(parseOklch('')).toBeNull()
  })

  it('round-trips through formatOklch', () => {
    const parsed = parseOklch('oklch(0.5 0.2 120)')!
    expect(parseOklch(formatOklch(parsed))).toEqual(parsed)
  })
})

describe('luminance and contrast', () => {
  it('puts pure black and pure white at the ends of the range', () => {
    const black = parseOklch('oklch(0 0 0)')!
    const white = parseOklch('oklch(1 0 0)')!
    expect(relativeLuminance(black)).toBeCloseTo(0, 4)
    expect(relativeLuminance(white)).toBeCloseTo(1, 3)
    // WCAG's maximum ratio.
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1)
  })

  it('is symmetric', () => {
    const a = parseOklch('oklch(0.3 0.1 200)')!
    const b = parseOklch('oklch(0.9 0.05 90)')!
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 6)
  })

  it('grades against the WCAG thresholds', () => {
    expect(gradeContrast(21)).toBe('AAA')
    expect(gradeContrast(7)).toBe('AAA')
    expect(gradeContrast(4.5)).toBe('AA')
    expect(gradeContrast(3)).toBe('AA-large')
    expect(gradeContrast(2.9)).toBe('fail')
  })

  it('flags the default text-on-surface pair as at least AA', () => {
    const result = checkContrast('oklch(0.96 0.005 265)', 'oklch(0.21 0.014 265)')
    expect(result).not.toBeNull()
    expect(result!.ratio).toBeGreaterThan(4.5)
  })

  it('returns null rather than a bogus number for unparseable input', () => {
    expect(checkContrast('not-a-colour', 'oklch(0.2 0 0)')).toBeNull()
  })
})

describe('toHex', () => {
  it('clips out-of-gamut colours instead of producing garbage', () => {
    // Very high chroma at high lightness falls outside sRGB.
    const hex = toHex(parseOklch('oklch(0.95 0.35 140)')!)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('converts pure white and black', () => {
    expect(toHex(parseOklch('oklch(1 0 0)')!)).toBe('#ffffff')
    expect(toHex(parseOklch('oklch(0 0 0)')!)).toBe('#000000')
  })
})

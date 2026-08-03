import type { Transition } from 'motion/react'
import type { MotionTokens } from '@shared/theme'
import { useTheme } from '../theme/ThemeProvider'

export type SpringName = keyof MotionTokens['springs']
export type DurationName = keyof MotionTokens['durations']

export interface MotionHelpers {
  enabled: boolean
  /** A spring transition built from the named motion token. */
  spring: (name: SpringName) => Transition
  /** A tween transition from the named duration token. */
  tween: (name: DurationName, easing?: keyof MotionTokens['easings']) => Transition
  /**
   * A transition that repeats forever -- a spinner, a thinking pulse, a
   * shimmer.
   *
   * These need their own helper because the obvious construction is a trap: a
   * `tween` collapses to `{ duration: 0 }` when motion is off, and a zero-length
   * animation repeating infinitely is a busy loop that pins a core rather than
   * the stillness the user asked for. `loop` returns null instead, and the
   * caller renders the resting state.
   */
  loop: (name: DurationName) => Transition | null
  /** Stagger delay for the nth child of a list. */
  stagger: (index: number) => number
  /** Collapses a value to its resting state when motion is off. */
  when: <T>(animated: T, still: T) => T
  /** Raw motion amounts, for components that need the number rather than a transition. */
  amounts: {
    /** Hover lift distance in px; 0 when motion is off. */
    lift: number
    /** Pressed scale factor; 1 when motion is off. */
    press: number
    /** Rubber-band amplitude, 0..1; 0 when motion is off. */
    rubberBand: number
  }
}

/**
 * Every micro-interaction pulls its physics through here rather than inlining
 * numbers. That is what makes "tune the tab-drag spring" a slider in Settings
 * instead of a code change -- and what makes disabling motion actually disable
 * it, rather than merely shortening it.
 */
export function useMotionTokens(): MotionHelpers {
  const { theme } = useTheme()
  const motion = theme.motion
  const enabled = motion.enabled

  return {
    enabled,

    spring: (name) => {
      if (!enabled) return { duration: 0 }
      const token = motion.springs[name]
      return {
        type: 'spring',
        stiffness: token.stiffness / motion.scale,
        damping: token.damping,
        mass: token.mass
      }
    },

    tween: (name, easing = 'standard') => {
      if (!enabled) return { duration: 0 }
      return {
        duration: (motion.durations[name] * motion.scale) / 1000,
        ease: cubicBezierValues(motion.easings[easing])
      }
    },

    loop: (name) => {
      if (!enabled) return null
      return {
        duration: (motion.durations[name] * motion.scale) / 1000,
        repeat: Number.POSITIVE_INFINITY,
        ease: 'linear'
      }
    },

    stagger: (index) => (enabled ? index * motion.stagger * motion.scale : 0),

    when: (animated, still) => (enabled ? animated : still),

    amounts: {
      lift: enabled ? motion.hoverLift : 0,
      press: enabled ? motion.pressScale : 1,
      rubberBand: enabled ? motion.rubberBand : 0
    }
  }
}

/**
 * Motion wants easing as four numbers, tokens store it as a CSS string. Falls
 * back to a sane curve rather than throwing on a malformed user token.
 */
function cubicBezierValues(value: string): [number, number, number, number] {
  const match = /cubic-bezier\(([^)]+)\)/.exec(value)
  if (!match?.[1]) return [0.2, 0, 0, 1]
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
  if (parts.length !== 4 || parts.some(Number.isNaN)) return [0.2, 0, 0, 1]
  return parts as [number, number, number, number]
}

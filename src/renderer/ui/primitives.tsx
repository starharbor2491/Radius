import type { ButtonHTMLAttributes, HTMLAttributes, JSX, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMotionTokens } from '../lib/motion'
import { useRipple } from './useRipple'

export type GlassSurface = 'chrome' | 'panel' | 'popover' | 'overlay'

interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  surface?: GlassSurface
  children?: ReactNode
}

/**
 * The one component that knows what glass looks like. Every panel, popover and
 * bar routes through it so a change to the glass tokens lands everywhere at
 * once.
 */
export function Glass({ surface = 'panel', className, children, ...rest }: GlassProps): JSX.Element {
  return (
    <div
      {...rest}
      data-surface={surface}
      data-radius-part="glass"
      className={['rx-glass', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'primary' | 'outline' | 'danger'
}

/**
 * Press feedback comes from the `press` spring and the `pressScale` amount, so
 * both the physics and the depth are user-tunable, and a ripple starts from
 * wherever the press actually landed.
 */
export function Button({ variant = 'ghost', className, ...rest }: ButtonProps): JSX.Element {
  const { spring, when, amounts } = useMotionTokens()
  const { onPointerDown, ripples } = useRipple()
  return (
    <motion.button
      {...(rest as object)}
      type={rest.type ?? 'button'}
      data-variant={variant}
      data-radius-part="button"
      className={['rx-button', className].filter(Boolean).join(' ')}
      whileTap={when({ scale: amounts.press }, {})}
      transition={spring('press')}
      onPointerDown={(event) => {
        onPointerDown(event)
        rest.onPointerDown?.(event)
      }}
    >
      {rest.children}
      {ripples}
    </motion.button>
  )
}

export function IconButton({
  active,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }): JSX.Element {
  const { spring, when, amounts } = useMotionTokens()
  const { onPointerDown, ripples } = useRipple()
  return (
    <motion.button
      {...(rest as object)}
      type={rest.type ?? 'button'}
      data-active={active ? 'true' : 'false'}
      data-radius-part="icon-button"
      className={['rx-icon-button', className].filter(Boolean).join(' ')}
      whileHover={when({ scale: 1.08, y: -amounts.lift }, {})}
      whileTap={when({ scale: amounts.press, y: 0 }, {})}
      transition={spring('press')}
      onPointerDown={(event) => {
        onPointerDown(event)
        rest.onPointerDown?.(event)
      }}
    >
      {rest.children}
      {ripples}
    </motion.button>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="rx-field" data-radius-part="field">
      <span className="rx-label" data-radius-part="field-label">
        {label}
      </span>
      {children}
    </label>
  )
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}

/** A labelled range bound to a single design token. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange
}: SliderProps): JSX.Element {
  return (
    <div className="rx-field">
      <div className="rx-row-between">
        <span className="rx-label" style={{ marginBottom: 0 }}>
          {label}
        </span>
        <span className="rx-faint">
          {Math.round(value * 100) / 100}
          {suffix}
        </span>
      </div>
      <input
        className="rx-slider"
        data-radius-part="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        /*
         * The track paints its filled portion from this percentage. A range
         * input has no element to size, so the position has to reach CSS as a
         * custom property.
         */
        style={{ ['--rx-slider-fill' as string]: `${fillPercent(value, min, max)}%` }}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
    </div>
  )
}

/** Where the thumb sits, 0..100. A zero-width range would divide by zero. */
function fillPercent(value: number, min: number, max: number): number {
  if (!(max > min)) return 0
  const ratio = (value - min) / (max - min)
  return Math.min(100, Math.max(0, ratio * 100))
}

export function Toast({ message }: { message: string | null }): JSX.Element {
  const { spring } = useMotionTokens()
  return (
    <AnimatePresence>
      {message ? (
        <motion.div
          key={message}
          className="rx-glass rx-toast"
          data-radius-part="toast"
          data-surface="popover"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={spring('popover')}
        >
          {message}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * Load indicator that morphs into the favicon once the page settles.
 *
 * With motion off it stops rotating and becomes a static ring rather than
 * spinning instantly forever -- a zero-duration animation repeating infinitely
 * is a busy loop, not stillness.
 */
export function Spinner(): JSX.Element {
  const { loop } = useMotionTokens()
  const spin = loop('spin')

  return (
    <motion.span
      className="rx-spinner"
      animate={spin ? { rotate: 360 } : undefined}
      transition={spin ?? undefined}
    />
  )
}

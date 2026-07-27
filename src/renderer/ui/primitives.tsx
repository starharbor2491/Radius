import type { ButtonHTMLAttributes, HTMLAttributes, JSX, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMotionTokens } from '../lib/motion'

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
    <div {...rest} data-surface={surface} className={['rx-glass', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'primary' | 'outline' | 'danger'
}

/** Press feedback comes from the `press` spring token, so it is user-tunable. */
export function Button({ variant = 'ghost', className, ...rest }: ButtonProps): JSX.Element {
  const { spring, when } = useMotionTokens()
  return (
    <motion.button
      {...(rest as object)}
      type={rest.type ?? 'button'}
      data-variant={variant}
      className={['rx-button', className].filter(Boolean).join(' ')}
      whileTap={when({ scale: 0.96 }, {})}
      transition={spring('press')}
    />
  )
}

export function IconButton({
  active,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }): JSX.Element {
  const { spring, when } = useMotionTokens()
  return (
    <motion.button
      {...(rest as object)}
      type={rest.type ?? 'button'}
      data-active={active ? 'true' : 'false'}
      className={['rx-icon-button', className].filter(Boolean).join(' ')}
      whileHover={when({ scale: 1.08 }, {})}
      whileTap={when({ scale: 0.92 }, {})}
      transition={spring('press')}
    />
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="rx-field">
      <span className="rx-label">{label}</span>
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
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
    </div>
  )
}

export function Toast({ message }: { message: string | null }): JSX.Element {
  const { spring } = useMotionTokens()
  return (
    <AnimatePresence>
      {message ? (
        <motion.div
          key={message}
          className="rx-glass rx-toast"
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

/** Load indicator that morphs into the favicon once the page settles. */
export function Spinner(): JSX.Element {
  return (
    <motion.span
      style={{
        width: 11,
        height: 11,
        borderRadius: '50%',
        border: '1.5px solid var(--rx-color-border-strong)',
        borderTopColor: 'var(--rx-color-accent)',
        display: 'block'
      }}
      animate={{ rotate: 360 }}
      transition={{ repeat: Number.POSITIVE_INFINITY, ease: 'linear', duration: 0.7 }}
    />
  )
}

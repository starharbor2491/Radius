import { useEffect, useState, type JSX } from 'react'
import { motion } from 'motion/react'
import { MOTION_PRESETS, type MotionTokens } from '@shared/theme'
import { useTheme } from '../theme/ThemeProvider'
import { useMotionTokens, type SpringName } from '../lib/motion'
import { Ramp } from '../ui/Ramp'
import { Button } from '../ui/primitives'

/** Every spring, with what it actually governs. */
const SPRINGS: Array<{ name: SpringName; label: string; governs: string }> = [
  { name: 'tabDrag', label: 'Dragging a tab', governs: 'How a dragged tab follows the pointer and settles.' },
  { name: 'tabHover', label: 'Tab hover', governs: 'The lift and shift when the pointer enters a tab.' },
  { name: 'panel', label: 'Panels', governs: 'Docks opening and closing, group accordions.' },
  { name: 'popover', label: 'Popovers', governs: 'The command palette, omnibox suggestions, toasts.' },
  { name: 'workspaceSwitch', label: 'Workspace switch', governs: 'The cross-fade and parallax between workspaces.' },
  { name: 'press', label: 'Press', governs: 'The sink and rebound when a control is pressed.' }
]

/**
 * The motion tuning UI.
 *
 * A spring is three numbers with no intuitive meaning, so a column of sliders
 * on its own is unusable: you cannot tell what damping 34 feels like by reading
 * it. Every spring here has a preview that runs the actual transition on the
 * actual physics, replayed whenever you move a slider — you tune by feel, which
 * is the only way anyone tunes a spring.
 */
export function MotionStudio(): JSX.Element {
  const { theme, update } = useTheme()
  const tokens = theme.motion
  const [open, setOpen] = useState<SpringName | null>(null)

  const activePreset = (Object.keys(MOTION_PRESETS) as Array<keyof typeof MOTION_PRESETS>).find(
    (id) => {
      const preset = MOTION_PRESETS[id]
      return preset.enabled === tokens.enabled && preset.scale === tokens.scale
    }
  )

  const setSpring = (name: SpringName, patch: Partial<MotionTokens['springs'][SpringName]>): void => {
    update({ motion: { springs: { [name]: patch } } })
  }

  return (
    <div className="rx-card">
      {/* --------------------------------------------------------- presets */}
      <div className="rx-preset-row">
        {(Object.keys(MOTION_PRESETS) as Array<keyof typeof MOTION_PRESETS>).map((id) => (
          <Button
            key={id}
            variant={activePreset === id ? 'primary' : 'outline'}
            onClick={() => update({ motion: MOTION_PRESETS[id] })}
          >
            {id[0]!.toUpperCase() + id.slice(1)}
          </Button>
        ))}
      </div>
      <span className="rx-faint">
        {tokens.enabled
          ? 'Everything below is live. Presets set the first two; the rest stay as you left them.'
          : 'Animation is off. Nothing in the chrome moves — these controls take effect when you turn it back on.'}
      </span>

      <div className="rx-row-between">
        <span className="rx-label rx-label-inline">Animations</span>
        <input
          type="checkbox"
          aria-label="Animations"
          checked={tokens.enabled}
          onChange={(event) => update({ motion: { enabled: event.target.checked } })}
        />
      </div>

      <Ramp
        label="Speed"
        suffix="×"
        min={0.3}
        max={2.5}
        step={0.05}
        value={tokens.scale}
        onChange={(scale) => update({ motion: { scale } })}
      />

      {/* ---------------------------------------------------------- amounts */}
      <Ramp
        label="Hover lift"
        suffix="px"
        min={0}
        max={8}
        step={0.5}
        value={tokens.hoverLift}
        onChange={(hoverLift) => update({ motion: { hoverLift } })}
      />
      <Ramp
        label="Press depth"
        min={0.85}
        max={1}
        step={0.005}
        value={tokens.pressScale}
        onChange={(pressScale) => update({ motion: { pressScale } })}
      />
      <Ramp
        label="Ripple"
        min={0}
        max={0.6}
        step={0.01}
        value={tokens.ripple}
        onChange={(ripple) => update({ motion: { ripple } })}
      />
      <Ramp
        label="Rubber band"
        min={0}
        max={1}
        step={0.05}
        value={tokens.rubberBand}
        onChange={(rubberBand) => update({ motion: { rubberBand } })}
      />
      <Ramp
        label="Stagger"
        suffix="s"
        min={0}
        max={0.12}
        step={0.002}
        value={tokens.stagger}
        onChange={(stagger) => update({ motion: { stagger } })}
      />

      {/* ---------------------------------------------------------- springs */}
      <div className="rx-section-title">Springs</div>
      {SPRINGS.map((entry) => (
        <div key={entry.name} className="rx-spring">
          <button
            type="button"
            className="rx-disclosure"
            aria-expanded={open === entry.name}
            onClick={() => setOpen(open === entry.name ? null : entry.name)}
          >
            <span className="rx-disclosure-label">{entry.label}</span>
            <SpringPreview name={entry.name} />
          </button>

          {open === entry.name ? (
            <div className="rx-spring-body">
              <span className="rx-faint">{entry.governs}</span>
              <Ramp
                label="Stiffness"
                min={80}
                max={1400}
                step={10}
                value={tokens.springs[entry.name].stiffness}
                onChange={(stiffness) => setSpring(entry.name, { stiffness })}
              />
              <Ramp
                label="Damping"
                min={4}
                max={90}
                value={tokens.springs[entry.name].damping}
                onChange={(damping) => setSpring(entry.name, { damping })}
              />
              <Ramp
                label="Mass"
                min={0.2}
                max={4}
                step={0.05}
                value={tokens.springs[entry.name].mass}
                onChange={(mass) => setSpring(entry.name, { mass })}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/**
 * A dot that runs the named spring, end to end, on a loop.
 *
 * It restarts whenever the spring's numbers change, so moving a slider shows
 * you the result immediately rather than on the next time you happen to use the
 * feature. Overshoot is visible on purpose: an under-damped spring is exactly
 * what a user needs to see before they ship it to themselves.
 */
function SpringPreview({ name }: { name: SpringName }): JSX.Element {
  const { theme } = useTheme()
  const { spring, enabled } = useMotionTokens()
  const token = theme.motion.springs[name]
  const [at, setAt] = useState(0)

  // Key the cycle on the token values so an edit replays it.
  const signature = `${token.stiffness}-${token.damping}-${token.mass}`

  useEffect(() => {
    if (!enabled) {
      setAt(0)
      return
    }
    setAt(0)
    const timer = window.setInterval(() => setAt((current) => (current === 0 ? 1 : 0)), 1100)
    const kick = window.setTimeout(() => setAt(1), 120)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(kick)
    }
  }, [signature, enabled])

  return (
    <span className="rx-spring-preview" aria-hidden>
      <motion.span
        className="rx-spring-dot"
        animate={{ x: at === 1 ? 'calc(100% * 4)' : 0 }}
        transition={spring(name)}
      />
    </span>
  )
}

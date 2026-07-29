import type { JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { formatBinding } from '@shared/keybindings'
import { useIsMac, usePendingChord } from '../lib/commands'
import { useMotionTokens } from '../lib/motion'

/** At most this many continuations; a chord prefix with ten of them is a menu. */
const MAX_SHOWN = 5

/**
 * What a half-typed chord looks like.
 *
 * A chord prefix necessarily swallows a keystroke, and a swallowed keystroke
 * with no feedback is indistinguishable from a browser that has stopped
 * listening. This says "I got your G, I am waiting for the rest" and lists
 * what would complete it.
 */
export function ChordIndicator(): JSX.Element {
  const chord = usePendingChord()
  const isMac = useIsMac()
  const { spring } = useMotionTokens()

  return (
    <AnimatePresence>
      {chord ? (
        <motion.div
          key="chord"
          className="rx-glass rx-chord-indicator"
          data-surface="popover"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={spring('popover')}
        >
          <span className="rx-chord-typed">
            {chord.keys.map((step, index) => (
              <kbd key={index} className="rx-chord-key">
                {formatBinding(step, isMac)}
              </kbd>
            ))}
            <span className="rx-chord-caret">…</span>
          </span>

          <span className="rx-chord-candidates">
            {chord.candidates.slice(0, MAX_SHOWN).map((candidate) => (
              <span key={candidate.commandId} className="rx-chord-candidate">
                <kbd className="rx-chord-key">{formatBinding(candidate.remaining, isMac)}</kbd>
                {candidate.title}
              </span>
            ))}
            {chord.candidates.length > MAX_SHOWN ? (
              <span className="rx-chord-candidate">
                +{chord.candidates.length - MAX_SHOWN} more
              </span>
            ) : null}
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

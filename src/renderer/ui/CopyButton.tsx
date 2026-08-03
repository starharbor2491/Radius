import { useEffect, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMotionTokens } from '../lib/motion'
import { Icon } from './Icon'

/** How long the checkmark stays before reverting. */
const CONFIRM_MS = 1400

/**
 * Copy, confirmed by the icon itself becoming a checkmark.
 *
 * The alternative is a toast, which puts the confirmation somewhere other than
 * where you were looking. Swapping the glyph in place answers "did that work?"
 * at the point of the question, and reverting on a timer means the button is
 * never left claiming a copy that happened a minute ago.
 */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }): JSX.Element {
  const { spring, when } = useMotionTokens()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), CONFIRM_MS)
    return () => window.clearTimeout(timer)
  }, [state])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      // A denied clipboard is worth saying out loud rather than showing a tick
      // for something that did not happen.
      setState('failed')
    }
  }

  return (
    <button
      type="button"
      className="rx-copy"
      data-state={state}
      title={state === 'failed' ? 'Could not copy' : state === 'copied' ? 'Copied' : label}
      aria-label={label}
      disabled={!text}
      onClick={() => void copy()}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={when<Record<string, number> | false>({ opacity: 0, scale: 0.6 }, false)}
          animate={{ opacity: 1, scale: 1 }}
          exit={when<Record<string, number>>({ opacity: 0, scale: 0.6 }, { opacity: 0 })}
          transition={spring('press')}
          style={{ display: 'grid', placeItems: 'center' }}
        >
          <Icon name={state === 'copied' ? 'check' : state === 'failed' ? 'close' : 'copy'} size={13} />
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

import { useEffect, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMotionTokens } from '../lib/motion'

interface Box {
  top: number
  left: number
  width: number
  height: number
  radius: string
}

/**
 * One ring that travels to whatever has keyboard focus.
 *
 * Tabbing through a dense chrome with a per-element outline reads as a light
 * blinking off here and on over there, and you lose the thread of where you
 * were. A single ring that moves shows the path.
 *
 * Two rules keep this honest. It only appears for *keyboard* focus, tracked the
 * way browsers do it -- a pointer press turns it off, a Tab press turns it back
 * on -- because a ring chasing mouse clicks is noise. And it is decoration
 * layered on top of the real `:focus-visible` outline, never a replacement: if
 * this component fails to measure, focus is still visible, which is not
 * something to leave to a nicety.
 */
export function FocusRing(): JSX.Element {
  const { spring, enabled } = useMotionTokens()
  const [box, setBox] = useState<Box | null>(null)

  useEffect(() => {
    if (!enabled) {
      setBox(null)
      return
    }

    let keyboard = false

    const measure = (): void => {
      const active = document.activeElement
      if (!keyboard || !(active instanceof HTMLElement) || active === document.body) {
        setBox(null)
        return
      }
      const rect = active.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        setBox(null)
        return
      }
      setBox({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        // Follow the element's own corner radius, so the ring fits a pill as
        // well as it fits a square.
        radius: window.getComputedStyle(active).borderRadius || 'var(--rx-radius-md)'
      })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        keyboard = true
        // Focus moves after the keydown, so measure on the next frame.
        requestAnimationFrame(measure)
      }
    }
    const onPointerDown = (): void => {
      keyboard = false
      setBox(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('focusin', measure)
    window.addEventListener('focusout', measure)
    // A scrolling panel moves the focused element out from under the ring.
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('focusin', measure)
      window.removeEventListener('focusout', measure)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [enabled])

  return (
    <AnimatePresence>
      {box ? (
        <motion.div
          className="rx-focus-ring"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height
          }}
          exit={{ opacity: 0 }}
          style={{ borderRadius: box.radius }}
          transition={spring('popover')}
        />
      ) : null}
    </AnimatePresence>
  )
}

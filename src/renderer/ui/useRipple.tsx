import { useCallback, useState, type PointerEvent as ReactPointerEvent, type JSX } from 'react'
import { useMotionTokens } from '../lib/motion'

interface Ripple {
  id: number
  x: number
  y: number
  size: number
}

/**
 * Press ripple, from the point you actually pressed.
 *
 * A ripple that always starts at the centre of a control is a decoration; one
 * that starts under your finger is feedback, because it confirms *where* the
 * press landed. That matters most on the controls where it is easy to miss --
 * a 28px icon button next to five others.
 *
 * The element is absolutely positioned inside the control, so the control needs
 * `position: relative` and `overflow: hidden`; every class this is used from has
 * both. Amplitude comes from the `ripple` token, and zero removes the effect
 * entirely rather than making it invisible-but-still-rendering.
 */
export function useRipple(): {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  ripples: JSX.Element | null
} {
  const { enabled } = useMotionTokens()
  const [ripples, setRipples] = useState<Ripple[]>([])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return
      const rect = event.currentTarget.getBoundingClientRect()
      // Reach the furthest corner, so the ripple always covers the control.
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const size =
        2 * Math.max(Math.hypot(x, y), Math.hypot(rect.width - x, y), Math.hypot(x, rect.height - y), Math.hypot(rect.width - x, rect.height - y))

      const id = Date.now() + Math.random()
      setRipples((current) => [...current, { id, x, y, size }])
      // Clear on a timer rather than on animationend: a control unmounted
      // mid-press never fires the event, and the array would grow forever.
      window.setTimeout(() => {
        setRipples((current) => current.filter((ripple) => ripple.id !== id))
      }, 600)
    },
    [enabled]
  )

  return {
    onPointerDown,
    ripples:
      ripples.length === 0 ? null : (
        <>
          {ripples.map((ripple) => (
            <span
              key={ripple.id}
              className="rx-ripple"
              style={{
                left: ripple.x,
                top: ripple.y,
                ['--rx-ripple-size' as string]: `${Math.round(ripple.size)}px`
              }}
            />
          ))}
        </>
      )
  }
}

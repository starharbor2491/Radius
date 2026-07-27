import { useEffect, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useActiveTab } from '../store/useAppStore'
import { useUiStore } from '../store/useUiStore'
import { bridge, send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { IconButton } from '../ui/primitives'

/**
 * Find in page.
 *
 * Lives in the chrome strip rather than as an overlay, so the page stays
 * interactive and scrollable while you search it -- overlay mode would make the
 * whole page inert (see RadiusWindow).
 */
export function FindBar(): JSX.Element {
  const tab = useActiveTab()
  const { findOpen, setFindOpen } = useUiStore()
  const { spring } = useMotionTokens()

  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [result, setResult] = useState<{ active: number; total: number } | null>(null)

  useEffect(() => {
    return bridge.on('find:result', (payload) => {
      if (payload.tabId !== tab?.id) return
      setResult({ active: payload.activeMatchOrdinal, total: payload.matches })
    })
  }, [tab?.id])

  useEffect(() => {
    if (findOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [findOpen])

  // A new or edited query opens a fresh session (`findNext: true`).
  useEffect(() => {
    if (!findOpen || !tab) return
    if (!query) {
      setResult(null)
      send('find:stop', { tabId: tab.id, keepSelection: false })
      return
    }
    const timer = window.setTimeout(() => {
      send('find:start', { tabId: tab.id, query, forward: true, findNext: true, matchCase })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [query, matchCase, findOpen, tab?.id])

  /** Steps within the open session, which is what `findNext: false` means. */
  const step = (forward: boolean): void => {
    if (!tab || !query) return
    send('find:start', { tabId: tab.id, query, forward, findNext: false, matchCase })
  }

  const close = (): void => {
    if (tab) send('find:stop', { tabId: tab.id, keepSelection: false })
    setFindOpen(false)
    setResult(null)
  }

  return (
    <AnimatePresence initial={false}>
      {findOpen ? (
        <motion.div
          key="find"
          className="rx-glass rx-find"
          data-surface="popover"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={spring('popover')}
        >
          <input
            ref={inputRef}
            className="rx-input"
            style={{ border: 'none', background: 'transparent' }}
            placeholder="Find in page"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                step(!event.shiftKey)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
          />

          <span className="rx-faint" style={{ minWidth: 56, textAlign: 'right' }}>
            {query ? (result ? `${result.active}/${result.total}` : '…') : ''}
          </span>

          <IconButton
            aria-label="Match case"
            title="Match case"
            active={matchCase}
            onClick={() => setMatchCase((current) => !current)}
          >
            Aa
          </IconButton>
          <IconButton aria-label="Previous match" title="Previous  ⇧⏎" onClick={() => step(false)}>
            ↑
          </IconButton>
          <IconButton aria-label="Next match" title="Next  ⏎" onClick={() => step(true)}>
            ↓
          </IconButton>
          <IconButton aria-label="Close find" title="Close  Esc" onClick={close}>
            ✕
          </IconButton>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

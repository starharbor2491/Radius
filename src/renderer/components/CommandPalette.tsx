import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useUiStore } from '../store/useUiStore'
import { useMotionTokens } from '../lib/motion'
import type { Command } from '../lib/commands'

/**
 * ⌘K over the same command list the menu bar and keyboard shortcuts use, so a
 * command is defined once and reachable three ways.
 */
export function CommandPalette({ commands }: { commands: Command[] }): JSX.Element {
  const { paletteOpen, setPaletteOpen } = useUiStore()
  const { spring, tween, stagger } = useMotionTokens()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (paletteOpen) {
      setQuery('')
      setSelected(0)
      // The palette mounts inside AnimatePresence; focus after the frame lands.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [paletteOpen])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const available = commands.filter((command) => command.enabled !== false)
    if (!needle) return available.slice(0, 12)
    return available
      .filter((command) => command.title.toLowerCase().includes(needle) || command.id.includes(needle))
      .slice(0, 12)
  }, [commands, query])

  const run = (index: number): void => {
    const command = matches[index]
    if (!command) return
    setPaletteOpen(false)
    command.run()
  }

  return (
    <AnimatePresence>
      {paletteOpen ? (
        <motion.div
          className="rx-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tween('fast')}
          onClick={() => setPaletteOpen(false)}
        >
          <motion.div
            className="rx-glass rx-palette"
            data-surface="overlay"
            initial={{ opacity: 0, scale: 0.96, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={spring('popover')}
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={inputRef}
              className="rx-palette-input"
              placeholder="Type a command…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelected(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setSelected((current) => Math.min(current + 1, matches.length - 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSelected((current) => Math.max(current - 1, 0))
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  run(selected)
                } else if (event.key === 'Escape') {
                  setPaletteOpen(false)
                }
              }}
            />

            <div className="rx-palette-list">
              {matches.length === 0 ? (
                <div className="rx-faint" style={{ padding: 'var(--rx-space-3)' }}>
                  No matching commands.
                </div>
              ) : null}

              {matches.map((command, index) => (
                <motion.div
                  key={command.id}
                  className="rx-suggestion"
                  data-selected={index === selected ? 'true' : 'false'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...tween('fast'), delay: stagger(index) }}
                  onMouseEnter={() => setSelected(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    run(index)
                  }}
                >
                  <span className="rx-suggestion-label">{command.title}</span>
                  {command.shortcut ? <span className="rx-faint">{command.shortcut}</span> : null}
                </motion.div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

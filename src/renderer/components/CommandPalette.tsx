import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useUiStore } from '../store/useUiStore'
import { useMotionTokens } from '../lib/motion'
import type { Command } from '../lib/commands'

/**
 * Fallback grouping, by the first segment of a command id.
 *
 * `Command.group` is the real source; this only catches commands registered
 * before the field existed, so an unlabelled command lands under a heading
 * rather than in a pile called "Other".
 */
const GROUP_BY_PREFIX: Record<string, string> = {
  tab: 'Tabs',
  tabs: 'Tabs',
  workspace: 'Workspaces',
  group: 'Tabs',
  bookmark: 'Bookmarks',
  history: 'History',
  downloads: 'Downloads',
  find: 'Page',
  zoom: 'Page',
  page: 'Page',
  ai: 'Assistant',
  agent: 'Assistant',
  theme: 'Appearance',
  layout: 'Appearance',
  sidebar: 'Window',
  panel: 'Window',
  palette: 'Window',
  settings: 'Window'
}

/**
 * ⌘K over the same command list the menu bar and keyboard shortcuts use, so a
 * command is defined once and reachable three ways.
 */
export function CommandPalette({ commands }: { commands: Command[] }): JSX.Element {
  const { paletteOpen, setPaletteOpen } = useUiStore()
  const { spring, tween, stagger } = useMotionTokens()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
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

  /*
   * Matching used to stop at twelve results with nothing to say it had. A
   * search that silently discards what you asked for is worse than a long list:
   * the list scrolls, and the count says how much there is.
   */
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const available = commands.filter((command) => command.enabled !== false)
    if (!needle) return available
    return available.filter(
      (command) => command.title.toLowerCase().includes(needle) || command.id.includes(needle)
    )
  }, [commands, query])

  /*
   * Grouped, because forty flat rows is a list you scan rather than read. The
   * group comes from the command's own `group`, falling back to its id prefix
   * so a command that predates the field still lands somewhere sensible.
   */
  const groups = useMemo(() => {
    const order: string[] = []
    const byGroup = new Map<string, Command[]>()
    for (const command of matches) {
      const declared = (command as Command & { group?: string }).group
      const name = declared ?? GROUP_BY_PREFIX[command.id.split('.')[0] ?? ''] ?? 'Other'
      if (!byGroup.has(name)) {
        byGroup.set(name, [])
        order.push(name)
      }
      byGroup.get(name)!.push(command)
    }
    // Flat index alongside the grouping, so arrow keys cross group boundaries.
    let index = 0
    return order.map((name) => ({
      name,
      rows: byGroup.get(name)!.map((command) => ({ command, index: index++ }))
    }))
  }, [matches])

  /*
   * Keep the selection on screen. The list scrolls now, so arrowing down used
   * to walk the highlight off the bottom edge into a row nobody could see --
   * which reads exactly like the keyboard having stopped working.
   */
  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-index="${selected}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selected])

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
            data-radius-part="command-palette"
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

            <div className="rx-palette-list" ref={listRef}>
              {matches.length === 0 ? (
                <div className="rx-palette-empty">
                  Nothing matches “{query.trim()}”. Commands are searchable by name.
                </div>
              ) : null}

              {groups.map((group) => (
                <section key={group.name}>
                  <div className="rx-section-title">{group.name}</div>
                  {group.rows.map(({ command, index }) => (
                    <motion.div
                      key={command.id}
                      className="rx-suggestion"
                      data-index={index}
                      data-selected={index === selected ? 'true' : 'false'}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...tween('fast'), delay: stagger(Math.min(index, 8)) }}
                      onMouseEnter={() => setSelected(index)}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        run(index)
                      }}
                    >
                      <span className="rx-suggestion-label">{command.title}</span>
                      {command.shortcut ? (
                        <kbd className="rx-kbd">{command.shortcut}</kbd>
                      ) : null}
                    </motion.div>
                  ))}
                </section>
              ))}
            </div>

            {matches.length > 0 ? (
              <div className="rx-palette-footer">
                <span>
                  {matches.length} command{matches.length === 1 ? '' : 's'}
                </span>
                <span>↑↓ to move · ↵ to run · esc to close</span>
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  displayHost,
  formatUrlForDisplay,
  parseOmniboxInput,
  resolveSearchEngine
} from '@shared/url'
import { useActiveTab, useAppStore, useWorkspaceTabs } from '../store/useAppStore'
import { useUiStore } from '../store/useUiStore'
import { send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Icon } from '../ui/Icon'

interface Suggestion {
  kind: 'go' | 'search' | 'tab' | 'bookmark'
  label: string
  detail: string
  run: () => void
}

/**
 * One field for destinations, open tabs, bookmarks and searches.
 *
 * The first row always reflects `parseOmniboxInput`, the same function main
 * uses to decide what typed text means -- so the preview can never disagree
 * with what pressing Enter actually does.
 */
export function Omnibox(): JSX.Element {
  const activeTab = useActiveTab()
  const tabs = useWorkspaceTabs()
  const bookmarks = useAppStore((store) => store.state.bookmarks)
  const engineId = useAppStore((store) => store.state.settings.searchEngineId)
  const { omniboxFocused, setOmniboxFocused } = useUiStore()
  const { spring, tween, stagger, when } = useMotionTokens()

  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState(0)

  // Track the active tab's URL while the user is not editing.
  useEffect(() => {
    if (!omniboxFocused) setDraft(activeTab?.url && activeTab.url !== 'about:blank' ? activeTab.url : '')
  }, [activeTab?.url, omniboxFocused])

  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('radius:focus-omnibox', focus)
    return () => window.removeEventListener('radius:focus-omnibox', focus)
  }, [])

  const engine = resolveSearchEngine(typeof engineId === 'string' ? engineId : undefined)

  const suggestions = useMemo<Suggestion[]>(() => {
    const query = draft.trim()
    if (!query) return []

    const intent = parseOmniboxInput(query, engine)
    const navigate = (url: string): void => {
      if (activeTab) send('tabs:navigate', { tabId: activeTab.id, url })
      else send('tabs:create', { url })
    }

    const primary: Suggestion =
      intent.kind === 'url'
        ? { kind: 'go', label: intent.url, detail: 'Open', run: () => navigate(intent.url) }
        : {
            kind: 'search',
            label: intent.query,
            detail: `Search ${engine.name}`,
            run: () => navigate(intent.url)
          }

    const lowered = query.toLowerCase()
    const matchedTabs = tabs
      .filter(
        (tab) =>
          tab.id !== activeTab?.id &&
          (tab.title.toLowerCase().includes(lowered) || tab.url.toLowerCase().includes(lowered))
      )
      .slice(0, 4)
      .map<Suggestion>((tab) => ({
        kind: 'tab',
        label: tab.title || displayHost(tab.url),
        detail: displayHost(tab.url),
        run: () => send('tabs:activate', { tabId: tab.id })
      }))

    const matchedBookmarks = bookmarks
      .filter(
        (bookmark) =>
          bookmark.title.toLowerCase().includes(lowered) ||
          bookmark.url.toLowerCase().includes(lowered) ||
          bookmark.tags.some((tag) => tag.toLowerCase().includes(lowered))
      )
      .slice(0, 4)
      .map<Suggestion>((bookmark) => ({
        kind: 'bookmark',
        label: bookmark.title || displayHost(bookmark.url),
        detail: displayHost(bookmark.url),
        run: () => navigate(bookmark.url)
      }))

    return [primary, ...matchedTabs, ...matchedBookmarks]
  }, [draft, engine, tabs, bookmarks, activeTab])

  const commit = (index: number): void => {
    const suggestion = suggestions[index]
    if (!suggestion) return
    suggestion.run()
    inputRef.current?.blur()
    setOmniboxFocused(false)
  }

  /*
   * What is shown when nobody is typing. A raw URL in a text field is a field
   * of undifferentiated grey that truncates from the wrong end -- the host, the
   * only part that says who you are talking to, disappears first. This puts the
   * host in full text at a readable weight and lets the path be the thing that
   * gets cut.
   */
  const display = omniboxFocused ? null : formatUrlForDisplay(draft)

  return (
    <div className="rx-omnibox" data-radius-part="omnibox">
      {display ? (
        <button
          type="button"
          className="rx-omnibox-display"
          data-security={display.security}
          title={draft}
          onClick={() => {
            inputRef.current?.focus()
            inputRef.current?.select()
          }}
        >
          <Icon
            name={
              display.security === 'secure'
                ? 'lock'
                : display.security === 'plain'
                  ? 'lock-open'
                  : 'page'
            }
            size={13}
          />
          <span className="rx-omnibox-url">
            {display.prefix ? <span className="rx-omnibox-dim">{display.prefix}</span> : null}
            <span className="rx-omnibox-host">{display.host}</span>
            {display.rest ? <span className="rx-omnibox-dim">{display.rest}</span> : null}
          </span>
        </button>
      ) : null}

      <motion.input
        ref={inputRef}
        className="rx-omnibox-input"
        data-hidden={display ? 'true' : 'false'}
        value={draft}
        spellCheck={false}
        placeholder={`Search ${engine.name} or enter an address`}
        animate={{ scaleX: 1 }}
        whileFocus={{ scale: 1.005 }}
        transition={spring('popover')}
        onChange={(event) => {
          setDraft(event.target.value)
          setSelected(0)
        }}
        onFocus={() => setOmniboxFocused(true)}
        onBlur={() => {
          // Let a click on a suggestion land before the list unmounts.
          window.setTimeout(() => setOmniboxFocused(false), 120)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSelected((current) => Math.min(current + 1, suggestions.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSelected((current) => Math.max(current - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            commit(selected)
          } else if (event.key === 'Escape') {
            inputRef.current?.blur()
            setOmniboxFocused(false)
          }
        }}
      />

      <AnimatePresence>
        {omniboxFocused && suggestions.length > 0 ? (
          <motion.div
            className="rx-glass rx-suggestions"
            data-surface="popover"
            /*
             * Morph, not drop.
             *
             * The panel grows out of the pill: it starts the pill's own width
             * and radius and expands to its full size, so the two read as one
             * object changing shape rather than a menu appearing beneath an
             * unrelated field. `scaleY` from the top edge is what sells it --
             * the panel unrolls downward from where the field already is.
             */
            style={{ originY: 0, originX: 0.5 }}
            initial={when(
              { opacity: 0, scaleY: 0.6, y: -10, borderRadius: 'var(--rx-radius-pill)' },
              { opacity: 0 }
            )}
            animate={{ opacity: 1, scaleY: 1, y: 0, borderRadius: 'var(--rx-radius-lg)' }}
            exit={when(
              { opacity: 0, scaleY: 0.7, y: -8, borderRadius: 'var(--rx-radius-pill)' },
              { opacity: 0 }
            )}
            transition={spring('popover')}
          >
            {suggestions.map((suggestion, index) => (
              <motion.div
                key={`${suggestion.kind}-${suggestion.label}-${index}`}
                className="rx-suggestion"
                data-selected={index === selected ? 'true' : 'false'}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...tween('fast'), delay: stagger(index) }}
                onMouseEnter={() => setSelected(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  commit(index)
                }}
              >
                <span className="rx-suggestion-kind">{suggestion.detail}</span>
                <span className="rx-suggestion-label">{suggestion.label}</span>
              </motion.div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

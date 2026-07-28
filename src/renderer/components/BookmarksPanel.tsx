import { useMemo, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { displayHost } from '@shared/url'
import { useActiveTab, useAppStore } from '../store/useAppStore'
import { send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Icon } from '../ui/Icon'

/**
 * Bookmarks live in the sidebar under the tab strip rather than in a separate
 * window: they are part of the same "what is in this workspace" surface.
 */
export function BookmarksPanel({ open }: { open: boolean }): JSX.Element {
  const bookmarks = useAppStore((store) => store.state.bookmarks)
  const activeTab = useActiveTab()
  const { spring, tween, stagger } = useMotionTokens()
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return bookmarks
    return bookmarks.filter(
      (bookmark) =>
        bookmark.title.toLowerCase().includes(query) ||
        bookmark.url.toLowerCase().includes(query) ||
        bookmark.tags.some((tag) => tag.toLowerCase().includes(query))
    )
  }, [bookmarks, filter])

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="bookmarks"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={spring('panel')}
          style={{ overflow: 'hidden', flex: 'none', maxHeight: '38%', display: 'flex' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%' }}>
            <div className="rx-section-title">Bookmarks</div>
            <input
              className="rx-input"
              placeholder="Filter bookmarks"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="rx-tabs" style={{ marginTop: 'var(--rx-space-1)' }}>
              {filtered.length === 0 ? (
                <div className="rx-faint" style={{ padding: 'var(--rx-space-2)' }}>
                  {bookmarks.length === 0 ? 'Nothing saved yet.' : 'No matches.'}
                </div>
              ) : null}

              {filtered.map((bookmark, index) => (
                <motion.div
                  key={bookmark.id}
                  className="rx-tab"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...tween('fast'), delay: stagger(index) }}
                  title={bookmark.url}
                  onClick={() => {
                    if (activeTab) send('tabs:navigate', { tabId: activeTab.id, url: bookmark.url })
                    else send('tabs:create', { url: bookmark.url })
                  }}
                >
                  <span className="rx-tab-favicon">
                    {bookmark.faviconUrl ? (
                      <img src={bookmark.faviconUrl} alt="" />
                    ) : (
                      <span>{(displayHost(bookmark.url)[0] ?? '·').toUpperCase()}</span>
                    )}
                  </span>
                  <span className="rx-tab-title">{bookmark.title || displayHost(bookmark.url)}</span>
                  <button
                    className="rx-tab-close"
                    type="button"
                    aria-label="Delete bookmark"
                    onClick={(event) => {
                      event.stopPropagation()
                      send('bookmarks:delete', { bookmarkId: bookmark.id })
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

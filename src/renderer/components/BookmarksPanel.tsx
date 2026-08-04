import { useMemo, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { displayHost } from '@shared/url'
import { useActiveTab, useAppStore } from '../store/useAppStore'
import { send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Icon } from '../ui/Icon'

/** Show the filter field once the list is long enough to need it. */
const FILTER_THRESHOLD = 6

/**
 * Saved pages, under the tab strip.
 *
 * This used to open and show nothing. The panel carried `maxHeight: 38%`, and a
 * percentage max-height resolves against the parent's height -- but the parent
 * is the sidebar footer, which is `flex: none` and sized by its own content. A
 * percentage of a content-sized box is a circular constraint, and CSS resolves
 * it to a small number: the panel clamped to about 80px, which fitted the
 * heading and the filter field and clipped every row. The rows were in the DOM,
 * 20px tall and invisible.
 *
 * The fix is to stop asking for a percentage of nothing. The list takes the
 * space it needs up to a real ceiling in `ch`-independent units, scrolls past
 * that, and the tab strip above gives ground because it is the flexible one.
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

  /** Opens here, or in a new tab for a middle click or a modified click. */
  const open_ = (url: string, newTab: boolean): void => {
    if (newTab || !activeTab) send('tabs:create', { url })
    else send('tabs:navigate', { tabId: activeTab.id, url })
  }

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="bookmarks"
          className="rx-bookmarks"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={spring('panel')}
        >
          {/*
            No heading here: the disclosure that opens this panel is already
            labelled "Bookmarks", and repeating it directly underneath was the
            same word twice in twenty pixels.
          */}
          {bookmarks.length >= FILTER_THRESHOLD ? (
            <input
              className="rx-input rx-bookmarks-filter"
              placeholder="Filter bookmarks"
              aria-label="Filter bookmarks"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          ) : null}

          <div className="rx-bookmarks-list">
            {filtered.length === 0 ? (
              <p className="rx-bookmarks-empty">
                {bookmarks.length === 0
                  ? 'Press the star in the toolbar to save the page you are on.'
                  : `Nothing matches “${filter.trim()}”.`}
              </p>
            ) : null}

            {filtered.map((bookmark, index) => (
              <motion.div
                key={bookmark.id}
                className="rx-tab rx-bookmark"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...tween('fast'), delay: stagger(Math.min(index, 8)) }}
                title={`${bookmark.title || displayHost(bookmark.url)}\n${bookmark.url}`}
                onClick={(event) => open_(bookmark.url, event.metaKey || event.ctrlKey)}
                onAuxClick={(event) => {
                  if (event.button === 1) open_(bookmark.url, true)
                }}
              >
                <span className="rx-tab-favicon">
                  {bookmark.faviconUrl ? (
                    <img src={bookmark.faviconUrl} alt="" />
                  ) : (
                    <span>{(displayHost(bookmark.url)[0] ?? '·').toUpperCase()}</span>
                  )}
                </span>
                <span className="rx-tab-title">
                  {bookmark.title || displayHost(bookmark.url)}
                </span>
                <button
                  className="rx-tab-close"
                  type="button"
                  aria-label={`Remove ${bookmark.title || displayHost(bookmark.url)}`}
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
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

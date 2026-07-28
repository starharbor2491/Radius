import { useEffect, useMemo, useState, type JSX } from 'react'
import { motion } from 'motion/react'
import type { HistoryEntry } from '@shared/types'
import { displayHost } from '@shared/url'
import { useActiveTab, useAppStore } from '../store/useAppStore'
import { bridge, send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Icon } from '../ui/Icon'
import { Button } from '../ui/primitives'

/** Buckets for the day dividers, newest first. */
const RANGES = [
  { label: 'Today', ms: 0 },
  { label: 'Yesterday', ms: 1 },
  { label: 'Earlier this week', ms: 7 },
  { label: 'Older', ms: Number.POSITIVE_INFINITY }
]

export function HistoryPanel(): JSX.Element {
  const snapshotHistory = useAppStore((store) => store.state.history)
  const activeTab = useActiveTab()
  const { tween, stagger } = useMotionTokens()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HistoryEntry[] | null>(null)

  /*
   * The snapshot only carries the most recent slice, so any real search has to
   * go back to main where the full log lives. Debounced because this fires on
   * every keystroke.
   */
  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      return
    }
    const timer = window.setTimeout(() => {
      void bridge
        .invoke('history:search', { query, limit: 200 })
        .then(setResults)
        .catch(() => setResults([]))
    }, 140)
    return () => window.clearTimeout(timer)
  }, [query])

  const entries = results ?? snapshotHistory

  const grouped = useMemo(() => groupByRecency(entries), [entries])

  const open = (url: string): void => {
    if (activeTab) send('tabs:navigate', { tabId: activeTab.id, url })
    else send('tabs:create', { url })
  }

  return (
    <div className="rx-panel-scroll">
      <input
        className="rx-input"
        placeholder="Search history"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />

      {entries.length === 0 ? (
        <div className="rx-faint">{query ? 'No matches.' : 'Nothing visited yet.'}</div>
      ) : null}

      {grouped.map(([label, bucket]) => (
        <section key={label}>
          <div className="rx-section-title">{label}</div>
          {bucket.map((entry, index) => (
            <motion.div
              key={entry.id}
              className="rx-tab"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...tween('fast'), delay: stagger(Math.min(index, 12)) }}
              title={entry.url}
              onClick={() => open(entry.url)}
            >
              <span className="rx-tab-favicon">
                {entry.faviconUrl ? (
                  <img src={entry.faviconUrl} alt="" />
                ) : (
                  <span>{(displayHost(entry.url)[0] ?? '·').toUpperCase()}</span>
                )}
              </span>
              <span className="rx-tab-title">
                {entry.title || displayHost(entry.url)}
                <span className="rx-faint"> · {displayHost(entry.url)}</span>
              </span>
              {entry.visitCount > 1 ? <span className="rx-faint">{entry.visitCount}×</span> : null}
              <button
                className="rx-tab-close"
                type="button"
                aria-label="Forget this page"
                onClick={(event) => {
                  event.stopPropagation()
                  send('history:delete', { entryId: entry.id })
                }}
              >
                <Icon name="close" size={12} />
              </button>
            </motion.div>
          ))}
        </section>
      ))}

      <div className="rx-row" style={{ marginTop: 'var(--rx-space-3)' }}>
        <Button
          variant="outline"
          onClick={() => send('history:clear', { sinceMs: Date.now() - 3_600_000 })}
        >
          <Icon name="history" size={14} />
          Clear last hour
        </Button>
        <Button variant="danger" onClick={() => send('history:clear', { sinceMs: null })}>
          <Icon name="trash" size={14} />
          Clear all
        </Button>
      </div>
    </div>
  )
}

/**
 * Splits entries into Today / Yesterday / this week / older.
 *
 * Uses calendar day boundaries rather than rolling 24-hour windows, because
 * "yesterday" means the previous date to a reader, not 24-48 hours ago.
 */
function groupByRecency(entries: HistoryEntry[]): Array<[string, HistoryEntry[]]> {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const dayMs = 86_400_000

  const buckets = new Map<string, HistoryEntry[]>()
  for (const entry of entries) {
    const daysAgo = Math.floor((startOfToday.getTime() - entry.visitedAt) / dayMs) + 1
    const range = RANGES.find((candidate) => daysAgo <= candidate.ms) ?? RANGES[RANGES.length - 1]!
    buckets.set(range.label, [...(buckets.get(range.label) ?? []), entry])
  }

  return RANGES.map((range) => [range.label, buckets.get(range.label) ?? []] as [string, HistoryEntry[]]).filter(
    ([, bucket]) => bucket.length > 0
  )
}

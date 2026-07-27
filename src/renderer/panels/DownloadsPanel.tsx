import type { JSX } from 'react'
import { motion } from 'motion/react'
import type { DownloadItem } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Button } from '../ui/primitives'

export function DownloadsPanel(): JSX.Element {
  const downloads = useAppStore((store) => store.state.downloads)
  const { spring, tween, stagger } = useMotionTokens()

  if (downloads.length === 0) {
    return (
      <div className="rx-panel-scroll">
        <div className="rx-faint">Nothing downloaded yet.</div>
      </div>
    )
  }

  return (
    <div className="rx-panel-scroll">
      {downloads.map((item, index) => (
        <motion.div
          key={item.id}
          className="rx-card"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...tween('fast'), delay: stagger(Math.min(index, 10)) }}
        >
          <div className="rx-row-between">
            <span className="rx-tab-title" title={item.filename}>
              {item.filename || 'Downloading…'}
            </span>
            <span className="rx-faint">{describe(item)}</span>
          </div>

          {item.state === 'progressing' || item.state === 'paused' ? (
            <div
              style={{
                height: 4,
                borderRadius: 'var(--rx-radius-pill)',
                background: 'var(--rx-color-surface-3)',
                overflow: 'hidden'
              }}
            >
              <motion.div
                style={{ height: '100%', background: 'var(--rx-color-accent)' }}
                animate={{ width: `${progressPercent(item)}%` }}
                transition={spring('panel')}
              />
            </div>
          ) : null}

          <div className="rx-row">
            {item.state === 'completed' ? (
              <>
                <Button variant="outline" onClick={() => send('downloads:open', { id: item.id })}>
                  Open
                </Button>
                <Button variant="outline" onClick={() => send('downloads:reveal', { id: item.id })}>
                  Show in folder
                </Button>
              </>
            ) : null}
            {item.state === 'progressing' || item.state === 'paused' ? (
              <Button variant="outline" onClick={() => send('downloads:cancel', { id: item.id })}>
                Cancel
              </Button>
            ) : null}
            <Button variant="danger" onClick={() => send('downloads:remove', { id: item.id })}>
              Remove
            </Button>
          </div>
        </motion.div>
      ))}

      <Button variant="outline" onClick={() => send('downloads:clearFinished', {})}>
        Clear finished
      </Button>
    </div>
  )
}

/**
 * Percentage complete. Servers often omit content-length, in which case there
 * is no honest percentage to show and the bar sits at zero rather than
 * inventing motion.
 */
function progressPercent(item: DownloadItem): number {
  if (item.totalBytes <= 0) return 0
  return Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))
}

function describe(item: DownloadItem): string {
  switch (item.state) {
    case 'completed':
      return formatBytes(item.receivedBytes)
    case 'cancelled':
      return 'Cancelled'
    case 'interrupted':
      return 'Failed'
    case 'paused':
      return `Paused · ${formatBytes(item.receivedBytes)}`
    default:
      return item.totalBytes > 0
        ? `${formatBytes(item.receivedBytes)} of ${formatBytes(item.totalBytes)}`
        : formatBytes(item.receivedBytes)
  }
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

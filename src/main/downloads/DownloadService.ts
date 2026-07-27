import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { session, shell, type DownloadItem as ElectronDownloadItem } from 'electron'
import type { StateStore } from '../state/StateStore'
import type { DownloadItem } from '@shared/types'

/**
 * Tracks downloads started by page content.
 *
 * Electron hands us the `DownloadItem` object once and expects us to keep it if
 * we want to cancel or pause later, so live items are held in a map keyed by
 * our own id while the persisted record carries only serialisable fields.
 */
export class DownloadService {
  private readonly live = new Map<string, ElectronDownloadItem>()

  constructor(
    private readonly state: StateStore,
    private readonly partition: string
  ) {}

  attach(): void {
    session.fromPartition(this.partition).on('will-download', (_event, item) => {
      const id = randomUUID()
      this.live.set(id, item)

      const record: DownloadItem = {
        id,
        url: item.getURL(),
        filename: item.getFilename(),
        // Empty until the save path is resolved, which happens after the prompt.
        savePath: '',
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
        startedAt: Date.now(),
        completedAt: null
      }
      this.state.upsertDownload(record)

      item.on('updated', (_updateEvent, updateState) => {
        this.state.updateDownload(id, {
          state: updateState === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing',
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes()
        })
      })

      item.once('done', (_doneEvent, doneState) => {
        this.live.delete(id)
        this.state.updateDownload(id, {
          state:
            doneState === 'completed'
              ? 'completed'
              : doneState === 'cancelled'
                ? 'cancelled'
                : 'interrupted',
          receivedBytes: item.getReceivedBytes(),
          completedAt: Date.now()
        })
        // The final path is only trustworthy once the transfer is done.
        const savePath = item.getSavePath()
        if (savePath) {
          this.state.upsertDownload({
            ...this.find(id)!,
            savePath,
            filename: basename(savePath)
          })
        }
      })
    })
  }

  private find(id: string): DownloadItem | undefined {
    return this.state.listDownloads().find((item) => item.id === id)
  }

  cancel(id: string): void {
    this.live.get(id)?.cancel()
  }

  /** Opens a finished download in the OS default application. */
  async open(id: string): Promise<void> {
    const item = this.find(id)
    if (!item?.savePath || item.state !== 'completed') return
    await shell.openPath(item.savePath)
  }

  /** Reveals a finished download in the OS file manager. */
  reveal(id: string): void {
    const item = this.find(id)
    if (!item?.savePath) return
    shell.showItemInFolder(item.savePath)
  }

  remove(id: string): void {
    // Removing a live download implies cancelling it -- leaving the transfer
    // running with no row would be a leak the user cannot see or stop.
    this.cancel(id)
    this.live.delete(id)
    this.state.removeDownload(id)
  }
}

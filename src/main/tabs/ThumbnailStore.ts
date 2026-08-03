import type { RadiusWindow } from '../window/RadiusWindow'

/** Longest edge of a stored thumbnail, in px. */
const THUMB_WIDTH = 320

/**
 * How many thumbnails to keep. Each is a downscaled JPEG data URL, tens of KB;
 * a browser with two hundred tabs should not be holding two hundred of them.
 */
const MAX_THUMBS = 40

/** JPEG quality. High enough to read a headline, low enough to stay small. */
const QUALITY = 62

interface Entry {
  dataUrl: string
  capturedAt: number
}

/**
 * Page thumbnails for the tab strip's hover preview.
 *
 * Capture happens at exactly two moments -- when a tab stops being the active
 * one, and just before it is suspended -- because those are the moments its
 * picture stops changing. Capturing on hover instead would be both too late
 * (the view of a suspended tab no longer exists) and too expensive (a GPU
 * readback per pointer move).
 *
 * Everything here is best-effort and in memory only. A thumbnail is a nicety;
 * failing to get one must never affect the tab, and none of this is written to
 * disk, because a picture of every page you have looked at is a far more
 * sensitive artefact than the history entry it corresponds to.
 */
export class ThumbnailStore {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly window: RadiusWindow) {}

  get(tabId: string): string | null {
    return this.entries.get(tabId)?.dataUrl ?? null
  }

  forget(tabId: string): void {
    this.entries.delete(tabId)
  }

  /**
   * Captures a tab if it still has a live view.
   *
   * Never throws: a capture can fail because the view is gone, because the page
   * is mid-navigation, or because there is no display surface at all (a
   * headless session). All three mean "no thumbnail", not "something is wrong".
   */
  async capture(tabId: string): Promise<void> {
    const view = this.window.getView(tabId)
    if (!view || view.webContents.isDestroyed()) return

    try {
      const image = await view.webContents.capturePage()
      if (image.isEmpty()) return

      const size = image.getSize()
      const height = Math.max(1, Math.round((size.height / size.width) * THUMB_WIDTH))
      const scaled = image.resize({ width: THUMB_WIDTH, height, quality: 'good' })

      this.entries.set(tabId, {
        dataUrl: `data:image/jpeg;base64,${scaled.toJPEG(QUALITY).toString('base64')}`,
        capturedAt: Date.now()
      })
      this.evict()
    } catch {
      // Best effort by design; see the note above.
    }
  }

  /** Drops the least recently captured entries once over the cap. */
  private evict(): void {
    if (this.entries.size <= MAX_THUMBS) return
    const oldest = [...this.entries.entries()]
      .sort((a, b) => a[1].capturedAt - b[1].capturedAt)
      .slice(0, this.entries.size - MAX_THUMBS)
    for (const [tabId] of oldest) this.entries.delete(tabId)
  }
}

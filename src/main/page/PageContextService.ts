import { randomUUID } from 'node:crypto'
import { ipcMain, type WebContents } from 'electron'
import type { PageContext } from '@shared/types'

const EXTRACT_REQUEST = 'radius:extract-request'
const EXTRACT_RESULT = 'radius:extract-result'
const TIMEOUT_MS = 3_000

interface ExtractPayload {
  title: string
  text: string
  selection: string
}

/**
 * Asks a tab's isolated-world preload for its readable text.
 *
 * We do not use `executeJavaScript` for this: that runs in the page's own
 * world, where hostile script can shadow `document.body` or `innerText` and
 * feed us whatever it likes. Going through the preload keeps extraction on the
 * trusted side of the isolation boundary.
 */
export class PageContextService {
  private readonly pending = new Map<string, (payload: ExtractPayload) => void>()

  constructor() {
    ipcMain.on(EXTRACT_RESULT, (_event, requestId: string, payload: ExtractPayload) => {
      const resolve = this.pending.get(requestId)
      if (!resolve) return
      this.pending.delete(requestId)
      resolve(payload)
    })
  }

  async extract(tabId: string, contents: WebContents | undefined, url: string): Promise<PageContext> {
    const empty: PageContext = { tabId, url, title: '', text: '', selection: '' }
    if (!contents || contents.isDestroyed()) return empty

    const requestId = randomUUID()
    const payload = await new Promise<ExtractPayload | null>((resolve) => {
      // A page that never answers must not hang the AI panel forever.
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve(null)
      }, TIMEOUT_MS)

      this.pending.set(requestId, (result) => {
        clearTimeout(timer)
        resolve(result)
      })

      contents.send(EXTRACT_REQUEST, requestId)
    })

    if (!payload) return empty
    return { tabId, url, title: payload.title, text: payload.text, selection: payload.selection }
  }
}

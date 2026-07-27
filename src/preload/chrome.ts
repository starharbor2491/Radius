import { contextBridge, ipcRenderer } from 'electron'
import type {
  IpcChannel,
  IpcEventName,
  IpcEventPayload,
  IpcRequest,
  IpcResponse
} from '@shared/ipc'

/**
 * The chrome's only route to the main process.
 *
 * Everything here is `import type` on purpose. A sandboxed preload can only
 * `require` a short allowlist of built-ins, so pulling zod (or anything else
 * from `@shared/ipc` at runtime) would break the bridge. Payload validation is
 * main's job anyway -- it does not trust this side.
 */

/** Mirrors `ipcEvents` in @shared/ipc. Kept literal so nothing is imported. */
const EVENT_NAMES = ['state:changed', 'ai:stream', 'command:invoke'] as const

export interface RadiusBridge {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResponse<C>>
  on<E extends IpcEventName>(
    event: E,
    listener: (payload: IpcEventPayload<E>) => void
  ): () => void
  platform: NodeJS.Platform
}

const bridge: RadiusBridge = {
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload ?? {})
  },

  on(event, listener) {
    if (!(EVENT_NAMES as readonly string[]).includes(event)) {
      throw new Error(`Unknown Radius event "${event}"`)
    }
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      listener(payload as never)
    }
    ipcRenderer.on(event, handler)
    return () => {
      ipcRenderer.removeListener(event, handler)
    }
  },

  platform: process.platform
}

contextBridge.exposeInMainWorld('radius', bridge)

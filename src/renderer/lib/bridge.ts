import type {
  IpcChannel,
  IpcEventName,
  IpcEventPayload,
  IpcRequest,
  IpcResponse
} from '@shared/ipc'

export interface RadiusBridge {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResponse<C>>
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEventPayload<E>) => void): () => void
  platform: string
}

declare global {
  interface Window {
    radius: RadiusBridge
  }
}

/**
 * Access to the preload bridge, resolved per call rather than at module load.
 *
 * Reading `window.radius` eagerly would make importing any module that touches
 * IPC depend on a live browser environment -- which breaks unit tests and would
 * break again the first time this code ran before the preload had attached.
 */
export const bridge: RadiusBridge = {
  invoke: (channel, payload) => window.radius.invoke(channel, payload),
  on: (event, listener) => window.radius.on(event, listener),
  get platform() {
    return window.radius.platform
  }
}

/**
 * Fire-and-forget wrapper for calls whose failure should not break the UI.
 *
 * Most chrome interactions are idempotent view commands -- activating a tab,
 * reporting insets. If one fails there is nothing useful to show the user, and
 * an unhandled rejection would be noise.
 */
export function send<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): void {
  void bridge.invoke(channel, payload).catch((error: unknown) => {
    console.error(`ipc ${channel} failed`, error)
  })
}

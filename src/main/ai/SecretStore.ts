import { safeStorage } from 'electron'
import type { JsonStore } from '../store/JsonStore'

/**
 * API keys, encrypted at rest with the OS keychain via Electron's safeStorage.
 *
 * The only place plaintext exists is inside this class and the fetch call that
 * consumes it. Nothing here is ever returned over IPC -- the renderer learns
 * that a key exists (`has`) and never what it is.
 */
export class SecretStore {
  constructor(private readonly store: JsonStore) {}

  /**
   * False when the platform has no usable keychain. On Linux this happens with
   * no gnome-keyring/kwallet available, where safeStorage silently falls back
   * to a `basic_text` backend that is obfuscation, not encryption -- so we
   * refuse to store anything rather than imply a guarantee we cannot keep.
   */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /** Name of the backing keychain, surfaced in Settings so the user can see it. */
  backend(): string {
    if (process.platform === 'darwin') return 'keychain'
    if (process.platform === 'win32') return 'dpapi'
    try {
      return safeStorage.getSelectedStorageBackend()
    } catch {
      return 'unknown'
    }
  }

  set(key: string, plaintext: string): void {
    if (!this.isAvailable()) {
      throw new Error(
        'No OS keychain is available, so API keys cannot be stored securely. ' +
          'Install gnome-keyring or kwallet, or run Radius with a key in the environment.'
      )
    }
    const ciphertext = safeStorage.encryptString(plaintext).toString('base64')
    const existing = this.store.data.secrets.find((secret) => secret.key === key)
    if (existing) {
      existing.ciphertext = ciphertext
      existing.updatedAt = Date.now()
    } else {
      this.store.data.secrets.push({ key, ciphertext, updatedAt: Date.now() })
    }
    this.store.touch()
    // A key is worth an immediate write; losing it to a crash is user-visible.
    this.store.flush()
  }

  get(key: string): string | null {
    const record = this.store.data.secrets.find((secret) => secret.key === key)
    if (!record || !this.isAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(record.ciphertext, 'base64'))
    } catch {
      // A key encrypted under a different OS profile is unreadable, not fatal.
      return null
    }
  }

  has(key: string): boolean {
    return this.store.data.secrets.some((secret) => secret.key === key)
  }

  delete(key: string): void {
    const secrets = this.store.data.secrets.filter((secret) => secret.key !== key)
    this.store.data.secrets.length = 0
    this.store.data.secrets.push(...secrets)
    this.store.touch()
    this.store.flush()
  }

  static keyFor(providerId: string): string {
    return `provider:${providerId}:apiKey`
  }
}

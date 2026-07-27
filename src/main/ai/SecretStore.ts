import { safeStorage } from 'electron'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { schema } from '../db'

/**
 * API keys, encrypted at rest with the OS keychain via Electron's safeStorage.
 *
 * The only place plaintext exists is inside this class and the fetch call that
 * consumes it. Nothing here is ever returned over IPC -- the renderer learns
 * that a key exists (`has`) and never what it is.
 */
export class SecretStore {
  constructor(private readonly db: Db) {}

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
    if (process.platform !== 'linux') return process.platform === 'darwin' ? 'keychain' : 'dpapi'
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
    this.db
      .insert(schema.secrets)
      .values({ key, ciphertext, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: schema.secrets.key,
        set: { ciphertext, updatedAt: Date.now() }
      })
      .run()
  }

  get(key: string): string | null {
    const row = this.db.select().from(schema.secrets).where(eq(schema.secrets.key, key)).get()
    if (!row) return null
    if (!this.isAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(row.ciphertext, 'base64'))
    } catch {
      // A key encrypted under a different OS profile is unreadable, not fatal.
      return null
    }
  }

  has(key: string): boolean {
    return this.db.select().from(schema.secrets).where(eq(schema.secrets.key, key)).get() !== undefined
  }

  delete(key: string): void {
    this.db.delete(schema.secrets).where(eq(schema.secrets.key, key)).run()
  }

  static keyFor(providerId: string): string {
    return `provider:${providerId}:apiKey`
  }
}

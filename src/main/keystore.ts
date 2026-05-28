import { safeStorage, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const KEY_FILE = (): string => join(app.getPath('userData'), '.apikey')

export function saveApiKey(key: string): void {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key)
      writeFileSync(KEY_FILE(), encrypted)
    } else {
      // Fallback: plain text (testing only)
      writeFileSync(KEY_FILE(), `plain:${key}`)
    }
  } catch (e) {
    console.error('[keystore] save failed:', e)
  }
}

export function loadApiKey(): string | null {
  try {
    const path = KEY_FILE()
    if (!existsSync(path)) return null
    const buf = readFileSync(path)
    if (buf.slice(0, 6).toString() === 'plain:') {
      return buf.slice(6).toString('utf-8')
    }
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf)
    }
    return null
  } catch {
    return null
  }
}

export function deleteApiKey(): void {
  try {
    const path = KEY_FILE()
    if (existsSync(path)) {
      writeFileSync(path, Buffer.alloc(0))
    }
  } catch { /* noop */ }
}

export function hasApiKey(): boolean {
  return !!loadApiKey()
}

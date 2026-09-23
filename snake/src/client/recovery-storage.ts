const databaseName = 'snake-client'
const keyFor = (code: string): string => `snake.recovery-token.${code.toUpperCase()}`

export interface RecoveryTokenStorage {
  get: (code: string) => Promise<string | null>
  set: (code: string, token: string) => Promise<void>
}

export function createRecoveryTokenStorage(): RecoveryTokenStorage {
  const fallback = (): Storage | null => { try { return globalThis.localStorage } catch { return null } }
  if (typeof indexedDB === 'undefined') return { get: async code => fallback()?.getItem(keyFor(code)) ?? null, set: async (code, token) => { fallback()?.setItem(keyFor(code), token) } }
  let database: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings') }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const recover = async <T>(work: (db: IDBDatabase) => Promise<T>, fallbackValue: () => T): Promise<T> => { try { return await work(await open()) } catch { return fallbackValue() } }
  return {
    get: code => recover(db => new Promise(resolve => { const request = db.transaction('settings').objectStore('settings').get(keyFor(code)); request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null); request.onerror = () => resolve(fallback()?.getItem(keyFor(code)) ?? null) }), () => fallback()?.getItem(keyFor(code)) ?? null),
    set: (code, token) => recover(db => new Promise<void>((resolve, reject) => { const request = db.transaction('settings', 'readwrite').objectStore('settings').put(token, keyFor(code)); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) }), () => { fallback()?.setItem(keyFor(code), token) }),
  }
}

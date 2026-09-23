const KEY = 'snake.display-name'

export interface DisplayNameStorage {
  get: () => Promise<string | null>
  set: (name: string) => Promise<void>
}

export function createDisplayNameStorage(): DisplayNameStorage {
  const fallback = (): Storage | null => {
    try { return globalThis.localStorage } catch { return null }
  }
  if (typeof indexedDB === 'undefined') return { get: async () => fallback()?.getItem(KEY) ?? null, set: async name => { fallback()?.setItem(KEY, name) } }
  let database: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('snake-client', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('settings')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const recover = async <T>(work: (db: IDBDatabase) => Promise<T>, fallbackValue: () => T): Promise<T> => { try { return await work(await open()) } catch { return fallbackValue() } }
  return {
    get: () => recover(db => new Promise(resolve => { const request = db.transaction('settings').objectStore('settings').get(KEY); request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null); request.onerror = () => resolve(fallback()?.getItem(KEY) ?? null) }), () => fallback()?.getItem(KEY) ?? null),
    set: name => recover(db => new Promise<void>((resolve, reject) => { const request = db.transaction('settings', 'readwrite').objectStore('settings').put(name, KEY); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) }), () => { fallback()?.setItem(KEY, name) }),
  }
}

/**
 * Where the SQLite database file lives.
 *
 * Browser/dev build: IndexedDB (atomic writes, survives reloads and browser restarts).
 * Desktop build (planned): a file in the app data directory via Tauri.
 * The rest of the app only sees this interface.
 */
export interface BackupInfo {
  id: number
  createdAt: string
  reason: string
  size: number
}

export interface SnapshotStore {
  readonly description: string
  load(): Promise<Uint8Array | null>
  save(bytes: Uint8Array): Promise<void>
  listBackups(): Promise<BackupInfo[]>
  addBackup(bytes: Uint8Array, reason: string): Promise<void>
  loadBackup(id: number): Promise<Uint8Array | null>
}

export const MAX_BACKUPS = 12

export class MemorySnapshotStore implements SnapshotStore {
  readonly description = 'In-memory (tests)'
  main: Uint8Array | null = null
  backups: Array<BackupInfo & { bytes: Uint8Array }> = []
  private nextId = 1

  async load() {
    return this.main ? new Uint8Array(this.main) : null
  }
  async save(bytes: Uint8Array) {
    this.main = new Uint8Array(bytes)
  }
  async listBackups() {
    return this.backups.map(({ bytes: _bytes, ...info }) => info).reverse()
  }
  async addBackup(bytes: Uint8Array, reason: string) {
    this.backups.push({ id: this.nextId++, createdAt: new Date().toISOString(), reason, size: bytes.byteLength, bytes: new Uint8Array(bytes) })
    while (this.backups.length > MAX_BACKUPS) this.backups.shift()
  }
  async loadBackup(id: number) {
    return this.backups.find((b) => b.id === id)?.bytes ?? null
  }
}

const DB_NAME = 'exyu-titl-studio'
const DB_VERSION = 1

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export class IndexedDbSnapshotStore implements SnapshotStore {
  readonly description = 'Browser storage (IndexedDB) on this computer'
  private dbPromise: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('main')) db.createObjectStore('main')
          if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true })
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('Storage is blocked by another open window of the app.'))
      })
    }
    return this.dbPromise
  }

  async load(): Promise<Uint8Array | null> {
    const db = await this.open()
    const value = await request(db.transaction('main', 'readonly').objectStore('main').get('database'))
    return value ? new Uint8Array(value as ArrayBuffer) : null
  }

  async save(bytes: Uint8Array): Promise<void> {
    const db = await this.open()
    const tx = db.transaction('main', 'readwrite')
    // Store a copy as ArrayBuffer; the put is atomic within the transaction.
    tx.objectStore('main').put(bytes.slice().buffer, 'database')
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('Save aborted (storage full?)'))
    })
  }

  async listBackups(): Promise<BackupInfo[]> {
    const db = await this.open()
    const all = (await request(db.transaction('backups', 'readonly').objectStore('backups').getAll())) as Array<BackupInfo & { bytes: ArrayBuffer }>
    return all.map(({ id, createdAt, reason, size }) => ({ id, createdAt, reason, size })).reverse()
  }

  async addBackup(bytes: Uint8Array, reason: string): Promise<void> {
    const db = await this.open()
    const tx = db.transaction('backups', 'readwrite')
    const store = tx.objectStore('backups')
    store.add({ createdAt: new Date().toISOString(), reason, size: bytes.byteLength, bytes: bytes.slice().buffer })
    const keys = (await request(store.getAllKeys())) as number[]
    keys.sort((a, b) => a - b)
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_BACKUPS))) store.delete(key)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async loadBackup(id: number): Promise<Uint8Array | null> {
    const db = await this.open()
    const value = (await request(db.transaction('backups', 'readonly').objectStore('backups').get(id))) as { bytes: ArrayBuffer } | undefined
    return value ? new Uint8Array(value.bytes) : null
  }
}

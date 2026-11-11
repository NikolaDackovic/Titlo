import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { MIGRATIONS } from './migrations'
import type { SnapshotStore } from './snapshotStore'

export type Row = Record<string, SqlValue>

export interface OpenResult {
  db: AppDatabase
  /** Set when the main snapshot could not be opened and a backup was restored. */
  recoveredFrom?: string
  created: boolean
}

export class DatabaseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'DatabaseError'
  }
}

const isValidSqlite = (bytes: Uint8Array) =>
  bytes.byteLength >= 100 && new TextDecoder().decode(bytes.subarray(0, 15)) === 'SQLite format 3'

/**
 * SQLite database (sql.js / WebAssembly) persisted through a SnapshotStore.
 *
 * All writes go to the in-memory SQLite database immediately; `scheduleFlush`
 * debounces persisting the whole file. `flush()` is awaited before risky operations
 * and on page hide, so closing the app does not lose edits.
 */
export class AppDatabase {
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushing: Promise<void> | null = null
  private dirty = false
  private listeners = new Set<(state: SaveState) => void>()
  private saveState: SaveState = { status: 'saved', lastSavedAt: null, error: null }

  private constructor(
    private readonly sql: SqlJsStatic,
    private db: Database,
    readonly store: SnapshotStore,
    private readonly flushDelayMs: number,
  ) {}

  static async open(sql: SqlJsStatic, store: SnapshotStore, flushDelayMs = 600): Promise<OpenResult> {
    const tryOpen = (bytes: Uint8Array) => {
      if (!isValidSqlite(bytes)) throw new Error('Not an SQLite file')
      const db = new sql.Database(bytes)
      const check = db.exec('PRAGMA integrity_check')
      if (check[0]?.values[0]?.[0] !== 'ok') {
        db.close()
        throw new Error('Integrity check failed')
      }
      return db
    }

    let recoveredFrom: string | undefined
    let created = false
    let db: Database | null = null
    const main = await store.load()
    if (main) {
      try {
        db = tryOpen(main)
      } catch {
        // Main file damaged: newest valid backup wins. The damaged file is kept as a backup.
        await store.addBackup(main, 'damaged main database (kept for analysis)')
        for (const backup of await store.listBackups()) {
          if (backup.reason.startsWith('damaged')) continue
          const bytes = await store.loadBackup(backup.id)
          if (!bytes) continue
          try {
            db = tryOpen(bytes)
            recoveredFrom = `backup from ${backup.createdAt} (${backup.reason})`
            break
          } catch {
            /* try next */
          }
        }
        if (!db) throw new DatabaseError('The project database is damaged and no valid backup was found. The damaged file was preserved as a backup.')
      }
    } else {
      db = new sql.Database()
      created = true
    }

    const app = new AppDatabase(sql, db, store, flushDelayMs)
    app.exec('PRAGMA foreign_keys = ON')
    app.migrate()
    if (created || recoveredFrom) await app.flush()
    return { db: app, recoveredFrom, created }
  }

  private migrate() {
    this.db.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    const applied = new Set(this.all('SELECT version FROM schema_migrations').map((r) => Number(r.version)))
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue
      this.transaction(() => {
        this.db.exec(migration.sql)
        this.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [migration.version, migration.name, new Date().toISOString()])
      })
      this.dirty = true
    }
  }

  get schemaVersion(): number {
    return Number(this.get('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0)
  }

  exec(sql: string) {
    this.db.exec(sql)
  }

  run(sql: string, params: SqlValue[] = []) {
    this.db.run(sql, params)
    this.markDirty()
  }

  all(sql: string, params: SqlValue[] = []): Row[] {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: Row[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as Row)
      return rows
    } finally {
      stmt.free()
    }
  }

  get(sql: string, params: SqlValue[] = []): Row | undefined {
    return this.all(sql, params)[0]
  }

  /** Run many inserts with one prepared statement. */
  runMany(sql: string, rows: SqlValue[][]) {
    const stmt = this.db.prepare(sql)
    try {
      for (const params of rows) stmt.run(params)
    } finally {
      stmt.free()
    }
    this.markDirty()
  }

  private txDepth = 0

  /** Atomic unit of work. Re-entrant: nested calls become SAVEPOINTs. */
  transaction<T>(fn: () => T): T {
    const depth = this.txDepth
    const savepoint = `sp_${depth}`
    this.db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`)
    this.txDepth += 1
    try {
      const result = fn()
      this.txDepth -= 1
      this.db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
      this.markDirty()
      return result
    } catch (error) {
      this.txDepth -= 1
      if (depth === 0) this.db.exec('ROLLBACK')
      else this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
      throw error
    }
  }

  private markDirty() {
    this.dirty = true
    this.setState({ status: 'unsaved' })
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush().catch(() => undefined)
    }, this.flushDelayMs)
  }

  /** Persist the database file now. Safe to call repeatedly. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.flushing) await this.flushing
    if (!this.dirty) return
    this.dirty = false
    this.setState({ status: 'saving' })
    const bytes = this.db.export()
    // db.export() resets connection-level pragmas.
    this.db.exec('PRAGMA foreign_keys = ON')
    this.flushing = this.store
      .save(bytes)
      .then(() => this.setState({ status: 'saved', lastSavedAt: new Date().toISOString(), error: null }))
      .catch((error: unknown) => {
        this.dirty = true
        this.setState({ status: 'error', error: (error as Error)?.message ?? String(error) })
        throw new DatabaseError('Could not save the project database.', error)
      })
      .finally(() => {
        this.flushing = null
      })
    return this.flushing
  }

  exportBytes(): Uint8Array {
    const bytes = this.db.export()
    this.db.exec('PRAGMA foreign_keys = ON')
    return bytes
  }

  async backup(reason: string) {
    await this.store.addBackup(this.exportBytes(), reason)
  }

  /** Replace the whole database (restore from backup/file). Current state is backed up first. */
  async replaceWith(bytes: Uint8Array, reason: string) {
    if (!isValidSqlite(bytes)) throw new DatabaseError('The selected file is not a Titlo database.')
    const candidate = new this.sql.Database(bytes)
    const tables = candidate.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
    if (!tables.length) {
      candidate.close()
      throw new DatabaseError('The selected database has no projects table.')
    }
    await this.backup(`before ${reason}`)
    this.db.close()
    this.db = candidate
    this.exec('PRAGMA foreign_keys = ON')
    this.migrate()
    this.dirty = true
    await this.flush()
  }

  onSaveState(listener: (state: SaveState) => void) {
    this.listeners.add(listener)
    listener(this.saveState)
    return () => this.listeners.delete(listener)
  }

  private setState(patch: Partial<SaveState>) {
    this.saveState = { ...this.saveState, ...patch }
    for (const l of this.listeners) l(this.saveState)
  }

  get state() {
    return this.saveState
  }
}

export interface SaveState {
  status: 'saved' | 'unsaved' | 'saving' | 'error'
  lastSavedAt: string | null
  error: string | null
}

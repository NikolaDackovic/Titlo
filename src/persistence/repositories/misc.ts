import { newId, nowIso } from '../../domain/types'
import type { TranslationCache } from '../../translation/types'
import type { AppDatabase } from '../database'

export class SettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  get<T>(key: string, fallback: T): T {
    const row = this.db.get('SELECT value FROM application_settings WHERE key = ?', [key])
    if (!row) return fallback
    try {
      return JSON.parse(String(row.value)) as T
    } catch {
      return fallback
    }
  }

  set<T>(key: string, value: T) {
    this.db.run('INSERT INTO application_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)])
  }
}

export interface JobRecord {
  id: string
  projectId: string | null
  jobType: string
  status: string
  progress: number
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export class JobRepository {
  constructor(private readonly db: AppDatabase) {}

  start(projectId: string | null, jobType: string, details: unknown): string {
    const id = newId()
    this.db.run('INSERT INTO processing_jobs (id, project_id, job_type, status, progress, details_json, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)', [id, projectId, jobType, 'running', JSON.stringify(details), nowIso()])
    return id
  }

  update(id: string, patch: { status?: string; progress?: number; errorMessage?: string | null; completed?: boolean }) {
    const current = this.db.get('SELECT * FROM processing_jobs WHERE id = ?', [id])
    if (!current) return
    this.db.run('UPDATE processing_jobs SET status=?, progress=?, error_message=?, completed_at=? WHERE id=?', [
      patch.status ?? String(current.status),
      patch.progress ?? Number(current.progress),
      patch.errorMessage === undefined ? current.error_message : patch.errorMessage,
      patch.completed ? nowIso() : current.completed_at,
      id,
    ])
  }

  /** Jobs left "running" by a crash/close are marked interrupted on startup. */
  markInterrupted(): number {
    const count = Number(this.db.get("SELECT COUNT(*) AS c FROM processing_jobs WHERE status IN ('running', 'paused')")?.c ?? 0)
    if (count) this.db.run("UPDATE processing_jobs SET status = 'interrupted', completed_at = ? WHERE status IN ('running', 'paused')", [nowIso()])
    return count
  }

  recent(limit = 20): JobRecord[] {
    return this.db.all('SELECT * FROM processing_jobs ORDER BY created_at DESC LIMIT ?', [limit]).map((r) => ({
      id: String(r.id),
      projectId: r.project_id === null ? null : String(r.project_id),
      jobType: String(r.job_type),
      status: String(r.status),
      progress: Number(r.progress),
      errorMessage: r.error_message === null ? null : String(r.error_message),
      createdAt: String(r.created_at),
      completedAt: r.completed_at === null ? null : String(r.completed_at),
    }))
  }
}

export class CacheRepository implements TranslationCache {
  constructor(private readonly db: AppDatabase) {}

  async get(key: string) {
    const row = this.db.get('SELECT value FROM translation_cache WHERE cache_key = ?', [key])
    return row ? String(row.value) : undefined
  }

  async set(key: string, value: string) {
    this.db.run('INSERT INTO translation_cache (cache_key, value, created_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET value = excluded.value', [key, value, nowIso()])
  }

  count(): number {
    return Number(this.db.get('SELECT COUNT(*) AS c FROM translation_cache')?.c ?? 0)
  }

  clear() {
    this.db.run('DELETE FROM translation_cache')
  }
}

export type LogLevel = 'info' | 'warn' | 'error'

export class LogRepository {
  private static readonly MAX = 500
  constructor(private readonly db: AppDatabase) {}

  write(level: LogLevel, message: string, details?: string) {
    this.db.run('INSERT INTO app_logs (level, message, details, created_at) VALUES (?, ?, ?, ?)', [level, message.slice(0, 2000), details?.slice(0, 8000) ?? null, nowIso()])
    this.db.run(`DELETE FROM app_logs WHERE id <= (SELECT MAX(id) FROM app_logs) - ${LogRepository.MAX}`)
  }

  recent(limit = 100) {
    return this.db.all('SELECT * FROM app_logs ORDER BY id DESC LIMIT ?', [limit]).map((r) => ({
      id: Number(r.id),
      level: String(r.level) as LogLevel,
      message: String(r.message),
      details: r.details === null ? null : String(r.details),
      createdAt: String(r.created_at),
    }))
  }
}

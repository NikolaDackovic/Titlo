import { createContext, useContext } from 'react'
import type { SqlJsStatic } from 'sql.js'
import { BrowserMediaProcessor } from '../media/browserMedia'
import { BrowserWhisperEngine } from '../media/browserWhisper'
import type { MediaProcessor, TranscriptionEngine } from '../media/types'
import { AppDatabase } from '../persistence/database'
import { migrateLegacyStorage, type LegacyMigrationResult } from '../persistence/legacy'
import { GlossaryRepository } from '../persistence/repositories/glossaries'
import { CacheRepository, JobRepository, LogRepository, SettingsRepository } from '../persistence/repositories/misc'
import { ProjectRepository } from '../persistence/repositories/projects'
import { seedIfEmpty } from '../persistence/seed'
import type { SnapshotStore } from '../persistence/snapshotStore'
import { attachLogRepository, log } from '../services/errors'
import type { MarianRuntime } from '../translation/providers/opusMt'
import { httpModelFiles, WorkerMarianRuntime } from '../translation/providers/workerRuntime'
import type { ProviderDeps } from '../translation/registry'

export interface Services {
  db: AppDatabase
  projects: ProjectRepository
  glossaries: GlossaryRepository
  settings: SettingsRepository
  jobs: JobRepository
  cache: CacheRepository
  logs: LogRepository
  media: MediaProcessor
  transcription: TranscriptionEngine
  providerDeps: ProviderDeps
}

export interface BootReport {
  recoveredFrom?: string
  legacy: LegacyMigrationResult | null
  interruptedJobs: number
}

let sharedRuntime: WorkerMarianRuntime | null = null
/** One worker for the whole session: the model stays loaded between jobs. */
const marianRuntime = (): WorkerMarianRuntime => {
  if (!sharedRuntime) sharedRuntime = new WorkerMarianRuntime((m) => log('info', m))
  return sharedRuntime
}
// Providers call dispose() when done; keep the shared worker alive instead.
const persistentRuntime = (): MarianRuntime => ({
  translate: (...args) => marianRuntime().translate(...args),
  load: (...args) => marianRuntime().load!(...args),
  dispose: () => {},
})

export async function createServices(sql: SqlJsStatic, store: SnapshotStore): Promise<{ services: Services; report: BootReport }> {
  const { db, recoveredFrom } = await AppDatabase.open(sql, store)
  const projects = new ProjectRepository(db)
  const glossaries = new GlossaryRepository(db)
  const settings = new SettingsRepository(db)
  const jobs = new JobRepository(db)
  const logs = new LogRepository(db)
  attachLogRepository(logs)

  seedIfEmpty(glossaries, settings)
  const interruptedJobs = jobs.markInterrupted()

  let legacy: LegacyMigrationResult | null = null
  try {
    legacy = await migrateLegacyStorage(typeof localStorage === 'undefined' ? null : localStorage, db, projects, settings)
  } catch (error) {
    legacy = { migrated: 0, skippedDemo: 0, error: (error as Error).message }
  }

  // Daily automatic backup.
  const backups = await store.listBackups()
  const newest = backups.find((b) => !b.reason.startsWith('damaged'))
  if (!newest || Date.now() - Date.parse(newest.createdAt) > 24 * 3600 * 1000) {
    await db.backup('automatic daily backup')
  }
  await db.flush()

  const services: Services = {
    db,
    projects,
    glossaries,
    settings,
    jobs,
    cache: new CacheRepository(db),
    logs,
    media: new BrowserMediaProcessor(),
    transcription: new BrowserWhisperEngine(httpModelFiles),
    providerDeps: { marianRuntime: persistentRuntime, modelFiles: httpModelFiles },
  }
  return { services, report: { recoveredFrom, legacy, interruptedJobs } }
}

export const ServicesContext = createContext<Services | null>(null)

export function useServices(): Services {
  const services = useContext(ServicesContext)
  if (!services) throw new Error('Services are not available outside the application root.')
  return services
}

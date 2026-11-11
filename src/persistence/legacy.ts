import type { ProfileId, SourceLanguage } from '../domain/languages'
import { newId, nowIso, type ProjectDoc, type Segment } from '../domain/types'
import type { AppDatabase } from './database'
import type { ProjectRepository } from './repositories/projects'
import type { SettingsRepository } from './repositories/misc'

/**
 * One-time migration of projects saved by MVP v0.1 in localStorage.
 *
 * Safety rules:
 * - A database backup is taken first.
 * - The localStorage data is NEVER deleted; it is only marked as migrated.
 * - The old hard-coded demo project (unchanged) is not migrated.
 * - Old translations came from a word-substitution test provider and cannot be told
 *   apart from manual edits, so they are imported as "Needs review" with origin
 *   "test" — QC will flag them and nothing is exported unknowingly.
 */
export const LEGACY_KEY = 'exyu-titl-studio-projects'

interface LegacySegment {
  startTime?: number
  endTime?: number
  sourceText?: string
  translatedText?: string
  isLocked?: boolean
}
interface LegacyProject {
  id?: string
  name?: string
  contentType?: string
  sourceLanguage?: string
  languageProfile?: string
  fileName?: string
  createdAt?: string
  updatedAt?: string
  segments?: LegacySegment[]
}

const PROFILE_MAP: Record<string, ProfileId> = {
  'ExYu Neutral': 'exyu-neutral',
  'Serbian Latin': 'sr-Latn',
  'Serbian Cyrillic': 'sr-Cyrl',
  Croatian: 'hr',
  Bosnian: 'bs',
}
const SOURCE_MAP: Record<string, SourceLanguage> = { en: 'en', sr: 'sr', 'sr-Cyrl': 'sr', hr: 'hr', bs: 'bs' }
const CONTENT_MAP: Record<string, ProjectDoc['project']['contentType']> = {
  Movie: 'movie', 'TV Series': 'tv-series', Podcast: 'podcast', YouTube: 'youtube', Interview: 'interview', Other: 'other',
}
const DEMO_SOURCES = ['The car is waiting outside.', 'We need to see the apartment tonight.', 'The train leaves at sunrise.']

const isUntouchedDemo = (p: LegacyProject) =>
  p.id === 'project-demo' &&
  (p.segments ?? []).length === DEMO_SOURCES.length &&
  (p.segments ?? []).every((s, i) => s.sourceText === DEMO_SOURCES[i])

export function convertLegacyProject(p: LegacyProject): ProjectDoc {
  const profile = PROFILE_MAP[p.languageProfile ?? ''] ?? 'exyu-neutral'
  const now = nowIso()
  const segments: Segment[] = (p.segments ?? []).map((s) => {
    const seg: Segment = {
      id: newId(),
      start: Number(s.startTime) || 0,
      end: Number(s.endTime) || 0,
      source: String(s.sourceText ?? ''),
      translations: {},
    }
    if (s.translatedText?.trim()) {
      seg.translations[profile] = {
        text: s.translatedText,
        status: 'needs_review',
        origin: 'test',
        locked: Boolean(s.isLocked),
        error: 'Imported from MVP v0.1: origin unknown (may be test-provider output). Review or retranslate.',
        updatedAt: now,
      }
    }
    return seg
  })
  return {
    project: {
      id: newId(),
      name: `${p.name || 'Imported project'} (v0.1)`,
      contentType: CONTENT_MAP[p.contentType ?? ''] ?? 'other',
      sourceLanguage: SOURCE_MAP[p.sourceLanguage ?? ''] ?? 'en',
      activeProfile: profile,
      neutralYat: 'ijekavian',
      sourceFormat: 'srt',
      sourceFileName: p.fileName ?? null,
      formatHeader: null,
      createdAt: p.createdAt ?? now,
      updatedAt: now,
      lastOpenedAt: null,
    },
    segments,
  }
}

export interface LegacyMigrationResult {
  migrated: number
  skippedDemo: number
  error?: string
}

export async function migrateLegacyStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  db: AppDatabase,
  projects: ProjectRepository,
  settings: SettingsRepository,
): Promise<LegacyMigrationResult | null> {
  if (!storage || settings.get<string | null>('legacy_localstorage_migrated_at', null)) return null
  const raw = storage.getItem(LEGACY_KEY)
  if (!raw) {
    settings.set('legacy_localstorage_migrated_at', 'none-found')
    return null
  }
  let list: LegacyProject[]
  try {
    const parsed = JSON.parse(raw)
    list = Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return { migrated: 0, skippedDemo: 0, error: `Old projects in browser storage could not be read: ${(e as Error).message}. They were left untouched.` }
  }

  await db.backup('before migrating v0.1 localStorage projects')
  let migrated = 0
  let skippedDemo = 0
  db.transaction(() => {
    for (const p of list) {
      if (isUntouchedDemo(p)) {
        skippedDemo += 1
        continue
      }
      projects.save(convertLegacyProject(p))
      migrated += 1
    }
    settings.set('legacy_localstorage_migrated_at', nowIso())
  })
  await db.flush()
  // Keep the original data; only add a marker that it was migrated.
  try {
    storage.setItem(`${LEGACY_KEY}.migrated`, nowIso())
  } catch {
    /* storage full or disabled: harmless */
  }
  return { migrated, skippedDemo }
}

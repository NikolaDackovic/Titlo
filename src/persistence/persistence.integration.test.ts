import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ProjectDoc } from '../domain/types'
import { exportTermsCsv, exportTermsJson, importTermsCsv, importTermsJson } from '../glossary/io'
import { findGlossaryConflicts, toLocalizationRules } from '../glossary/rules'
import { SEED_TERMBASE } from '../localization/termbase'
import { isTranslationStale } from '../domain/types'
import { AppDatabase } from './database'
import { MIGRATIONS } from './migrations'
import { LEGACY_KEY, migrateLegacyStorage } from './legacy'
import { GlossaryRepository } from './repositories/glossaries'
import { JobRepository, SettingsRepository } from './repositories/misc'
import { ProjectRepository } from './repositories/projects'
import { seedIfEmpty } from './seed'
import { MemorySnapshotStore } from './snapshotStore'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})

const sampleDoc = (repo: ProjectRepository): ProjectDoc =>
  repo.create(
    { name: 'Test film', contentType: 'movie', sourceLanguage: 'en', activeProfile: 'sr-Cyrl', neutralYat: 'ijekavian', sourceFormat: 'srt', sourceFileName: 'a.srt', formatHeader: null },
    [
      { id: 'a', start: 0, end: 1000, source: 'Hello\n<i>there</i>', translations: { 'sr-Cyrl': { text: 'Здраво, Љубо!', status: 'approved', origin: 'manual', locked: true, updatedAt: '2026-01-01' } } },
      { id: 'b', start: 1500, end: 3000, source: 'Bye', translations: {}, meta: { assStyle: 'Default' } },
    ],
  )

describe('SQLite persistence', () => {
  it('creates schema with migrations and persists across reopen (autosave + reload)', async () => {
    const store = new MemorySnapshotStore()
    const { db, created } = await AppDatabase.open(SQL, store, 5)
    expect(created).toBe(true)
    expect(db.schemaVersion).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
    const projects = new ProjectRepository(db)
    const doc = sampleDoc(projects)
    // edit + save
    doc.segments[1].translations.hr = { text: 'Bok', status: 'translated', origin: 'machine', locked: false, updatedAt: 'x' }
    doc.project.name = 'Renamed'
    projects.save(doc)
    await db.flush()

    const reopened = await AppDatabase.open(SQL, store, 5)
    expect(reopened.created).toBe(false)
    const repo2 = new ProjectRepository(reopened.db)
    const loaded = repo2.getDoc(doc.project.id)!
    expect(loaded.project.name).toBe('Renamed')
    expect(loaded.segments.map((s) => s.id)).toEqual(['a', 'b'])
    expect(loaded.segments[0].source).toBe('Hello\n<i>there</i>')
    expect(loaded.segments[0].translations['sr-Cyrl']).toMatchObject({ text: 'Здраво, Љубо!', status: 'approved', locked: true, origin: 'manual' })
    expect(loaded.segments[1].translations.hr?.text).toBe('Bok')
    expect(loaded.segments[1].meta).toEqual({ assStyle: 'Default' })
    const summary = repo2.list()[0]
    expect(summary).toMatchObject({ segmentCount: 2, translatedCount: 1, runtimeMs: 3000 })
  })

  it('autosaves after the debounce without explicit flush', async () => {
    const store = new MemorySnapshotStore()
    const { db } = await AppDatabase.open(SQL, store, 5)
    const before = store.main
    sampleDoc(new ProjectRepository(db))
    await new Promise((r) => setTimeout(r, 60))
    expect(store.main).not.toBe(before)
    const { db: again } = await AppDatabase.open(SQL, store)
    expect(new ProjectRepository(again).list()).toHaveLength(1)
  })

  it('recovers from a damaged main file using the newest backup', async () => {
    const store = new MemorySnapshotStore()
    const { db } = await AppDatabase.open(SQL, store, 5)
    sampleDoc(new ProjectRepository(db))
    await db.flush()
    await db.backup('manual')
    store.main = new Uint8Array([1, 2, 3, 4]) // corrupt
    const result = await AppDatabase.open(SQL, store)
    expect(result.recoveredFrom).toContain('manual')
    expect(new ProjectRepository(result.db).list()).toHaveLength(1)
    expect((await store.listBackups()).some((b) => b.reason.startsWith('damaged'))).toBe(true)
  })

  it('rolls back failed transactions (no partial writes) and supports nesting', async () => {
    const { db } = await AppDatabase.open(SQL, new MemorySnapshotStore())
    const projects = new ProjectRepository(db)
    expect(() =>
      db.transaction(() => {
        sampleDoc(projects)
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(projects.list()).toHaveLength(0)
  })

  it('marks interrupted jobs on startup', async () => {
    const { db } = await AppDatabase.open(SQL, new MemorySnapshotStore())
    const jobs = new JobRepository(db)
    jobs.start(null, 'translation', {})
    expect(jobs.markInterrupted()).toBe(1)
    expect(jobs.recent()[0].status).toBe('interrupted')
  })

  it('migrates v0.1 localStorage projects safely (skips untouched demo, keeps original data)', async () => {
    const { db } = await AppDatabase.open(SQL, new MemorySnapshotStore())
    const projects = new ProjectRepository(db)
    const settings = new SettingsRepository(db)
    const data = new Map<string, string>()
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    const legacy = [
      { id: 'project-demo', name: 'Demo Film Localisation', segments: [{ sourceText: 'The car is waiting outside.' }, { sourceText: 'We need to see the apartment tonight.' }, { sourceText: 'The train leaves at sunrise.' }] },
      { id: 'p1', name: 'Moj film', languageProfile: 'Croatian', sourceLanguage: 'en', contentType: 'TV Series', segments: [{ startTime: 0, endTime: 1000, sourceText: 'Hi', translatedText: 'Bok', isLocked: true }] },
    ]
    data.set(LEGACY_KEY, JSON.stringify(legacy))
    const result = await migrateLegacyStorage(storage, db, projects, settings)
    expect(result).toEqual({ migrated: 1, skippedDemo: 1 })
    expect(data.get(LEGACY_KEY)).toBe(JSON.stringify(legacy)) // original kept
    const list = projects.list()
    expect(list).toHaveLength(1)
    const doc = projects.getDoc(list[0].id)!
    expect(doc.project).toMatchObject({ name: 'Moj film (v0.1)', activeProfile: 'hr', contentType: 'tv-series' })
    expect(doc.segments[0].translations.hr).toMatchObject({ text: 'Bok', origin: 'test', status: 'needs_review', locked: true })
    // second run does nothing
    expect(await migrateLegacyStorage(storage, db, projects, settings)).toBeNull()
  })

  it('does not migrate unreadable legacy data and leaves it untouched', async () => {
    const { db } = await AppDatabase.open(SQL, new MemorySnapshotStore())
    const data = new Map([[LEGACY_KEY, '{broken']])
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    const r = await migrateLegacyStorage(storage, db, new ProjectRepository(db), new SettingsRepository(db))
    expect(r?.error).toBeTruthy()
    expect(data.get(LEGACY_KEY)).toBe('{broken')
  })
})

describe('migration v1 → v2 (source review status)', () => {
  /** A database exactly as version 0.2 (schema v1) wrote it, with data. */
  function v1Database(): Uint8Array {
    const raw = new SQL.Database()
    raw.run('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    raw.exec(MIGRATIONS[0].sql)
    raw.run("INSERT INTO schema_migrations VALUES (1, 'initial schema', '2026-11-01')")
    const now = '2026-11-01T10:00:00.000Z'
    // Project 1: created from a video and transcribed (no subtitle file).
    raw.run("INSERT INTO projects VALUES ('p-video', 'Video', 'youtube', 'en', 'sr-Latn', 'ijekavian', NULL, NULL, NULL, ?, ?, NULL)", [now, now])
    raw.run("INSERT INTO subtitle_tracks VALUES ('t-src', 'p-video', 'en', 'source', ?)", [now])
    raw.run("INSERT INTO subtitle_tracks VALUES ('t-sr', 'p-video', 'sr-Latn', 'translation', ?)", [now])
    raw.run("INSERT INTO subtitle_segments VALUES ('seg-1', 't-src', 1, 0, 1500, 'Hello there.', NULL)")
    raw.run("INSERT INTO subtitle_segments VALUES ('seg-2', 't-src', 2, 2000, 3500, 'Bye.', NULL)")
    raw.run("INSERT INTO segment_translations VALUES ('seg-1', 't-sr', 'Zdravo.', 'translated', 'machine', 0, 'opus', NULL, ?)", [now])
    raw.run("INSERT INTO processing_jobs VALUES ('job-1', 'p-video', 'transcription', 'completed', 1, NULL, NULL, ?, ?)", [now, now])
    // Project 2: imported from an SRT file.
    raw.run("INSERT INTO projects VALUES ('p-srt', 'Film', 'movie', 'en', 'hr', 'ijekavian', 'srt', 'film.srt', NULL, ?, ?, NULL)", [now, now])
    raw.run("INSERT INTO subtitle_tracks VALUES ('t-src2', 'p-srt', 'en', 'source', ?)", [now])
    raw.run("INSERT INTO subtitle_segments VALUES ('seg-x', 't-src2', 1, 0, 1000, 'Imported line.', NULL)")
    raw.run("INSERT INTO glossaries VALUES ('g1', 'Old list', '', 'all', 1, 1, ?, ?)", [now, now])
    raw.run("INSERT INTO glossary_terms VALUES ('term1', 'g1', 'terminology', 'Car', 'automobil', 'en', 'all', '', '', 0, 1, 0, 1)")
    const bytes = raw.export()
    raw.close()
    return bytes
  }

  it('upgrades an existing database in place: data, ids and texts are kept', async () => {
    const store = new MemorySnapshotStore()
    store.main = v1Database()
    const { db, created } = await AppDatabase.open(SQL, store, 5)
    expect(created).toBe(false)
    expect(db.schemaVersion).toBe(2)
    const projects = new ProjectRepository(db)
    const video = projects.getDoc('p-video')!
    expect(video.segments.map((s) => [s.id, s.source])).toEqual([['seg-1', 'Hello there.'], ['seg-2', 'Bye.']])
    // Transcribed project → origin whisper; nothing reviewed yet.
    expect(video.segments.map((s) => [s.sourceOrigin, s.sourceStatus])).toEqual([['whisper', 'unreviewed'], ['whisper', 'unreviewed']])
    // Old translations keep their text; provenance unknown → never reported as out of date.
    const tr = video.segments[0].translations['sr-Latn']!
    expect(tr).toMatchObject({ text: 'Zdravo.', status: 'translated', origin: 'machine' })
    expect(tr.sourceText).toBeUndefined()
    expect(isTranslationStale(video.segments[0], tr)).toBe(false)
    const srt = projects.getDoc('p-srt')!
    expect(srt.segments[0]).toMatchObject({ id: 'seg-x', source: 'Imported line.', sourceOrigin: 'import', sourceStatus: 'unreviewed' })
    expect(new GlossaryRepository(db).terms('g1')[0]).toMatchObject({ sourceTerm: 'Car', targetTerm: 'automobil', alternatives: [], category: '' })
    // Reopening does not run the migration again.
    await db.flush()
    const again = await AppDatabase.open(SQL, store, 5)
    expect(again.db.schemaVersion).toBe(2)
    expect(new ProjectRepository(again.db).getDoc('p-video')!.segments).toHaveLength(2)
  })

  it('stores source status, origin, translation snapshot and term alternatives', async () => {
    const { db } = await AppDatabase.open(SQL, new MemorySnapshotStore(), 5)
    const projects = new ProjectRepository(db)
    const doc = projects.create(
      { name: 'Statuses', contentType: 'other', sourceLanguage: 'en', activeProfile: 'hr', neutralYat: 'ijekavian', sourceFormat: null, sourceFileName: null, formatHeader: null },
      [
        { id: 's1', start: 0, end: 1000, source: 'Changed text', sourceStatus: 'manually-edited', sourceOrigin: 'whisper', translations: { hr: { text: 'Stari prijevod', status: 'translated', origin: 'machine', locked: false, updatedAt: '2026-11-11', sourceText: 'Original text' } } },
        { id: 's2', start: 1000, end: 2000, source: 'Fine', sourceStatus: 'approved', sourceOrigin: 'manual', translations: {} },
      ],
    )
    const back = projects.getDoc(doc.project.id)!
    expect(back.segments.map((s) => [s.sourceStatus, s.sourceOrigin])).toEqual([['manually-edited', 'whisper'], ['approved', 'manual']])
    expect(back.segments[0].translations.hr?.sourceText).toBe('Original text')
    expect(isTranslationStale(back.segments[0], back.segments[0].translations.hr)).toBe(true)

    const repo = new GlossaryRepository(db)
    const g = repo.create({ name: 'Terms' })
    repo.addTerms(g.id, importTermsCsv('source_term,target_term,alternatives,category\nCar,automobil,auto | kola,Vehicles\n').terms)
    expect(repo.terms(g.id)[0]).toMatchObject({ alternatives: ['auto', 'kola'], category: 'Vehicles' })
    expect(importTermsJson(exportTermsJson('Terms', repo.terms(g.id))).terms[0]).toMatchObject({ alternatives: ['auto', 'kola'], category: 'Vehicles' })
  })
})

describe('glossary', () => {
  it('seeds a starter glossary once and supports CRUD + project assignment', async () => {
    const { db } = await AppDatabase.open(SQL, new MemorySnapshotStore())
    const repo = new GlossaryRepository(db)
    const settings = new SettingsRepository(db)
    seedIfEmpty(repo, settings)
    seedIfEmpty(repo, settings)
    expect(repo.list()).toHaveLength(1)
    const starter = repo.list()[0]
    expect(repo.terms(starter.id).map((t) => t.sourceTerm)).toContain('Apartment')

    const own = repo.create({ name: 'Film-specific', isGlobal: false })
    repo.addTerms(own.id, importTermsCsv('source_term;target_term;notes\nElevator;lift;\n').terms)
    const projects = new ProjectRepository(db)
    const doc = sampleDoc(projects)
    expect(repo.forProject(doc.project.id).glossaries.map((g) => g.id)).toEqual([starter.id])
    repo.setAssigned(doc.project.id, own.id, true)
    expect(repo.forProject(doc.project.id).glossaries).toHaveLength(2)
    repo.update(starter.id, { enabled: false })
    expect(repo.forProject(doc.project.id).glossaries.map((g) => g.id)).toEqual([own.id])

    const term = repo.terms(own.id)[0]
    repo.updateTerm({ ...term, targetTerm: 'dizalo', targetProfile: 'hr' })
    expect(repo.terms(own.id)[0]).toMatchObject({ targetTerm: 'dizalo', targetProfile: 'hr' })
    repo.deleteTerm(term.id)
    expect(repo.terms(own.id)).toHaveLength(0)
  })

  it('imports/exports CSV (comma, semicolon, quotes, UTF-8) and JSON', () => {
    const csv = 'source_term,target_term,kind,source_language,target_profile,notes\n"Movie theater","kino",terminology,en,hr,"Croatian, Bosnian"\nvoz,vlak,localization,sr,hr,\n'
    const r = importTermsCsv(csv)
    expect(r.errors).toEqual([])
    expect(r.terms[0]).toMatchObject({ sourceTerm: 'Movie theater', targetTerm: 'kino', targetProfile: 'hr', notes: 'Croatian, Bosnian' })
    expect(r.terms[1]).toMatchObject({ kind: 'localization', sourceLanguage: 'sr' })
    const again = importTermsCsv(exportTermsCsv(r.terms))
    expect(again.terms).toEqual(r.terms)
    const json = importTermsJson(exportTermsJson('x', r.terms))
    expect(json.terms).toEqual(r.terms)
    expect(importTermsCsv('source_term,target_term\n,empty\n').errors[0]).toContain('Row 2')
    expect(importTermsCsv('source_term;target_term;target_profile\nšargarepa;mrkva;xx\n').errors[0]).toContain('unknown profile')
    expect(importTermsJson('{bad').errors[0]).toContain('Invalid JSON')
  })

  it('detects conflicts between terms and with the built-in termbase', () => {
    const base = { glossaryId: 'g', sourceLanguage: 'en' as const, targetProfile: 'all' as const, notes: '', context: '', caseSensitive: false, wholeWord: true, priority: 0, enabled: true }
    const terms = [
      { ...base, id: '1', kind: 'terminology' as const, sourceTerm: 'Elevator', targetTerm: 'lift' },
      { ...base, id: '2', kind: 'terminology' as const, sourceTerm: 'elevator', targetTerm: 'dizalo' },
      { ...base, id: '3', kind: 'localization' as const, sourceLanguage: 'sr' as const, targetProfile: 'hr' as const, sourceTerm: 'voz', targetTerm: 'vozić' },
    ]
    const glossaries = [{ id: 'g', name: 'G', description: '', profile: 'all' as const, enabled: true, createdAt: '', updatedAt: '' }]
    const conflicts = findGlossaryConflicts(glossaries, terms, SEED_TERMBASE)
    expect(conflicts.some((c) => c.severity === 'warning' && c.message.includes('two different targets'))).toBe(true)
    expect(conflicts.some((c) => c.message.includes('overrides the built-in termbase'))).toBe(true)
    expect(toLocalizationRules(terms)).toHaveLength(1)
  })
})

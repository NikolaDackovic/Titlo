import type { SqlValue } from 'sql.js'
import { isProfileId, isSourceLanguage, type ProfileId } from '../../domain/languages'
import {
  isSourceOrigin,
  isSourceStatus,
  newId,
  nowIso,
  type ContentType,
  type MediaFileRecord,
  type Project,
  type ProjectDoc,
  type ProjectSummary,
  type Segment,
  type SegmentTranslation,
  sourceOriginOf,
  sourceStatusOf,
  type SubtitleFormat,
  type TranslationOrigin,
  type TranslationStatus,
} from '../../domain/types'
import type { AppDatabase, Row } from '../database'

const str = (v: SqlValue | undefined) => (v === null || v === undefined ? null : String(v))

const rowToProject = (r: Row): Project => ({
  id: String(r.id),
  name: String(r.name),
  contentType: String(r.content_type) as ContentType,
  sourceLanguage: isSourceLanguage(r.source_language) ? r.source_language : 'en',
  activeProfile: isProfileId(r.active_profile) ? r.active_profile : 'exyu-neutral',
  neutralYat: r.neutral_yat === 'ekavian' ? 'ekavian' : 'ijekavian',
  sourceFormat: (str(r.source_format) as SubtitleFormat | null) ?? null,
  sourceFileName: str(r.source_file_name),
  formatHeader: str(r.format_header),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  lastOpenedAt: str(r.last_opened_at),
})

export class ProjectRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): ProjectSummary[] {
    return this.db
      .all(
        `SELECT p.*,
           (SELECT COUNT(*) FROM subtitle_segments s JOIN subtitle_tracks t ON t.id = s.track_id
              WHERE t.project_id = p.id AND t.track_type = 'source') AS segment_count,
           (SELECT COUNT(*) FROM segment_translations st JOIN subtitle_tracks t ON t.id = st.track_id
              WHERE t.project_id = p.id AND t.language = p.active_profile AND TRIM(st.translated_text) <> '') AS translated_count,
           (SELECT COALESCE(MAX(s.end_time) - MIN(s.start_time), 0) FROM subtitle_segments s JOIN subtitle_tracks t ON t.id = s.track_id
              WHERE t.project_id = p.id AND t.track_type = 'source') AS runtime_ms
         FROM projects p ORDER BY COALESCE(p.last_opened_at, p.updated_at) DESC`,
      )
      .map((r) => {
        const p = rowToProject(r)
        return {
          id: p.id,
          name: p.name,
          contentType: p.contentType,
          sourceLanguage: p.sourceLanguage,
          activeProfile: p.activeProfile,
          segmentCount: Number(r.segment_count),
          translatedCount: Number(r.translated_count),
          runtimeMs: Number(r.runtime_ms),
          sourceFileName: p.sourceFileName,
          updatedAt: p.updatedAt,
          lastOpenedAt: p.lastOpenedAt,
        }
      })
  }

  /** Total number of translated segments across all projects and profiles. */
  translatedSegmentTotal(): number {
    return Number(this.db.get("SELECT COUNT(*) AS c FROM segment_translations WHERE TRIM(translated_text) <> ''")?.c ?? 0)
  }

  getDoc(id: string): ProjectDoc | null {
    const row = this.db.get('SELECT * FROM projects WHERE id = ?', [id])
    if (!row) return null
    const project = rowToProject(row)
    const tracks = this.db.all('SELECT id, language, track_type FROM subtitle_tracks WHERE project_id = ?', [id])
    const sourceTrack = tracks.find((t) => t.track_type === 'source')
    if (!sourceTrack) return { project, segments: [] }
    const profileByTrack = new Map(tracks.filter((t) => t.track_type === 'translation').map((t) => [String(t.id), String(t.language) as ProfileId]))

    const segments: Segment[] = this.db
      .all('SELECT * FROM subtitle_segments WHERE track_id = ? ORDER BY segment_number', [String(sourceTrack.id)])
      .map((r) => ({
        id: String(r.id),
        start: Number(r.start_time),
        end: Number(r.end_time),
        source: String(r.source_text),
        translations: {},
        meta: r.meta_json ? (JSON.parse(String(r.meta_json)) as Record<string, string>) : undefined,
        sourceStatus: isSourceStatus(r.source_status) ? r.source_status : 'unreviewed',
        sourceOrigin: isSourceOrigin(r.source_origin) ? r.source_origin : 'import',
      }))
    const byId = new Map(segments.map((s) => [s.id, s]))
    const translations = this.db.all(
      `SELECT st.* FROM segment_translations st JOIN subtitle_tracks t ON t.id = st.track_id WHERE t.project_id = ?`,
      [id],
    )
    for (const r of translations) {
      const seg = byId.get(String(r.segment_id))
      const profile = profileByTrack.get(String(r.track_id))
      if (!seg || !profile) continue
      const tr: SegmentTranslation = {
        text: String(r.translated_text),
        status: String(r.translation_status) as TranslationStatus,
        origin: String(r.origin) as TranslationOrigin,
        locked: Number(r.is_locked) === 1,
        providerId: str(r.provider_id) ?? undefined,
        error: str(r.error) ?? undefined,
        updatedAt: String(r.updated_at),
        sourceText: str(r.source_snapshot) ?? undefined,
      }
      seg.translations[profile] = tr
    }
    return { project, segments }
  }

  create(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'lastOpenedAt'>, segments: Segment[] = []): ProjectDoc {
    const now = nowIso()
    const doc: ProjectDoc = { project: { ...project, id: newId(), createdAt: now, updatedAt: now, lastOpenedAt: now }, segments }
    this.save(doc)
    return doc
  }

  /**
   * Save a full project document atomically (project row, segments, all translations).
   * Subtitle documents are small (a feature film ≈ 1–2k segments), so rewriting
   * the segment rows inside one transaction is simple and fast.
   */
  save(doc: ProjectDoc) {
    const { project, segments } = doc
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO projects (id, name, content_type, source_language, active_profile, neutral_yat, source_format, source_file_name, format_header, created_at, updated_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, content_type=excluded.content_type, source_language=excluded.source_language,
           active_profile=excluded.active_profile, neutral_yat=excluded.neutral_yat, source_format=excluded.source_format,
           source_file_name=excluded.source_file_name, format_header=excluded.format_header, updated_at=excluded.updated_at,
           last_opened_at=excluded.last_opened_at`,
        [project.id, project.name, project.contentType, project.sourceLanguage, project.activeProfile, project.neutralYat, project.sourceFormat, project.sourceFileName, project.formatHeader, project.createdAt, project.updatedAt, project.lastOpenedAt],
      )

      const sourceTrackId = this.ensureTrack(project.id, 'source', project.sourceLanguage)
      // Explicit deletes (do not rely on FK cascades being enabled).
      this.db.run('DELETE FROM segment_translations WHERE track_id IN (SELECT id FROM subtitle_tracks WHERE project_id = ?)', [project.id])
      this.db.run('DELETE FROM subtitle_segments WHERE track_id = ?', [sourceTrackId])
      this.db.runMany(
        'INSERT INTO subtitle_segments (id, track_id, segment_number, start_time, end_time, source_text, meta_json, source_status, source_origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        segments.map((s, i) => [s.id, sourceTrackId, i + 1, Math.round(s.start), Math.round(s.end), s.source, s.meta ? JSON.stringify(s.meta) : null, sourceStatusOf(s), sourceOriginOf(s)]),
      )

      const trackIds = new Map<ProfileId, string>()
      const rows: SqlValue[][] = []
      for (const s of segments) {
        for (const [profile, tr] of Object.entries(s.translations) as Array<[ProfileId, SegmentTranslation | undefined]>) {
          if (!tr) continue
          if (!trackIds.has(profile)) trackIds.set(profile, this.ensureTrack(project.id, 'translation', profile))
          rows.push([s.id, trackIds.get(profile)!, tr.text, tr.status, tr.origin, tr.locked ? 1 : 0, tr.providerId ?? null, tr.error ?? null, tr.updatedAt, tr.sourceText ?? null])
        }
      }
      // Old translation rows were deleted above.
      this.db.runMany(
        'INSERT INTO segment_translations (segment_id, track_id, translated_text, translation_status, origin, is_locked, provider_id, error, updated_at, source_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        rows,
      )
    })
  }

  private ensureTrack(projectId: string, type: 'source' | 'translation', language: string): string {
    if (type === 'source') {
      const existing = this.db.get("SELECT id FROM subtitle_tracks WHERE project_id = ? AND track_type = 'source'", [projectId])
      if (existing) {
        this.db.run('UPDATE subtitle_tracks SET language = ? WHERE id = ?', [language, String(existing.id)])
        return String(existing.id)
      }
    } else {
      const existing = this.db.get("SELECT id FROM subtitle_tracks WHERE project_id = ? AND track_type = 'translation' AND language = ?", [projectId, language])
      if (existing) return String(existing.id)
    }
    const id = newId()
    this.db.run('INSERT INTO subtitle_tracks (id, project_id, language, track_type, created_at) VALUES (?, ?, ?, ?, ?)', [id, projectId, language, type, nowIso()])
    return id
  }

  touchOpened(id: string) {
    this.db.run('UPDATE projects SET last_opened_at = ? WHERE id = ?', [nowIso(), id])
  }

  delete(id: string) {
    this.db.run('DELETE FROM projects WHERE id = ?', [id])
  }

  // --- media -------------------------------------------------------------
  getMedia(projectId: string): MediaFileRecord | null {
    const r = this.db.get('SELECT * FROM media_files WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', [projectId])
    if (!r) return null
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      fileName: String(r.file_name),
      fileType: String(r.file_type),
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
      fileSize: Number(r.file_size),
      filePath: str(r.file_path),
    }
  }

  setMedia(media: Omit<MediaFileRecord, 'id'>) {
    this.db.transaction(() => {
      this.db.run('DELETE FROM media_files WHERE project_id = ?', [media.projectId])
      this.db.run('INSERT INTO media_files (id, project_id, file_name, file_path, file_type, duration_ms, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        newId(), media.projectId, media.fileName, media.filePath, media.fileType, media.durationMs, media.fileSize, nowIso(),
      ])
    })
  }

  totalMediaMinutes(): number {
    return Number(this.db.get('SELECT COALESCE(SUM(duration_ms), 0) AS ms FROM media_files')?.ms ?? 0) / 60000
  }
}

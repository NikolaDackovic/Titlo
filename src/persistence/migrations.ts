/**
 * Versioned schema migrations. Never edit a released migration — add a new one.
 * Each migration runs inside a transaction together with its schema_migrations row.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        source_language TEXT NOT NULL,
        active_profile TEXT NOT NULL,
        neutral_yat TEXT NOT NULL DEFAULT 'ijekavian',
        source_format TEXT,
        source_file_name TEXT,
        format_header TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT
      );

      CREATE TABLE media_files (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_path TEXT,
        file_type TEXT NOT NULL,
        duration_ms INTEGER,
        file_size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      -- One "source" track per project plus one "translation" track per language profile.
      CREATE TABLE subtitle_tracks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        language TEXT NOT NULL,
        track_type TEXT NOT NULL CHECK (track_type IN ('source', 'translation')),
        created_at TEXT NOT NULL,
        UNIQUE (project_id, track_type, language)
      );

      CREATE TABLE subtitle_segments (
        id TEXT PRIMARY KEY,
        track_id TEXT NOT NULL REFERENCES subtitle_tracks(id) ON DELETE CASCADE,
        segment_number INTEGER NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        source_text TEXT NOT NULL,
        meta_json TEXT
      );
      CREATE INDEX idx_segments_track ON subtitle_segments(track_id, segment_number);

      CREATE TABLE segment_translations (
        segment_id TEXT NOT NULL REFERENCES subtitle_segments(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL REFERENCES subtitle_tracks(id) ON DELETE CASCADE,
        translated_text TEXT NOT NULL,
        translation_status TEXT NOT NULL,
        origin TEXT NOT NULL,
        is_locked INTEGER NOT NULL DEFAULT 0,
        provider_id TEXT,
        error TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (segment_id, track_id)
      );

      CREATE TABLE glossaries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        language_profile TEXT NOT NULL DEFAULT 'all',
        enabled INTEGER NOT NULL DEFAULT 1,
        is_global INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE glossary_terms (
        id TEXT PRIMARY KEY,
        glossary_id TEXT NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('terminology', 'localization')),
        source_term TEXT NOT NULL,
        target_term TEXT NOT NULL,
        source_language TEXT NOT NULL,
        target_profile TEXT NOT NULL DEFAULT 'all',
        notes TEXT NOT NULL DEFAULT '',
        context TEXT NOT NULL DEFAULT '',
        case_sensitive INTEGER NOT NULL DEFAULT 0,
        whole_word INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_terms_glossary ON glossary_terms(glossary_id);

      CREATE TABLE project_glossaries (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        glossary_id TEXT NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
        PRIMARY KEY (project_id, glossary_id)
      );

      CREATE TABLE processing_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        error_message TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE translation_cache (
        cache_key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE application_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE app_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'source review status, translation source snapshot, terminology alternatives',
    // Only adds columns: existing rows, ids and text are untouched.
    sql: `
      ALTER TABLE subtitle_segments ADD COLUMN source_status TEXT NOT NULL DEFAULT 'unreviewed';
      ALTER TABLE subtitle_segments ADD COLUMN source_origin TEXT NOT NULL DEFAULT 'import';
      -- Projects that were not imported from a subtitle file and have a finished transcription
      -- job: their original text came from Whisper.
      UPDATE subtitle_segments SET source_origin = 'whisper'
        WHERE track_id IN (
          SELECT t.id FROM subtitle_tracks t JOIN projects p ON p.id = t.project_id
          WHERE t.track_type = 'source' AND p.source_format IS NULL
            AND EXISTS (SELECT 1 FROM processing_jobs j WHERE j.project_id = p.id AND j.job_type = 'transcription' AND j.status = 'completed')
        );
      -- Original text a translation was produced from (NULL = unknown, older data).
      ALTER TABLE segment_translations ADD COLUMN source_snapshot TEXT;
      -- Terminology: accepted alternative renderings ("|"-separated) and a free category.
      ALTER TABLE glossary_terms ADD COLUMN alternatives TEXT NOT NULL DEFAULT '';
      ALTER TABLE glossary_terms ADD COLUMN category TEXT NOT NULL DEFAULT '';
    `,
  },
]

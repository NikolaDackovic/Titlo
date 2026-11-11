import type { ProfileId, SourceLanguage, Yat } from './languages'

export type ContentType = 'movie' | 'tv-series' | 'podcast' | 'youtube' | 'interview' | 'documentary' | 'other'

export const CONTENT_TYPES: Array<{ id: ContentType; label: string }> = [
  { id: 'movie', label: 'Movie' },
  { id: 'tv-series', label: 'TV Series' },
  { id: 'documentary', label: 'Documentary' },
  { id: 'podcast', label: 'Podcast' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'interview', label: 'Interview' },
  { id: 'other', label: 'Other' },
]

export type SubtitleFormat = 'srt' | 'vtt' | 'ass'

export type TranslationStatus =
  | 'not_translated'
  | 'translating'
  | 'translated'
  | 'needs_review'
  | 'approved'
  | 'failed'

export const TRANSLATION_STATUS_LABEL: Record<TranslationStatus, string> = {
  not_translated: 'Not translated',
  translating: 'Translating',
  translated: 'Translated',
  needs_review: 'Needs review',
  approved: 'Approved',
  failed: 'Failed',
}

/** Who produced the current translation text. */
export type TranslationOrigin = 'none' | 'machine' | 'manual' | 'test' | 'transliteration'

export interface SegmentTranslation {
  text: string
  status: TranslationStatus
  origin: TranslationOrigin
  /** Locked segments are never touched by batch translation or localization. */
  locked: boolean
  /** Provider/model that produced the machine text (for audit). */
  providerId?: string
  error?: string
  updatedAt: string
  /**
   * The original text this translation was made from (machine) or edited against (manual).
   * When the original changes later the translation is *stale*: it is kept, but flagged.
   * Missing for translations created before this was recorded (staleness unknown).
   */
  sourceText?: string
}

/**
 * Review state of the ORIGINAL (transcribed/imported) text, separate from translation status.
 * - unreviewed: nobody has checked it yet (new Whisper output, imported file)
 * - needs-review: a QC warning or the user flagged it
 * - verified: the user listened and confirmed the text
 * - manually-edited: the user changed the text
 * - approved: explicitly approved as final
 */
export type SourceStatus = 'unreviewed' | 'needs-review' | 'verified' | 'manually-edited' | 'approved'

export const SOURCE_STATUSES: SourceStatus[] = ['unreviewed', 'needs-review', 'verified', 'manually-edited', 'approved']

export const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  unreviewed: 'Unreviewed',
  'needs-review': 'Check original',
  verified: 'Verified',
  'manually-edited': 'Edited by you',
  approved: 'Original approved',
}

export const isSourceStatus = (v: unknown): v is SourceStatus => typeof v === 'string' && (SOURCE_STATUSES as string[]).includes(v)

/** Where the original text came from. */
export type SourceOrigin = 'whisper' | 'import' | 'manual'

export const isSourceOrigin = (v: unknown): v is SourceOrigin => v === 'whisper' || v === 'import' || v === 'manual'

/** Statuses a new transcription must not overwrite without an explicit confirmation. */
export const PROTECTED_SOURCE_STATUSES: ReadonlySet<SourceStatus> = new Set<SourceStatus>(['verified', 'manually-edited', 'approved'])

/**
 * Format-specific data preserved so that export can reproduce the original file.
 * Example: ASS Layer/Style/Name/Margins/Effect, VTT cue identifier and settings.
 */
export type SegmentFormatMeta = Record<string, string>

export interface Segment {
  id: string
  /** Start/end in integer milliseconds. */
  start: number
  end: number
  /** Source text; line breaks are `\n`. Inline markup (e.g. `<i>`, `{\an8}`) is preserved. */
  source: string
  translations: Partial<Record<ProfileId, SegmentTranslation>>
  meta?: SegmentFormatMeta
  /** Review state of the original text (missing = `unreviewed`). */
  sourceStatus?: SourceStatus
  /** Origin of the original text (missing = `import`: older projects did not record it). */
  sourceOrigin?: SourceOrigin
}

export const sourceStatusOf = (s: Pick<Segment, 'sourceStatus'>): SourceStatus => s.sourceStatus ?? 'unreviewed'
export const sourceOriginOf = (s: Pick<Segment, 'sourceOrigin'>): SourceOrigin => s.sourceOrigin ?? 'import'
export const isSourceProtected = (s: Pick<Segment, 'sourceStatus'>) => PROTECTED_SOURCE_STATUSES.has(sourceStatusOf(s))
/** Original text that still waits for a human look (only machine transcription or a QC flag counts). */
export const needsSourceReview = (s: Pick<Segment, 'sourceStatus' | 'sourceOrigin'>) => {
  const status = sourceStatusOf(s)
  return status === 'needs-review' || (status === 'unreviewed' && sourceOriginOf(s) === 'whisper')
}

/**
 * A translation is stale when it was made from a different original than the current one.
 * Unknown provenance (older data) is never reported as stale.
 */
export const isTranslationStale = (segment: Pick<Segment, 'source'>, tr: SegmentTranslation | undefined) =>
  Boolean(tr && tr.text.trim() && tr.sourceText !== undefined && tr.sourceText !== segment.source)

export interface Project {
  id: string
  name: string
  contentType: ContentType
  sourceLanguage: SourceLanguage
  /** The profile currently being edited in the Studio. */
  activeProfile: ProfileId
  /** Yat reflex used by the ExYu Neutral profile. */
  neutralYat: Yat
  sourceFormat: SubtitleFormat | null
  sourceFileName: string | null
  /** Format-level data needed for faithful export (e.g. ASS [Script Info]/[V4+ Styles]). */
  formatHeader: string | null
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
}

export interface ProjectDoc {
  project: Project
  segments: Segment[]
}

export interface MediaFileRecord {
  id: string
  projectId: string
  fileName: string
  fileType: string
  durationMs: number | null
  fileSize: number
  /** Native path is only known in the desktop build. */
  filePath: string | null
}

export interface ProjectSummary {
  id: string
  name: string
  contentType: ContentType
  sourceLanguage: SourceLanguage
  activeProfile: ProfileId
  segmentCount: number
  translatedCount: number
  runtimeMs: number
  sourceFileName: string | null
  updatedAt: string
  lastOpenedAt: string | null
}

export const nowIso = () => new Date().toISOString()

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

import { getProfile, type ProfileId } from '../domain/languages'
import type { Project, Segment } from '../domain/types'
import { serializeAss } from './ass'
import { encodeUtf8 } from './encoding'
import { assToHtml, htmlToAss, stripMarkup } from './markup'
import { serializeSrt } from './srt'
import type { ExportCue, LineEnding } from './types'
import { serializeVtt } from './vtt'
import { t as L } from '../i18n'

export type ExportFormat = 'srt' | 'vtt' | 'ass' | 'txt'
export type ExportContent = 'translation' | 'source' | 'bilingual'

/**
 * Registry of export formats. TTML/IMSC can be added later as another entry; the
 * exporter pipeline (cue selection, validation, encoding) is format-independent.
 */
export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; extension: string }> = [
  { id: 'srt', label: 'SubRip (.srt)', extension: 'srt' },
  { id: 'vtt', label: 'WebVTT (.vtt)', extension: 'vtt' },
  { id: 'ass', label: 'Advanced SubStation (.ass)', extension: 'ass' },
  { id: 'txt', label: 'Plain text (.txt)', extension: 'txt' },
]

export interface ExportOptions {
  format: ExportFormat
  content: ExportContent
  profile: ProfileId
  lineEnding: LineEnding
  bom: boolean
}

export interface ExportIssue {
  severity: 'error' | 'warning'
  message: string
}

export interface ExportResult {
  fileName: string
  text: string
  bytes: Uint8Array
  issues: ExportIssue[]
}

// Control characters are intentionally matched: they are invalid in Windows file names.
const sanitizeFileName = (name: string) =>
  // eslint-disable-next-line no-control-regex
  name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim() || 'subtitles'

const markupFor = (text: string, sourceFormat: Project['sourceFormat'], target: ExportFormat) => {
  if (target === 'txt') return { text: stripMarkup(text), dropped: 0 }
  const isAssText = sourceFormat === 'ass'
  if (target === 'ass') return { text: isAssText ? text : htmlToAss(text), dropped: 0 }
  if (isAssText) return assToHtml(text)
  return { text, dropped: 0 }
}

export function buildExport(project: Project, segments: Segment[], options: ExportOptions): ExportResult {
  const issues: ExportIssue[] = []
  const profile = getProfile(options.profile)

  let missing = 0
  let testOutputs = 0
  let unreviewed = 0
  let droppedTags = 0

  const cues: ExportCue[] = segments.map((segment) => {
    const tr = segment.translations[options.profile]
    const translation = tr?.text.trim() ? tr.text : ''
    if (options.content !== 'source') {
      if (!translation) missing += 1
      if (tr?.origin === 'test') testOutputs += 1
      if (tr && (tr.status === 'needs_review' || tr.status === 'failed')) unreviewed += 1
    }

    let text: string
    if (options.content === 'source') text = segment.source
    else if (options.content === 'translation') text = translation || segment.source
    else {
      const italic = (s: string) => (project.sourceFormat === 'ass' ? `{\\i1}${s}{\\i0}` : `<i>${s}</i>`)
      text = translation ? `${translation}\n${italic(stripMarkup(segment.source))}` : segment.source
    }

    const converted = markupFor(text, project.sourceFormat, options.format)
    droppedTags += converted.dropped
    return { start: segment.start, end: segment.end, text: converted.text, meta: segment.meta }
  })

  // Timing validation (blocking errors).
  segments.forEach((s, i) => {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) {
      issues.push({ severity: 'error', message: L('Segment {v}: timing is not a number.', { v: i + 1 }) })
    } else if (s.start < 0) {
      issues.push({ severity: 'error', message: L('Segment {v}: negative start time.', { v: i + 1 }) })
    } else if (s.end <= s.start) {
      issues.push({ severity: 'error', message: L('Segment {v}: end time is not after start time.', { v: i + 1 }) })
    }
  })

  if (missing) {
    issues.push({
      severity: 'warning',
      message: options.content === 'translation'
        ? L('{missing} segment(s) have no {label} translation; the source text is exported instead.', { missing, label: L(profile.label) })
        : L('{missing} segment(s) have no {label} translation.', { missing, label: L(profile.label) }),
    })
  }
  if (testOutputs) {
    issues.push({
      severity: 'warning',
      message: L('{testOutputs} segment(s) contain TEST provider output, which is not a real translation.', { testOutputs }),
    })
  }
  if (unreviewed) issues.push({ severity: 'warning', message: L('{unreviewed} segment(s) are marked "Needs review" or "Failed".', { unreviewed }) })
  if (droppedTags) issues.push({ severity: 'warning', message: L('{droppedTags} ASS override tag(s) have no {toUpperCase} equivalent and were removed.', { droppedTags, toUpperCase: options.format.toUpperCase() }) })

  const header = options.format === 'vtt' && project.sourceFormat === 'vtt' ? project.formatHeader : options.format === 'ass' && project.sourceFormat === 'ass' ? project.formatHeader : null
  const serializeOptions = { lineEnding: options.lineEnding }
  let text: string
  switch (options.format) {
    case 'srt':
      text = serializeSrt(cues, serializeOptions)
      break
    case 'vtt':
      text = serializeVtt(cues, header, serializeOptions)
      break
    case 'ass':
      text = serializeAss(cues, header, serializeOptions)
      break
    case 'txt': {
      const nl = options.lineEnding === 'crlf' ? '\r\n' : '\n'
      text = cues.map((c) => c.text.replace(/\n/g, nl)).join(nl + nl) + nl
      break
    }
  }

  const suffix = options.content === 'source' ? 'source' : options.content === 'bilingual' ? `${options.profile}.bilingual` : options.profile
  const ext = EXPORT_FORMATS.find((f) => f.id === options.format)!.extension
  return {
    fileName: `${sanitizeFileName(project.name)}.${suffix}.${ext}`,
    text,
    bytes: encodeUtf8(text, options.bom),
    issues,
  }
}

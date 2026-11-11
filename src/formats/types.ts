import type { SegmentFormatMeta, SubtitleFormat } from '../domain/types'

export interface ParsedCue {
  start: number
  end: number
  /** Text with `\n` line breaks; inline markup preserved. */
  text: string
  meta?: SegmentFormatMeta
}

export type ParseWarningKind = 'skipped' | 'unsupported' | 'repaired' | 'info'

export interface ParseWarning {
  kind: ParseWarningKind
  message: string
  /** 1-based line number in the source file, when known. */
  line?: number
}

export interface ParsedSubtitles {
  format: SubtitleFormat
  cues: ParsedCue[]
  /** Format header to preserve on export (ASS script info + styles, VTT STYLE/REGION blocks). */
  header: string | null
  warnings: ParseWarning[]
}

export interface ExportCue {
  start: number
  end: number
  text: string
  meta?: SegmentFormatMeta
}

export type LineEnding = 'crlf' | 'lf'

export interface SerializeOptions {
  lineEnding: LineEnding
}

export class SubtitleParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubtitleParseError'
  }
}

import { formatSrtTime, parseTimecode } from '../domain/time'
import type { ExportCue, ParsedCue, ParsedSubtitles, ParseWarning, SerializeOptions } from './types'
import { SubtitleParseError } from './types'
import { t as L } from '../i18n'

const TIMING = /^\s*(\S+)\s*-->\s*(\S+)(.*)$/

const eol = (o: SerializeOptions) => (o.lineEnding === 'crlf' ? '\r\n' : '\n')

/**
 * Tolerant SRT parser.
 * - Keeps multi-line text and inline tags exactly as written.
 * - Accepts missing cue numbers and `.` as millisecond separator (reported as repaired).
 * - Never drops a block silently: every skipped block produces a warning with its line number.
 */
export function parseSrt(input: string): ParsedSubtitles {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const cues: ParsedCue[] = []
  const warnings: ParseWarning[] = []

  let i = 0
  while (i < lines.length) {
    // Skip blank lines between blocks.
    while (i < lines.length && lines[i].trim() === '') i += 1
    if (i >= lines.length) break

    const blockStart = i
    const block: string[] = []
    while (i < lines.length && lines[i].trim() !== '') {
      block.push(lines[i])
      i += 1
    }

    let timingIndex = block.findIndex((l) => l.includes('-->'))
    if (timingIndex === -1) {
      warnings.push({
        kind: 'skipped',
        line: blockStart + 1,
        message: L('Block without a timing line was skipped: "{block}"', { block: block[0].slice(0, 60) }),
      })
      continue
    }
    if (timingIndex > 1) {
      warnings.push({
        kind: 'skipped',
        line: blockStart + 1,
        message: L('Unexpected text before the timing line; {timingIndex} line(s) ignored.', { timingIndex }),
      })
    }
    if (timingIndex === 0) {
      warnings.push({ kind: 'repaired', line: blockStart + 1, message: L('Cue number missing; renumbered on export.') })
    } else if (!/^\d+$/.test(block[timingIndex - 1].trim())) {
      warnings.push({
        kind: 'repaired',
        line: blockStart + 1,
        message: L('Non-numeric cue identifier "{trim}"; renumbered on export.', { trim: block[timingIndex - 1].trim() }),
      })
    }

    const timingLine = block[timingIndex]
    const match = timingLine.match(TIMING)
    const start = match ? parseTimecode(match[1]) : null
    const end = match ? parseTimecode(match[2]) : null
    if (!match || start === null || end === null) {
      warnings.push({
        kind: 'skipped',
        line: blockStart + timingIndex + 1,
        message: L('Invalid timing "{trim}"; block skipped.', { trim: timingLine.trim() }),
      })
      continue
    }
    if (match[1].includes('.') || match[2].includes('.')) {
      warnings.push({ kind: 'repaired', line: blockStart + timingIndex + 1, message: L('Used "." instead of "," in timecode.') })
    }

    const meta: Record<string, string> = {}
    const extra = match[3].trim()
    if (extra) {
      meta.srtCoordinates = extra
      warnings.push({
        kind: 'unsupported',
        line: blockStart + timingIndex + 1,
        message: L('Position coordinates "{extra}" are kept but not displayed or editable.', { extra }),
      })
    }

    timingIndex += 1
    const textLines = block.slice(timingIndex).map((l) => l.replace(/\s+$/, ''))
    if (textLines.length === 0) {
      warnings.push({ kind: 'info', line: blockStart + 1, message: L('Cue has no text.') })
    }

    cues.push({ start, end, text: textLines.join('\n'), meta: Object.keys(meta).length ? meta : undefined })
  }

  if (cues.length === 0) {
    throw new SubtitleParseError('No valid SRT cues were found. Check that the file is a SubRip (.srt) subtitle file.')
  }

  for (let k = 1; k < cues.length; k += 1) {
    if (cues[k].start < cues[k - 1].start) {
      warnings.push({ kind: 'info', message: L('Cues are not in chronological order. Order is kept as in the file; QC will report it.') })
      break
    }
  }

  return { format: 'srt', cues, header: null, warnings }
}

/** Serialize cues to SRT. Cues are renumbered sequentially from 1. */
export function serializeSrt(cues: ExportCue[], options: SerializeOptions): string {
  const nl = eol(options)
  const blocks = cues.map((cue, index) => {
    const timing = `${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}${cue.meta?.srtCoordinates ? ` ${cue.meta.srtCoordinates}` : ''}`
    // A blank line inside text would terminate the cue; collapse such lines.
    const body = cue.text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join(nl)
    return [String(index + 1), timing, body].join(nl)
  })
  return blocks.join(nl + nl) + nl
}

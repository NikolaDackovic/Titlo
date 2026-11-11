import { formatVttTime, parseTimecode } from '../domain/time'
import type { ExportCue, ParsedCue, ParsedSubtitles, ParseWarning, SerializeOptions } from './types'
import { SubtitleParseError } from './types'
import { t as L } from '../i18n'

/**
 * WebVTT parser. Cue identifiers and cue settings (position, align, line…) are
 * preserved in segment meta. STYLE and REGION blocks are preserved in the header and
 * re-emitted on export, but are not editable; NOTE blocks are reported and dropped.
 */
export function parseVtt(input: string): ParsedSubtitles {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const blocks = text.split(/\n[ \t]*\n/)
  const warnings: ParseWarning[] = []
  const cues: ParsedCue[] = []
  const headerBlocks: string[] = []

  const first = blocks[0] ?? ''
  if (!/^WEBVTT(?:[ \t].*)?$/m.test(first.split('\n')[0] ?? '')) {
    warnings.push({ kind: 'repaired', line: 1, message: L('Missing "WEBVTT" signature; file parsed anyway.') })
  } else {
    blocks.shift()
    const extraHeader = first.split('\n').slice(1).join('\n').trim()
    if (extraHeader) headerBlocks.push(extraHeader)
  }

  let notes = 0
  let lineNo = first.split('\n').length + 1

  for (const raw of blocks) {
    const block = raw.replace(/^\n+/, '').replace(/\n+$/, '')
    const blockLine = lineNo
    lineNo += raw.split('\n').length + 1
    if (!block.trim()) continue

    if (/^NOTE(\s|$)/.test(block)) {
      notes += 1
      continue
    }
    if (/^(STYLE|REGION)(\s|$)/.test(block)) {
      headerBlocks.push(block.trim())
      warnings.push({
        kind: 'unsupported',
        line: blockLine,
        message: L('{v} block preserved on VTT export but not editable or previewed.', { v: block.split(/\s/)[0] }),
      })
      continue
    }

    const lines = block.split('\n')
    const timingIndex = lines.findIndex((l) => l.includes('-->'))
    if (timingIndex === -1 || timingIndex > 1) {
      warnings.push({ kind: 'skipped', line: blockLine, message: L('Block without valid timing skipped: "{lines}"', { lines: lines[0].slice(0, 60) }) })
      continue
    }

    const match = lines[timingIndex].match(/^\s*(\S+)\s+-->\s+(\S+)(.*)$/)
    const start = match ? parseTimecode(match[1]) : null
    const end = match ? parseTimecode(match[2]) : null
    if (!match || start === null || end === null) {
      warnings.push({ kind: 'skipped', line: blockLine + timingIndex, message: L('Invalid timing "{trim}"; cue skipped.', { trim: lines[timingIndex].trim() }) })
      continue
    }

    const meta: Record<string, string> = {}
    if (timingIndex === 1) meta.vttId = lines[0].trim()
    const settings = match[3].trim()
    if (settings) meta.vttSettings = settings

    cues.push({
      start,
      end,
      text: lines
        .slice(timingIndex + 1)
        .map((l) => l.replace(/\s+$/, ''))
        .join('\n'),
      meta: Object.keys(meta).length ? meta : undefined,
    })
  }

  if (notes) warnings.push({ kind: 'unsupported', message: L('{notes} NOTE comment block(s) are not imported.', { notes }) })
  if (cues.length === 0) throw new SubtitleParseError('No valid WebVTT cues were found.')

  return { format: 'vtt', cues, header: headerBlocks.length ? headerBlocks.join('\n\n') : null, warnings }
}

export function serializeVtt(cues: ExportCue[], header: string | null, options: SerializeOptions): string {
  const nl = options.lineEnding === 'crlf' ? '\r\n' : '\n'
  const parts = ['WEBVTT']
  if (header) parts.push(header.replace(/\r?\n/g, nl))
  for (const cue of cues) {
    const lines: string[] = []
    if (cue.meta?.vttId) lines.push(cue.meta.vttId)
    lines.push(`${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}${cue.meta?.vttSettings ? ` ${cue.meta.vttSettings}` : ''}`)
    lines.push(
      ...cue.text
        .split('\n')
        .filter((l) => l.trim() !== '')
        // "-->" is not allowed in cue text.
        .map((l) => l.replace(/-->/g, '->')),
    )
    parts.push(lines.join(nl))
  }
  return parts.join(nl + nl) + nl
}

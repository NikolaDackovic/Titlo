import type { SubtitleFormat } from '../domain/types'
import { parseAss } from './ass'
import { decodeSubtitleBytes, type DecodedText } from './encoding'
import { parseSrt } from './srt'
import type { ParsedSubtitles } from './types'
import { SubtitleParseError } from './types'
import { parseVtt } from './vtt'
import { t as L } from '../i18n'

export * from './types'

export const IMPORT_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa']

export function detectFormat(fileName: string, text: string): SubtitleFormat {
  const ext = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]
  if (ext === '.srt') return 'srt'
  if (ext === '.vtt') return 'vtt'
  if (ext === '.ass' || ext === '.ssa') return 'ass'
  const head = text.replace(/^﻿/, '').trimStart().slice(0, 200)
  if (head.startsWith('WEBVTT')) return 'vtt'
  if (/^\[Script Info\]/i.test(head)) return 'ass'
  if (/-->/.test(text.slice(0, 2000))) return 'srt'
  throw new SubtitleParseError(`Unsupported subtitle file "${fileName}". Supported formats: SRT, VTT, ASS/SSA.`)
}

export function parseSubtitleText(fileName: string, text: string): ParsedSubtitles {
  const format = detectFormat(fileName, text)
  if (format === 'srt') return parseSrt(text)
  if (format === 'vtt') return parseVtt(text)
  return parseAss(text)
}

export interface ImportResult extends ParsedSubtitles {
  encoding: DecodedText['encoding']
  encodingGuessed: boolean
}

/** Parse raw file bytes (encoding detection + format detection + parsing). */
export function parseSubtitleFile(fileName: string, bytes: ArrayBuffer | Uint8Array): ImportResult {
  const MAX_BYTES = 20 * 1024 * 1024
  const size = bytes instanceof Uint8Array ? bytes.byteLength : bytes.byteLength
  if (size > MAX_BYTES) throw new SubtitleParseError('File is larger than 20 MB; this is not a typical subtitle file.')
  const decoded = decodeSubtitleBytes(bytes)
  const parsed = parseSubtitleText(fileName, decoded.text)
  if (decoded.guessed) {
    parsed.warnings.unshift({
      kind: 'repaired',
      message: L('File is not UTF-8. Decoded as {encoding} (detected heuristically). Check diacritics; export will be UTF-8.', { encoding: decoded.encoding }),
    })
  }
  return { ...parsed, encoding: decoded.encoding, encodingGuessed: decoded.guessed }
}

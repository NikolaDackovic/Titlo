import { describe, expect, it } from 'vitest'
import { formatAssTime, formatSrtTime, parseTimecode } from '../domain/time'
import { parseAss, serializeAss } from './ass'
import { decodeSubtitleBytes, encodeUtf8 } from './encoding'
import { buildExport } from './exporter'
import { parseSubtitleFile } from './index'
import { assToHtml, extractMarkupShell, htmlToAss } from './markup'
import { parseSrt, serializeSrt } from './srt'
import { SubtitleParseError } from './types'
import { parseVtt, serializeVtt } from './vtt'
import type { Project, Segment } from '../domain/types'

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello there.
How are you?

2
00:00:04,000 --> 00:00:06,000
<i>Šta ima? Ćao, Đorđe!</i>

3
00:00:06,500 --> 00:00:08,000
Љубав, њега, џеп — ЊЕГОШ
`

describe('timecodes', () => {
  it('parses SRT/VTT/ASS timecodes', () => {
    expect(parseTimecode('00:00:01,000')).toBe(1000)
    expect(parseTimecode('01:02:03.456')).toBe(3_723_456)
    expect(parseTimecode('02:03.5')).toBe(123_500)
    expect(parseTimecode('0:00:01.50')).toBe(1500)
    expect(parseTimecode('00:61:00,000')).toBeNull()
    expect(parseTimecode('abc')).toBeNull()
  })
  it('formats timecodes', () => {
    expect(formatSrtTime(3_723_456)).toBe('01:02:03,456')
    expect(formatSrtTime(-5)).toBe('00:00:00,000')
    expect(formatAssTime(3_723_456)).toBe('1:02:03.46')
  })
})

describe('SRT parser', () => {
  it('parses standard SRT with multi-line text, UTF-8 diacritics and Cyrillic', () => {
    const r = parseSrt(SRT)
    expect(r.cues).toHaveLength(3)
    expect(r.cues[0]).toMatchObject({ start: 1000, end: 3500, text: 'Hello there.\nHow are you?' })
    expect(r.cues[1].text).toBe('<i>Šta ima? Ćao, Đorđe!</i>')
    expect(r.cues[2].text).toBe('Љубав, њега, џеп — ЊЕГОШ')
    expect(r.warnings.filter((w) => w.kind === 'skipped')).toHaveLength(0)
  })

  it('handles CRLF, BOM, extra blank lines and missing numbers', () => {
    const input = '﻿\r\n\r\n1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n\r\n\r\n\r\n00:00:03.000 --> 00:00:04,000\r\nB\r\n'
    const r = parseSrt(input)
    expect(r.cues.map((c) => c.text)).toEqual(['A', 'B'])
    expect(r.warnings.some((w) => w.kind === 'repaired')).toBe(true)
  })

  it('reports invalid timestamps instead of silently dropping', () => {
    const r = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nGood\n\n2\n00:00:xx,000 --> 00:00:04,000\nBad\n')
    expect(r.cues).toHaveLength(1)
    expect(r.warnings.find((w) => w.kind === 'skipped')?.line).toBe(6)
  })

  it('rejects files without cues', () => {
    expect(() => parseSrt('just some text\nwithout timing')).toThrow(SubtitleParseError)
    expect(() => parseSrt('')).toThrow(SubtitleParseError)
  })

  it('keeps cues with end before start (QC reports them)', () => {
    const r = parseSrt('1\n00:00:05,000 --> 00:00:02,000\nBackwards\n')
    expect(r.cues[0]).toMatchObject({ start: 5000, end: 2000 })
  })

  it('round-trips through serialize', () => {
    const r = parseSrt(SRT)
    const out = serializeSrt(r.cues, { lineEnding: 'lf' })
    expect(parseSrt(out).cues).toEqual(r.cues)
    expect(out.startsWith('1\n00:00:01,000 --> 00:00:03,500\nHello there.\nHow are you?\n\n2\n')).toBe(true)
  })

  it('uses CRLF when requested and renumbers sequentially', () => {
    const out = serializeSrt([{ start: 0, end: 1000, text: 'a\nb' }, { start: 2000, end: 3000, text: 'c' }], { lineEnding: 'crlf' })
    expect(out).toBe('1\r\n00:00:00,000 --> 00:00:01,000\r\na\r\nb\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nc\r\n')
  })
})

describe('encoding', () => {
  it('decodes UTF-8 with and without BOM', () => {
    const bytes = encodeUtf8('Čćžšđ ЉЊЏ', true)
    expect(bytes[0]).toBe(0xef)
    expect(decodeSubtitleBytes(bytes)).toMatchObject({ text: 'Čćžšđ ЉЊЏ', encoding: 'utf-8', hadBom: true })
    expect(decodeSubtitleBytes(encodeUtf8('ćao', false)).text).toBe('ćao')
  })

  it('detects Windows-1250 Latin subtitles', () => {
    // "Šta ćeš, ženo?" in cp1250
    const bytes = new Uint8Array([0x8a, 0x74, 0x61, 0x20, 0xe6, 0x65, 0x9a, 0x2c, 0x20, 0x9e, 0x65, 0x6e, 0x6f, 0x3f])
    const r = decodeSubtitleBytes(bytes)
    expect(r.encoding).toBe('windows-1250')
    expect(r.text).toBe('Šta ćeš, ženo?')
  })

  it('detects Windows-1251 Cyrillic subtitles', () => {
    // "Добро јутро" in cp1251
    const bytes = new Uint8Array([0xc4, 0xee, 0xe1, 0xf0, 0xee, 0x20, 0xbc, 0xf3, 0xf2, 0xf0, 0xee])
    const r = decodeSubtitleBytes(bytes)
    expect(r.encoding).toBe('windows-1251')
    expect(r.text).toBe('Добро јутро')
  })

  it('parseSubtitleFile warns about legacy encodings', () => {
    const body = '1\n00:00:01,000 --> 00:00:02,000\n'
    const bytes = new Uint8Array([...new TextEncoder().encode(body), 0x8a, 0x74, 0x61, 0x0a])
    const r = parseSubtitleFile('x.srt', bytes)
    expect(r.cues[0].text).toBe('Šta')
    expect(r.warnings[0].message).toContain('windows-1250')
  })
})

describe('VTT', () => {
  it('parses identifiers, settings, STYLE and NOTE blocks', () => {
    const vtt = `WEBVTT - test

STYLE
::cue { color: yellow }

NOTE this is a comment

intro
00:01.000 --> 00:03.000 align:start line:0
Zdravo
svete

00:00:04.000 --> 00:00:05.000
Drugi`
    const r = parseVtt(vtt)
    expect(r.cues).toHaveLength(2)
    expect(r.cues[0]).toMatchObject({ start: 1000, end: 3000, text: 'Zdravo\nsvete', meta: { vttId: 'intro', vttSettings: 'align:start line:0' } })
    expect(r.header).toContain('STYLE')
    expect(r.warnings.some((w) => w.message.includes('NOTE'))).toBe(true)
    const out = serializeVtt(r.cues, r.header, { lineEnding: 'lf' })
    expect(out).toContain('intro\n00:00:01.000 --> 00:00:03.000 align:start line:0\nZdravo\nsvete')
    expect(parseVtt(out).cues).toEqual(r.cues)
  })
})

describe('ASS', () => {
  const ASS = `[Script Info]
Title: Test
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,Marko,0,0,0,,{\\an8}Prvi red\\Ndrugi, sa zarezom
Comment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,hidden
Dialogue: 1,0:00:04.00,0:00:05.00,Sign,,10,10,10,,{\\i1}Kurziv{\\i0}
`
  it('parses dialogue lines, keeps styles and fields, warns about comments', () => {
    const r = parseAss(ASS)
    expect(r.cues).toHaveLength(2)
    expect(r.cues[0]).toMatchObject({ start: 1000, end: 3500, text: '{\\an8}Prvi red\ndrugi, sa zarezom' })
    expect(r.cues[0].meta).toMatchObject({ assLayer: '0', assStyle: 'Default', assName: 'Marko' })
    expect(r.cues[1].meta?.assStyle).toBe('Sign')
    expect(r.header).toContain('Style: Default,Arial,20')
    expect(r.warnings.some((w) => w.message.includes('Comment'))).toBe(true)
  })
  it('round-trips', () => {
    const r = parseAss(ASS)
    const out = serializeAss(r.cues, r.header, { lineEnding: 'lf' })
    expect(out).toContain('Dialogue: 0,0:00:01.00,0:00:03.50,Default,Marko,0,0,0,,{\\an8}Prvi red\\Ndrugi, sa zarezom')
    expect(parseAss(out).cues).toEqual(r.cues)
  })
})

describe('markup', () => {
  it('extracts wrapping markup and detects inline markup', () => {
    expect(extractMarkupShell('{\\an8}<i>Hello\nthere</i>')).toEqual({ prefix: '{\\an8}<i>', suffix: '</i>', inner: 'Hello\nthere', lostInlineMarkup: false })
    expect(extractMarkupShell('<i>a</i> b <i>c</i>')).toMatchObject({ prefix: '', inner: 'a b c', lostInlineMarkup: true })
    expect(extractMarkupShell('plain')).toMatchObject({ prefix: '', suffix: '', inner: 'plain', lostInlineMarkup: false })
  })
  it('converts between SRT and ASS styling', () => {
    expect(htmlToAss('<i>x</i> <b>y</b>')).toBe('{\\i1}x{\\i0} {\\b1}y{\\b0}')
    expect(assToHtml('{\\an8\\i1}x{\\i0}{\\fs20}')).toEqual({ text: '{\\an8}<i>x</i>', dropped: 1 })
  })
})

describe('exporter', () => {
  const project: Project = {
    id: 'p', name: 'Film: test/1', contentType: 'movie', sourceLanguage: 'en', activeProfile: 'sr-Cyrl', neutralYat: 'ijekavian',
    sourceFormat: 'srt', sourceFileName: 'a.srt', formatHeader: null, createdAt: '', updatedAt: '', lastOpenedAt: null,
  }
  const seg = (id: string, start: number, end: number, source: string, cyr?: string): Segment => ({
    id, start, end, source,
    translations: cyr ? { 'sr-Cyrl': { text: cyr, status: 'approved', origin: 'manual', locked: false, updatedAt: '' } } : {},
  })

  it('exports Cyrillic translation as UTF-8 and sanitizes file name', () => {
    const r = buildExport(project, [seg('a', 0, 1000, 'Hello', 'Здраво, Љубо!')], { format: 'srt', content: 'translation', profile: 'sr-Cyrl', lineEnding: 'lf', bom: false })
    expect(r.fileName).toBe('Film_ test_1.sr-Cyrl.srt')
    expect(new TextDecoder().decode(r.bytes)).toBe('1\n00:00:00,000 --> 00:00:01,000\nЗдраво, Љубо!\n')
    expect(r.issues).toHaveLength(0)
  })

  it('falls back to source and reports missing translations; validates timing', () => {
    const r = buildExport(project, [seg('a', 0, 1000, 'Hello'), seg('b', 3000, 2000, 'Bad')], { format: 'srt', content: 'translation', profile: 'sr-Cyrl', lineEnding: 'lf', bom: true })
    expect(r.bytes[0]).toBe(0xef)
    expect(r.text).toContain('Hello')
    expect(r.issues.some((i) => i.severity === 'warning' && i.message.includes('no Serbian (Cyrillic)'))).toBe(true)
    expect(r.issues.some((i) => i.severity === 'error' && i.message.includes('Segment 2'))).toBe(true)
  })

  it('exports bilingual subtitles', () => {
    const r = buildExport(project, [seg('a', 0, 1000, 'Hello', 'Здраво')], { format: 'srt', content: 'bilingual', profile: 'sr-Cyrl', lineEnding: 'lf', bom: false })
    expect(r.text).toContain('Здраво\n<i>Hello</i>')
  })

  it('reports TEST provider output', () => {
    const s = seg('a', 0, 1000, 'Hello', '[TEST] Hello')
    s.translations['sr-Cyrl']!.origin = 'test'
    const r = buildExport(project, [s], { format: 'vtt', content: 'translation', profile: 'sr-Cyrl', lineEnding: 'lf', bom: false })
    expect(r.text.startsWith('WEBVTT')).toBe(true)
    expect(r.issues.some((i) => i.message.includes('TEST'))).toBe(true)
  })
})

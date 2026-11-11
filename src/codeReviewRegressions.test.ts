/** Regression tests for the code-review findings (Phase 4). */
import { describe, expect, it, vi } from 'vitest'
import type { Segment } from './domain/types'
import { parseAss, serializeAss } from './formats/ass'
import { parseVtt, serializeVtt } from './formats/vtt'
import { applyProposalsToCyrillic, findLocalizationProposals } from './localization/engine'
import { SEED_TERMBASE } from './localization/termbase'
import { cyrillicToLatin, cyrillicToLatinWithMap } from './localization/transliterate'
import { adaptSourceToProfile, insertSegmentAfter, shiftTimes, splitSegment } from './state/segmentOps'
import { LocalLlmProvider } from './translation/providers/localLlm'
import { splitSentences } from './translation/providers/opusMt'

describe('code review regressions', () => {
  it('ASS: sections after [Events] are written after the dialogue lines', () => {
    const input = '[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Zdravo\n\n[Aegisub Extradata]\nData: 1,abc\n'
    const parsed = parseAss(input)
    const out = serializeAss(parsed.cues, parsed.header, { lineEnding: 'lf' })
    expect(out.indexOf('Dialogue:')).toBeLessThan(out.indexOf('[Aegisub Extradata]'))
    expect(out.indexOf('[Events]')).toBeLessThan(out.indexOf('Dialogue:'))
    expect(parseAss(out).cues.map((c) => c.text)).toEqual(['Zdravo'])
  })

  it('VTT: splitting a cue does not duplicate its identifier', () => {
    const parsed = parseVtt('WEBVTT\n\nintro\n00:00:01.000 --> 00:00:05.000\nFirst part. Second part.')
    const segs: Segment[] = parsed.cues.map((c, i) => ({ id: `s${i}`, start: c.start, end: c.end, source: c.text, translations: {}, meta: c.meta }))
    const split = splitSegment(segs, 's0').segments
    const out = serializeVtt(split.map((s) => ({ start: s.start, end: s.end, text: s.source, meta: s.meta })), null, { lineEnding: 'lf' })
    expect(out.match(/^intro$/gm)).toHaveLength(1)
  })

  it('"No." is a sentence, not an abbreviation', () => {
    expect(splitSentences("No. I won't go.")).toEqual(['No.', "I won't go."])
    expect(splitSentences('Mr. Smith is here.')).toEqual(['Mr. Smith is here.'])
  })

  it('shifting earlier keeps cue duration instead of collapsing it to 0–0', () => {
    const segs: Segment[] = [{ id: 'a', start: 1000, end: 3000, source: 'x', translations: {} }]
    expect(shiftTimes(segs, -5000)[0]).toMatchObject({ start: 0, end: 2000 })
  })

  it('insertSegmentAfter can use a caller-provided id (applied on the latest state)', () => {
    const r = insertSegmentAfter([], null, 2000, 'fixed-id')
    expect(r.newId).toBe('fixed-id')
  })

  it('Cyrillic localization edits only the matched word (keeps Latin words and нј pairs)', () => {
    const text = 'Гледао сам BBC и конјункција, купи крух.'
    const { latin } = cyrillicToLatinWithMap(text)
    expect(latin).toBe(cyrillicToLatin(text))
    const { proposals } = findLocalizationProposals(latin, { profile: 'sr-Cyrl', neutralYat: 'ijekavian', termbase: SEED_TERMBASE, rules: [] })
    const bread = proposals.filter((p) => p.ruleId === 'bread')
    expect(applyProposalsToCyrillic(text, bread)).toBe('Гледао сам BBC и конјункција, купи хлеб.')
  })

  it('Local LLM: markup-only segments get an empty result without asking the model', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":[{"id":"b","text":"Zdravo"}]}' } }] })))
    const p = new LocalLlmProvider({ baseUrl: 'http://127.0.0.1:8080', model: 'm', temperature: 0.2, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch)
    const out = await p.translateBatch({ items: [{ id: 'a', text: '', before: [], after: [] }, { id: 'b', text: 'Hello', before: [], after: [] }], sourceLanguage: 'en', target: { profile: 'hr', language: 'sh' as const, variant: 'hr', yat: 'ijekavian', label: '' }, glossary: [], contentType: 'movie', signal: new AbortController().signal })
    expect(out).toEqual([{ id: 'a', text: '' }, { id: 'b', text: 'Zdravo' }])
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).messages[1].content).not.toContain('"id":"a"')
  })

  it('same-language adaptation copies the source, respects locks and manual edits', () => {
    const segs: Segment[] = [
      { id: 'a', start: 0, end: 1000, source: 'Gde je voz?', translations: {} },
      { id: 'b', start: 1000, end: 2000, source: 'Ljubav.', translations: { 'sr-Cyrl': { text: 'Моје.', status: 'translated', origin: 'manual', locked: false, updatedAt: '' } } },
      { id: 'c', start: 2000, end: 3000, source: 'Zaključano.', translations: { 'sr-Cyrl': { text: 'Закључано.', status: 'approved', origin: 'manual', locked: true, updatedAt: '' } } },
    ]
    const r = adaptSourceToProfile(segs, 'sr-Cyrl', true)
    expect(r.adapted).toBe(1)
    expect(r.segments[0].translations['sr-Cyrl']).toMatchObject({ text: 'Где је воз?', status: 'needs_review', origin: 'machine' })
    expect(r.segments[1].translations['sr-Cyrl']?.text).toBe('Моје.')
    expect(r.segments[2].translations['sr-Cyrl']?.text).toBe('Закључано.')
  })
})

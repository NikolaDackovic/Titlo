import { describe, expect, it } from 'vitest'
import type { Segment, SourceStatus } from '../domain/types'
import type { GlossaryTerm } from '../glossary/types'
import { analyzeActivity } from '../media/audioActivity'
import { concat, mix, music, silence, speechLike, SR } from '../test/syntheticAudio'
import { checkTranscript, flaggedSegmentIds, internalRepetition } from './checks/transcript'
import { missedTerms } from './checks/terminology'
import { getQcProfile, runQc, type QcInput } from '.'

// Audio here is SYNTHETIC (src/test/syntheticAudio.ts). These tests check the heuristics and the
// rule "never change text", not recognition accuracy.

let n = 0
const seg = (start: number, end: number, source: string, patch: Partial<Segment> = {}): Segment => ({
  id: `s${(n += 1)}`,
  start,
  end,
  source,
  translations: {},
  sourceOrigin: 'whisper',
  sourceStatus: 'unreviewed',
  ...patch,
})
const checks = (segments: Segment[], audio: Float32Array | null = null) =>
  checkTranscript({ segments, audio: audio ? analyzeActivity(audio, SR) : null })
const codes = (segments: Segment[], audio: Float32Array | null = null) => checks(segments, audio).map((i) => i.check)

describe('Whisper QC — text without speech', () => {
  // 0–4 s speech, 4–10 s silence, 10–14 s music.
  const audio = concat(speechLike(4), silence(6), music(4))

  it('flags text on complete silence', () => {
    const s = seg(5000, 7000, 'you')
    const issues = checks([s], audio)
    expect(issues.map((i) => i.check)).toContain('possible-silence-hallucination')
    expect(issues[0].message).toMatch(/silence|tišina/)
  })

  it('flags a typical filler on music', () => {
    expect(codes([seg(11000, 12500, 'Thank you.')], audio)).toContain('possible-silence-hallucination')
  })

  it('does not flag real speech', () => {
    expect(codes([seg(500, 3500, 'We are going home now.')], audio)).toEqual([])
  })

  it('flags known credit lines even without audio', () => {
    expect(codes([seg(0, 2000, 'Titlovi: www.example.com')])).toContain('possible-silence-hallucination')
    expect(codes([seg(0, 2000, 'Thanks for watching!')])).toContain('possible-silence-hallucination')
  })
})

describe('Whisper QC — repetition', () => {
  it('flags the same sentence in consecutive segments', () => {
    const issues = checks([seg(0, 2000, 'Idemo kući.'), seg(2100, 4000, 'Idemo kući!')])
    expect(issues.filter((i) => i.check === 'possible-repeated-output')).toHaveLength(1)
  })
  it('flags words repeated in a loop inside one segment', () => {
    expect(internalRepetition('I think I think I think so')).toBe('i think')
    expect(internalRepetition('no no no')).toBe('no')
    expect(internalRepetition('Ne, ne, to nije tačno.')).toBeNull()
    expect(codes([seg(0, 4000, 'the the the the problem')])).toContain('possible-repeated-output')
  })
})

describe('Whisper QC — audio activity and unusual segments', () => {
  it('flags a segment that is mostly silent', () => {
    const audio = concat(speechLike(0.5), silence(4))
    expect(codes([seg(0, 4000, 'A long sentence that nobody said here.')], audio)).toContain('possible-low-audio-activity')
  })
  it('suggests checking quiet speech (low volume, not silence)', () => {
    const issues = checks([seg(0, 4000, 'quiet words')], speechLike(4, 0.006))
    const low = issues.find((i) => i.check === 'possible-low-audio-activity')
    expect(low?.severity).toBe('suggestion')
    expect(codes([seg(0, 4000, 'quiet words')], speechLike(4, 0.006))).not.toContain('possible-silence-hallucination')
  })
  it('flags a suspiciously long segment and too much text for the time', () => {
    expect(codes([seg(0, 14000, 'Long.')])).toContain('possible-unusual-segment')
    expect(codes([seg(0, 1000, 'This is far too much text for one single second of speech, really.')])).toContain('possible-unusual-segment')
  })
  it('reports speech that no subtitle covers, with its time range', () => {
    const audio = concat(speechLike(3), silence(2), speechLike(4))
    const issues = checks([seg(0, 3000, 'First sentence here.')], audio)
    const missing = issues.find((i) => i.check === 'possible-missing-speech')
    expect(missing?.range?.startMs).toBeGreaterThanOrEqual(4800)
    expect(missing?.range?.endMs).toBeGreaterThanOrEqual(8800)
  })
  it('reports an empty subtitle over speech', () => {
    expect(codes([seg(0, 3000, '')], speechLike(3))).toContain('possible-missing-speech')
  })
  it('speech with background music is not reported as invented', () => {
    const audio = mix(speechLike(6, 0.25), music(6, 0.05))
    expect(codes([seg(0, 6000, 'Talking over music.')], audio)).toEqual([])
  })
})

describe('Whisper QC — rules', () => {
  it('never changes the segments', () => {
    const audio = concat(silence(5), speechLike(3))
    const segments = [seg(0, 2000, 'you'), seg(2000, 4000, 'you'), seg(5000, 8000, '')]
    const copy = structuredClone(segments)
    checks(segments, audio)
    runQc({ segments, profile: 'sr-Latn', sourceLanguage: 'en', neutralYat: 'ijekavian', qcProfile: getQcProfile('standard'), termbase: [], terminology: [], localizationRules: [], audio: analyzeActivity(audio, SR) } as QcInput)
    expect(segments).toEqual(copy)
  })
  it('skips verified/approved originals and non-Whisper text', () => {
    const silent = silence(4)
    for (const status of ['verified', 'approved'] as SourceStatus[]) expect(codes([seg(0, 3000, 'you', { sourceStatus: status })], silent)).toEqual([])
    expect(codes([seg(0, 3000, 'you', { sourceOrigin: 'import' })], silent)).toEqual([])
    expect(codes([seg(0, 3000, 'you', { sourceStatus: 'manually-edited' })], silent)).toContain('possible-silence-hallucination')
  })
  it('no confidence percentages are invented (explanations only)', () => {
    const issues = checks([seg(5000, 7000, 'you')], concat(speechLike(4), silence(6)))
    for (const i of issues) expect(`${i.message} ${i.suggestion}`).not.toMatch(/confiden|pouzdan/i)
  })
  it('flaggedSegmentIds returns segment warnings only (not gap ranges or suggestions)', () => {
    const audio = concat(silence(3), speechLike(4))
    const segments = [seg(0, 2000, 'you')]
    const ids = flaggedSegmentIds(checks(segments, audio))
    expect([...ids]).toEqual([segments[0].id])
  })
})

describe('Terminology consistency', () => {
  const car: GlossaryTerm = { id: 'car', glossaryId: 'g', kind: 'terminology', sourceTerm: 'car', targetTerm: 'automobil', alternatives: ['auto', 'kola'], sourceLanguage: 'en', targetProfile: 'all', notes: '', context: '', caseSensitive: false, wholeWord: true, priority: 0, enabled: true }
  const input = (segments: Segment[]): QcInput => ({ segments, profile: 'sr-Latn', sourceLanguage: 'en', neutralYat: 'ijekavian', qcProfile: getQcProfile('standard'), termbase: [], terminology: [car], localizationRules: [] })
  const tr = (text: string) => ({ 'sr-Latn': { text, status: 'translated' as const, origin: 'machine' as const, locked: false, updatedAt: '' } })

  it('distinguishes preferred, alternative, inconsistent and missing renderings', () => {
    const only = (segments: Segment[]) => runQc(input(segments)).filter((i) => i.category === 'terminology').map((i) => `${i.check}:${i.severity}`)
    expect(only([seg(0, 2000, 'The car.', { translations: tr('Automobil.') })])).toEqual([])
    expect(only([seg(0, 2000, 'The car.', { translations: tr('Auto.') })])).toEqual(['term-alternative:suggestion'])
    expect(only([seg(0, 2000, 'The car.', { translations: tr('Automobil.') }), seg(3000, 5000, 'My car.', { translations: tr('Moja kola.') })])).toEqual(['term-inconsistent:warning'])
    expect(only([seg(0, 2000, 'The car.', { translations: tr('Vozilo.') })])).toEqual(['glossary-term:warning'])
  })

  it('missedTerms finds machine output that ignores the preferred term (used to mark it for review)', () => {
    const hint = { source: 'car', target: 'automobil', alternatives: ['auto'] }
    expect(missedTerms('Get in the car.', 'Uđi u vozilo.', [hint], false)).toHaveLength(1)
    expect(missedTerms('Get in the car.', 'Uđi u automobil.', [hint], false)).toHaveLength(0)
    expect(missedTerms('Get in the car.', 'Уђи у аутомобил.', [hint], true)).toHaveLength(0)
    expect(missedTerms('No term here.', 'Ništa.', [hint], false)).toHaveLength(0)
  })
})

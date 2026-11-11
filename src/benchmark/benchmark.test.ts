import { describe, expect, it } from 'vitest'
import { findLocalizationProposals } from '../localization/engine'
import { SEED_TERMBASE } from '../localization/termbase'
import { detectYat } from '../localization/yat'
import { corpusChrf, sentenceChrf } from './chrf'
import { BENCHMARK } from './sentences'

describe('benchmark set', () => {
  it('has at least 100 unique items covering all required categories', () => {
    expect(BENCHMARK.length).toBeGreaterThanOrEqual(100)
    expect(new Set(BENCHMARK.map((b) => b.id)).size).toBe(BENCHMARK.length)
    const cats = new Set(BENCHMARK.map((b) => b.category))
    for (const c of ['everyday', 'humor', 'sarcasm', 'profanity', 'romance', 'action', 'technical', 'slang', 'idiom', 'ambiguous', 'long', 'colloquial']) expect(cats).toContain(c)
    for (const b of BENCHMARK) for (const v of [b.en, b.sr, b.hr, b.bs, b.neutral]) expect(v.trim()).not.toBe('')
  })

  it('references are consistent with the yat rules (sr ekavian, others ijekavian)', () => {
    for (const b of BENCHMARK) {
      expect(detectYat(b.sr).ijekavian, `#${b.id} sr`).toEqual([])
      expect(detectYat(b.hr).ekavian, `#${b.id} hr`).toEqual([])
      expect(detectYat(b.bs).ekavian, `#${b.id} bs`).toEqual([])
      expect(detectYat(b.neutral).ekavian, `#${b.id} neutral`).toEqual([])
    }
  })

  it('Croatian references produce no strong regional proposals from the termbase', () => {
    for (const b of BENCHMARK) {
      const strong = findLocalizationProposals(b.hr, { profile: 'hr', neutralYat: 'ijekavian', termbase: SEED_TERMBASE, rules: [] }).proposals.filter((p) => p.source === 'termbase' && p.confidence === 'high')
      expect(strong.map((p) => p.original), `#${b.id}`).toEqual([])
    }
  })
})

describe('chrF', () => {
  it('is 100 for identical text and 0 for disjoint text', () => {
    expect(sentenceChrf('Voz kasni.', 'Voz kasni.')).toBeCloseTo(100)
    expect(sentenceChrf('xyz', 'abc')).toBe(0)
  })
  it('ranks closer variants higher', () => {
    const ref = 'Vlak polazi u sedam.'
    expect(sentenceChrf('Vlak polazi u sedam sati.', ref)).toBeGreaterThan(sentenceChrf('Voz polazi u sedam.', ref))
    expect(corpusChrf([{ hypothesis: ref, reference: ref }])).toBeCloseTo(100)
  })
})

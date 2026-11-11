import { describe, expect, it } from 'vitest'
import { isAdaptation, isEnglishProfile } from '../domain/languages'
import type { Segment } from '../domain/types'
import { runQc, getQcProfile } from '../qc'
import { findLocalizationProposals } from '../localization/engine'
import { SEED_TERMBASE } from '../localization/termbase'
import { mergeSettings } from '../services/settings'
import { buildTarget, isEligible } from './engine'
import { opusDirection } from './providers/opusMt'

const seg = (text: string, origin: 'test' | 'machine' = 'test'): Segment =>
  ({ id: 's1', start: 0, end: 2000, source: 'Hello.', translations: { 'sr-Latn': { text, status: 'needs_review', origin, locked: false } } }) as unknown as Segment

describe('translation directions', () => {
  it('routes English ↔ Serbian/Croatian/Bosnian and adapts sh → sh', () => {
    expect(opusDirection('en', buildTarget('hr', 'ijekavian'))).toBe('en-sh')
    expect(opusDirection('sr', buildTarget('en', 'ijekavian'))).toBe('sh-en')
    expect(opusDirection('bs', buildTarget('en', 'ijekavian'))).toBe('sh-en')
    expect(opusDirection('sr', buildTarget('hr', 'ijekavian'))).toBeNull()
    expect(opusDirection('en', buildTarget('en', 'ijekavian'))).toBeNull()
    expect(isAdaptation('sr', 'hr')).toBe(true)
    expect(isAdaptation('sr', 'en')).toBe(false)
    expect(isAdaptation('en', 'sr-Latn')).toBe(false)
    expect(isEnglishProfile('en')).toBe(true)
  })

  it('never applies regional rules to English subtitles', () => {
    expect(findLocalizationProposals('The train leaves at noon.', { profile: 'en', neutralYat: 'ijekavian', termbase: SEED_TERMBASE, rules: [] }).proposals).toEqual([])
    const s = { id: 'a', start: 0, end: 2500, source: 'Voz kasni.', translations: { en: { text: 'The train is late; mleko, vreme.', status: 'translated', origin: 'machine', locked: false } } } as unknown as Segment
    const issues = runQc({ segments: [s], profile: 'en', sourceLanguage: 'sr', neutralYat: 'ijekavian', qcProfile: getQcProfile('standard'), termbase: SEED_TERMBASE, terminology: [], localizationRules: [], mediaDurationMs: null })
    expect(issues.filter((i) => ['yat', 'regional-term', 'inconsistent-variant', 'wrong-script'].includes(i.check))).toEqual([])
  })
})

describe('TEST provider retirement', () => {
  it('moves a saved TEST provider choice to the real model', () => {
    expect(mergeSettings({ translation: { providerId: 'test' } } as never).translation.providerId).toBe('opus-mt-en-sh')
    expect(mergeSettings({ translation: { providerId: 'local-llm' } } as never).translation.providerId).toBe('local-llm')
  })

  it('always re-translates [TEST] placeholders, but not real machine output', () => {
    expect(isEligible(seg('[TEST→sr-Latn] Hello.'), 'sr-Latn', {})).toBe(true)
    expect(isEligible(seg('Zdravo.', 'machine'), 'sr-Latn', {})).toBe(false)
  })
})

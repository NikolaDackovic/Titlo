import { describe, expect, it } from 'vitest'
import { applyProposals, findLocalizationProposals, findMixedVariantConcepts, type LocalizationContext } from './engine'
import { findTerm, matchCase } from './matching'
import { SEED_TERMBASE, neutralVariantFor } from './termbase'
import { cyrillicToLatin, findMixedScriptWords, latinToCyrillic, scriptOf } from './transliterate'
import { detectYat } from './yat'
import type { ProfileId } from '../domain/languages'

describe('transliteration', () => {
  it('handles all special letters and digraph casing', () => {
    expect(latinToCyrillic('čćšžđ ČĆŠŽĐ')).toBe('чћшжђ ЧЋШЖЂ')
    expect(latinToCyrillic('ljubav njega džep')).toBe('љубав њега џеп')
    expect(latinToCyrillic('Ljubav Njegoš Džep')).toBe('Љубав Његош Џеп')
    expect(latinToCyrillic('LJUBAV NJEGOŠ DŽEP')).toBe('ЉУБАВ ЊЕГОШ ЏЕП')
    expect(latinToCyrillic('Zdravo, Đorđe! Kako si?')).toBe('Здраво, Ђорђе! Како си?')
  })

  it('knows non-digraph exceptions', () => {
    expect(latinToCyrillic('nadživeti')).toBe('надживети')
    expect(latinToCyrillic('konjunkcija')).toBe('конјункција')
    expect(latinToCyrillic('injekcija')).toBe('инјекција')
    expect(latinToCyrillic('podžanr')).toBe('поджанр')
    expect(latinToCyrillic('odžak')).toBe('оџак') // regular digraph
  })

  it('does not touch markup, URLs, e-mails or foreign words', () => {
    expect(latinToCyrillic('<i>Idemo</i> {\\an8}sada')).toBe('<i>Идемо</i> {\\an8}сада')
    expect(latinToCyrillic('Vidi www.example.com i pisi na a@b.rs')).toBe('Види www.example.com и писи на a@b.rs')
    expect(latinToCyrillic('Gledam Netflix i YouTube')).toBe('Гледам Netflix и YouTube')
  })

  it('converts Cyrillic to Latin with correct digraph casing', () => {
    expect(cyrillicToLatin('Љубав ЉУБАВ љубав Џеп ЊЕГОШ')).toBe('Ljubav LJUBAV ljubav Džep NJEGOŠ')
    expect(cyrillicToLatin('Ђорђе, ћао!')).toBe('Đorđe, ćao!')
  })

  it('round-trips ordinary text', () => {
    const samples = ['Ljubav nije šala, Đuro!', 'Njegoš je pisao „Gorski vijenac“.', 'DŽEMPER I LJULJAŠKA', 'Šta ćeš, ženo? Čekaj!']
    for (const s of samples) expect(cyrillicToLatin(latinToCyrillic(s))).toBe(s)
  })

  it('detects mixed-script words and script', () => {
    expect(findMixedScriptWords('Здрaво свете')).toEqual(['Здрaво']) // Latin "a" inside
    expect(scriptOf('Здраво')).toBe('Cyrl')
    expect(scriptOf('Zdravo')).toBe('Latn')
  })
})

describe('matching', () => {
  it('matches whole words with diacritics (no ASCII \\b bug)', () => {
    expect(findTerm('voz vozi vožnja Voz.', 'voz', { wholeWord: true, caseSensitive: false }).map((m) => m.text)).toEqual(['voz', 'Voz'])
    expect(findTerm('šargarepa i šargarepom', 'šargarepa', { wholeWord: true, caseSensitive: false })).toHaveLength(1)
  })
  it('preserves case pattern', () => {
    expect(matchCase('VOZ', 'vlak')).toBe('VLAK')
    expect(matchCase('Voz', 'vlak')).toBe('Vlak')
    expect(matchCase('voz', 'vlak')).toBe('vlak')
  })
})

const ctx = (profile: ProfileId, extra: Partial<LocalizationContext> = {}): LocalizationContext => ({
  profile,
  neutralYat: 'ijekavian',
  termbase: SEED_TERMBASE,
  rules: [],
  ...extra,
})

describe('localization engine', () => {
  it('proposes Croatian forms with the right case ending', () => {
    const { proposals } = findLocalizationProposals('Idemo vozom u Zagreb, voz kasni.', ctx('hr'))
    const train = proposals.filter((p) => p.ruleId === 'train')
    expect(train.map((p) => [p.original, p.replacement])).toEqual([
      ['vozom', 'vlakom'],
      ['voz', 'vlak'],
    ])
  })

  it('does not touch the verb "vozi" or unrelated words', () => {
    const { proposals } = findLocalizationProposals('On vozi auto po gradu.', ctx('hr'))
    expect(proposals.filter((p) => p.source === 'termbase')).toHaveLength(0)
  })

  it('proposes Serbian forms for Serbian and keeps valid ones', () => {
    const { proposals } = findLocalizationProposals('Kupi kruh i mrkvu. Voz stiže.', ctx('sr-Latn'))
    expect(proposals.filter((p) => p.source === 'termbase').map((p) => p.replacement)).toEqual(['hleb', 'šargarepu'])
  })

  it('marks capitalised mid-sentence matches (possible names) for review', () => {
    const { proposals } = findLocalizationProposals('Gledali smo film Kino Europa.', ctx('sr-Latn'))
    const p = proposals.find((x) => x.ruleId === 'cinema')
    expect(p?.confidence).toBe('review')
  })

  it('ExYu Neutral uses majority forms only and leaves three-way differences alone', () => {
    expect(neutralVariantFor(SEED_TERMBASE.find((c) => c.id === 'bread')!)).toBeNull()
    expect(neutralVariantFor(SEED_TERMBASE.find((c) => c.id === 'thousand')!)).toBe('sr')
    const { proposals } = findLocalizationProposals('Tisuću puta sam rekao: kruh i hleb.', ctx('exyu-neutral'))
    const tb = proposals.filter((p) => p.source === 'termbase')
    expect(tb.map((p) => p.replacement)).toEqual(['Hiljadu'])
  })

  it('restricts directional rules ("što" is not changed for Serbian)', () => {
    expect(findLocalizationProposals('Što si došao?', ctx('sr-Latn')).proposals.filter((p) => p.ruleId === 'what')).toHaveLength(0)
    expect(findLocalizationProposals('Šta radiš?', ctx('hr')).proposals.find((p) => p.ruleId === 'what')?.replacement).toBe('Što')
  })

  it('does not auto-accept otok→ostrvo for Bosnian (false positive found on real model output)', () => {
    const p = findLocalizationProposals('Cijelo ljeto smo proveli na otoku.', ctx('bs')).proposals.find((x) => x.ruleId === 'island')
    expect(p?.confidence).toBe('review')
  })

  it('flags "nedelja" as ambiguous (week vs Sunday)', () => {
    const p = findLocalizationProposals('Vidimo se za nedelju dana.', ctx('hr')).proposals.find((x) => x.ruleId === 'week')
    expect(p?.confidence).toBe('review')
    expect(p?.reason).toContain('Sunday')
  })

  it('adds Croatian modal "da" syntax advice without automatic replacement', () => {
    const p = findLocalizationProposals('Moram da idem.', ctx('hr')).proposals.find((x) => x.source === 'syntax')
    expect(p?.replacement).toBeNull()
  })

  it('yat proposals for wrong reflex', () => {
    const p = findLocalizationProposals('Gde je mleko?', ctx('hr')).proposals.filter((x) => x.source === 'yat')
    expect(p.map((x) => x.replacement)).toEqual(['Gdje', 'mlijeko'])
  })

  it('glossary rules win over termbase, respect exceptions, and report conflicts', () => {
    const rules = [{ id: 'r1', from: 'voz', to: 'vlakić', profiles: [], wholeWord: true, caseSensitive: false, priority: 0, exceptions: ['Voz Express'] }]
    const r = findLocalizationProposals('Voz Express i voz.', ctx('hr', { rules }))
    expect(r.proposals.filter((p) => p.source === 'glossary').map((p) => p.original)).toEqual(['voz'])
    expect(r.conflicts.length).toBeGreaterThan(0)
  })

  it('never matches inside markup', () => {
    const { proposals } = findLocalizationProposals('<font color="voz">tekst</font>', ctx('hr'))
    expect(proposals).toHaveLength(0)
  })

  it('applies accepted proposals and keeps the rest', () => {
    const text = 'Voz kasni, kupi kruh.'
    const { proposals } = findLocalizationProposals(text, ctx('sr-Latn'))
    const onlyBread = proposals.filter((p) => p.ruleId === 'bread')
    expect(applyProposals(text, onlyBread)).toBe('Voz kasni, kupi hleb.')
  })

  it('refuses to apply stale proposals', () => {
    const { proposals } = findLocalizationProposals('kruh', ctx('sr-Latn'))
    expect(() => applyProposals('hleb', proposals)).toThrow()
  })

  it('detects inconsistent variants across a project', () => {
    const mixed = findMixedVariantConcepts(['Uzmi kruh.', 'Nema hleba.'], SEED_TERMBASE)
    expect(mixed.map((m) => m.concept.id)).toContain('bread')
    expect(findMixedVariantConcepts(['Uzmi kruh.', 'Nema kruha.'], SEED_TERMBASE)).toHaveLength(0)
  })

  it('detects yat reflex', () => {
    expect(detectYat('Gdje je mlijeko? Uvek isto.')).toEqual({ ekavian: ['uvek'], ijekavian: ['gdje', 'mlijeko'] })
  })
})

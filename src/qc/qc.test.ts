import { describe, expect, it } from 'vitest'
import type { ProfileId } from '../domain/languages'
import type { Segment, TranslationOrigin } from '../domain/types'
import { SEED_TERMBASE } from '../localization/termbase'
import { emptyTerm, type GlossaryTerm } from '../glossary/types'
import { getQcProfile, runQc } from './index'
import type { QcInput } from './types'

let n = 0
const seg = (start: number, end: number, source: string, translation?: string, profile: ProfileId = 'sr-Latn', origin: TranslationOrigin = 'machine'): Segment => ({
  id: `s${++n}`,
  start,
  end,
  source,
  translations: translation === undefined ? {} : { [profile]: { text: translation, status: 'translated', origin, locked: false, updatedAt: '' } },
})

const input = (segments: Segment[], patch: Partial<QcInput> = {}): QcInput => ({
  segments,
  profile: 'sr-Latn',
  sourceLanguage: 'en',
  neutralYat: 'ijekavian',
  qcProfile: getQcProfile('standard'),
  termbase: SEED_TERMBASE,
  terminology: [],
  localizationRules: [],
  ...patch,
})

const checks = (i: QcInput) => runQc(i).map((x) => x.check)

describe('QC timing', () => {
  it('detects overlap, invalid and negative timestamps, discontinuity', () => {
    const issues = runQc(input([seg(0, 2000, 'A.', 'A.'), seg(1500, 3000, 'B.', 'B.'), seg(-100, 900, 'C.', 'C.'), seg(5000, 4000, 'D.', 'D.')]))
    const ids = issues.map((i) => i.check)
    expect(ids).toContain('overlap')
    expect(ids).toContain('negative-time')
    expect(ids).toContain('discontinuity')
    expect(ids).toContain('end-before-start')
    expect(issues.find((i) => i.check === 'overlap')?.severity).toBe('error')
  })
  it('detects too short / too long / unrealistic durations and small gaps', () => {
    const c = checks(input([seg(0, 500, 'Kratko.', 'Kratko.'), seg(540, 9000, 'Dugo.', 'Dugo.'), seg(10_000, 50_000, 'Predugo.', 'Predugo.')]))
    expect(c).toEqual(expect.arrayContaining(['too-short', 'too-long', 'unrealistic-duration', 'small-gap']))
  })
})

describe('QC readability', () => {
  it('flags CPS, line length and too many lines', () => {
    const long = 'Ovo je jedna veoma dugačka rečenica koja sigurno prelazi limit.'
    const c = checks(input([seg(0, 1000, 'x', long), seg(2000, 6000, 'y', 'jedan\ndva\ntri.')]))
    expect(c).toEqual(expect.arrayContaining(['cps', 'chars-per-line', 'max-lines']))
  })
  it('ignores markup when counting characters', () => {
    const t = '<i>' + 'a'.repeat(40) + '</i>'
    expect(checks(input([seg(0, 5000, 'x', t + '.')]))).not.toContain('chars-per-line')
  })
  it('flags dangling short words at the end of the first line', () => {
    expect(checks(input([seg(0, 4000, 'x', 'Idemo kući i\nsve će biti dobro.')]))).toContain('line-break')
  })
})

describe('QC language', () => {
  it('flags empty segments, missing translations and duplicates', () => {
    const c = checks(input([seg(0, 2000, '', ''), seg(3000, 5000, 'Hello.'), seg(6000, 8000, 'Hi.', 'Zdravo.'), seg(9000, 11000, 'Hi.', 'Zdravo.')]))
    expect(c).toEqual(expect.arrayContaining(['empty-source', 'untranslated', 'duplicate']))
  })
  it('flags TEST provider output as error', () => {
    const issues = runQc(input([seg(0, 2000, 'Hello.', '[TEST] Hello.', 'sr-Latn', 'test')]))
    expect(issues.find((i) => i.check === 'test-output')?.severity).toBe('error')
  })
  it('flags missing punctuation and lowercase sentence start', () => {
    const c = checks(input([seg(0, 2000, 'x', 'Ovo je kraj'), seg(3000, 5000, 'y', 'Novi početak.'), seg(6000, 8000, 'z', 'mala slova.')]))
    expect(c).toEqual(expect.arrayContaining(['missing-punctuation', 'capitalisation']))
  })
  it('checks script for Cyrillic profile and mixed-script words', () => {
    const c = checks(input([seg(0, 3000, 'x', 'Здраво, ovo je latinica.', 'sr-Cyrl'), seg(4000, 7000, 'y', 'Здрaво.', 'sr-Cyrl')], { profile: 'sr-Cyrl' }))
    expect(c).toEqual(expect.arrayContaining(['wrong-script', 'mixed-script']))
  })
  it('checks yat reflex per profile, including Cyrillic', () => {
    expect(checks(input([seg(0, 3000, 'x', 'Gdje je mlijeko?', 'sr-Latn')]))).toContain('yat')
    expect(checks(input([seg(0, 3000, 'x', 'Gde je mleko?', 'hr')], { profile: 'hr' }))).toContain('yat')
    expect(checks(input([seg(0, 3000, 'x', 'Гдје је млијеко?', 'sr-Cyrl')], { profile: 'sr-Cyrl' }))).toContain('yat')
    expect(checks(input([seg(0, 3000, 'x', 'Gdje je mlijeko?', 'hr')], { profile: 'hr' }))).not.toContain('yat')
  })
  it('reports regional wording and project-level inconsistency', () => {
    const c = checks(input([seg(0, 3000, 'x', 'Kupi kruh.', 'hr'), seg(4000, 7000, 'y', 'Nema hleba.', 'hr')], { profile: 'hr' }))
    expect(c).toEqual(expect.arrayContaining(['regional-term', 'inconsistent-variant']))
  })
})

describe('QC terminology', () => {
  const term = (patch: Partial<GlossaryTerm>): GlossaryTerm => ({ ...emptyTerm(), id: 't1', glossaryId: 'g', ...patch })
  it('warns when a glossary term is not used, accepting inflected forms', () => {
    const terminology = [term({ sourceTerm: 'apartment', targetTerm: 'stan' })]
    expect(checks(input([seg(0, 3000, 'The apartment is big.', 'Kuća je velika.')], { terminology }))).toContain('glossary-term')
    expect(checks(input([seg(0, 3000, 'In the apartment.', 'U stanu.')], { terminology }))).not.toContain('glossary-term')
    const car = [term({ sourceTerm: 'car', targetTerm: 'automobil' })]
    expect(checks(input([seg(0, 3000, 'Get in the car.', 'Uđi u automobil.')], { terminology: car }))).not.toContain('glossary-term')
    expect(checks(input([seg(0, 3000, 'By car.', 'Automobilom.')], { terminology: car }))).not.toContain('glossary-term')
  })
})

describe('QC formatting', () => {
  it('flags unbalanced tags, double spaces, space before punctuation', () => {
    const c = checks(input([seg(0, 3000, 'x', '<i>Zdravo  svete .')]))
    expect(c).toEqual(expect.arrayContaining(['unbalanced-tag', 'double-space', 'space-before-punctuation']))
  })
  it('never modifies segments', () => {
    const segments = [seg(0, 100, 'x', 'y')]
    const before = JSON.stringify(segments)
    runQc(input(segments))
    expect(JSON.stringify(segments)).toBe(before)
  })
})

/**
 * WER/CER unit tests. Every expected value below was counted by hand
 * (reference length N, substitutions S, deletions D, insertions I; rate = (S+D+I)/N).
 */
import { describe, expect, it } from 'vitest'
import { aggregate, align, normalizedText, scoreSample, strictText } from './metrics'

describe('WER', () => {
  it('counts one substitution and one deletion (N=6 → 2/6)', () => {
    // ref: the cat sat on the mat | hyp: the cat sit on mat → sat→sit (S), "the" missing (D)
    const { wer } = scoreSample('the cat sat on the mat', 'the cat sit on mat').normalized
    expect(wer).toMatchObject({ n: 6, substitutions: 1, deletions: 1, insertions: 0, hits: 4 })
    expect(wer.rate).toBeCloseTo(2 / 6, 10)
  })

  it('counts insertions (N=2, I=1 → 0.5) and can exceed 100 %', () => {
    expect(scoreSample('a b', 'a x b').normalized.wer).toMatchObject({ n: 2, insertions: 1, rate: 0.5 })
    // ref "yes" (N=1) vs hyp "yes yes yes" → I=2 → 200 %
    expect(scoreSample('Yes.', 'yes yes yes').normalized.wer.rate).toBe(2)
  })

  it('a completely missing transcript is 100 % deletions', () => {
    expect(scoreSample('dobro jutro svima', '').normalized.wer).toMatchObject({ n: 3, deletions: 3, rate: 1 })
  })

  it('empty reference: rate is undefined (null), insertions are still counted', () => {
    expect(scoreSample('', '').normalized.wer).toMatchObject({ n: 0, rate: null })
    expect(scoreSample('', 'Thank you.').normalized.wer).toMatchObject({ n: 0, insertions: 2, rate: null })
  })

  it('reproduces the real "I am Yuri" error', () => {
    // ref (normalized): hello i am your ai assistant welcome aboard (N=8)
    // hyp (normalized): hello i'm yuri i assistant welcome aboard  (7 words)
    // alignment: hello=, i→i'm (S), am→yuri (S), your→i (S), ai (D), assistant=, welcome=, aboard=
    const { wer } = scoreSample('Hello, I am your AI assistant. Welcome aboard.', "Hello, I'm Yuri, I assistant. Welcome aboard.").normalized
    expect(wer).toMatchObject({ n: 8, substitutions: 3, deletions: 1, insertions: 0 })
    expect(wer.rate).toBe(0.5)
  })
})

describe('strict vs normalized', () => {
  it('strict counts case and punctuation, normalized does not', () => {
    const s = scoreSample('Hello, world.', 'hello world')
    expect(s.strict.wer).toMatchObject({ n: 2, substitutions: 2, rate: 1 })
    expect(s.normalized.wer.rate).toBe(0)
  })

  it('case in names is a strict error only', () => {
    const s = scoreSample('Novak Djokovic', 'novak djokovic')
    expect(s.strict.wer.rate).toBe(1)
    expect(s.normalized.wer.rate).toBe(0)
  })

  it('apostrophe and quote variants are equal after normalization', () => {
    expect(normalizedText('Don’t „stop“ — now!')).toBe("don't stop now")
    expect(scoreSample("don't", 'don’t').normalized.wer.rate).toBe(0)
  })

  it('keeps word-internal hyphens and numbers as written', () => {
    expect(normalizedText('E-mail: 9:30, (deset)')).toBe('e-mail 9 30 deset')
    // numbers are not normalized: "9:30" vs "nine thirty" is an error in both views
    expect(scoreSample('nine thirty', '9:30').normalized.wer).toMatchObject({ n: 2, substitutions: 2 })
  })

  it('Cyrillic vs Latin script is the same words after normalization, but flagged', () => {
    const s = scoreSample('Добро јутро', 'Dobro jutro')
    expect(s.strict.wer.rate).toBe(1)
    expect(s.normalized.wer.rate).toBe(0)
    expect(s.scriptDiffers).toBe(true)
    expect(scoreSample('Dobro jutro', 'Dobro jutro').scriptDiffers).toBe(false)
  })

  it('strict text only collapses whitespace (NFC)', () => {
    expect(strictText('  Ćao,\n  svete!  ')).toBe('Ćao, svete!')
    // decomposed "c + combining acute" equals precomposed "ć"
    expect(scoreSample('ć', 'ć').strict.cer.rate).toBe(0)
  })
})

describe('diacritics, variants and endings are never hidden', () => {
  it('missing diacritics stay errors (WER 2/2) and are reported as diacritic-only', () => {
    const s = scoreSample('Ćao, kuća', 'Cao kuca')
    expect(s.normalized.wer).toMatchObject({ n: 2, substitutions: 2, rate: 1 })
    expect(s.diacriticOnlyErrors).toBe(2)
  })

  it('č vs ć is a character error (CER 1/3)', () => {
    expect(scoreSample('čaj', 'ćaj').normalized.cer).toMatchObject({ n: 3, substitutions: 1 })
    expect(scoreSample('čaj', 'ćaj').normalized.cer.rate).toBeCloseTo(1 / 3, 10)
  })

  it('đ vs dj: one substitution + one insertion at character level', () => {
    // "đak" (3 chars) vs "djak" (4 chars): đ→d (S), +j (I) → CER 2/3
    expect(scoreSample('đak', 'djak').normalized.cer).toMatchObject({ n: 3, substitutions: 1, insertions: 1 })
  })

  it('ekavian vs ijekavian is an error', () => {
    // mlijeko (7) → mleko (5): delete i, j → CER 2/7; WER 1/1
    const s = scoreSample('mlijeko', 'mleko')
    expect(s.normalized.wer.rate).toBe(1)
    expect(s.normalized.cer).toMatchObject({ n: 7, deletions: 2 })
    expect(s.diacriticOnlyErrors).toBe(0)
  })

  it('wrong case ending is an error', () => {
    expect(scoreSample('vidim kuću', 'vidim kuća').normalized.wer).toMatchObject({ n: 2, substitutions: 1, rate: 0.5 })
  })
})

describe('CER', () => {
  it('counts characters including spaces (N=9)', () => {
    // "kuća moja" (9 chars) → "kuca moja": 1 substitution
    expect(scoreSample('kuća moja', 'kuca moja').normalized.cer).toMatchObject({ n: 9, substitutions: 1 })
  })

  it('strict CER counts punctuation and case characters', () => {
    // "Ok." (3) vs "ok": O→o (S), "." (D) → 2/3
    expect(scoreSample('Ok.', 'ok').strict.cer).toMatchObject({ n: 3, substitutions: 1, deletions: 1 })
  })
})

describe('alignment and aggregation', () => {
  it('produces an ordered edit script', () => {
    expect(align(['a', 'b', 'c', 'd'], ['a', 'c', 'd', 'e'])).toEqual([
      { op: 'ok', ref: 'a', hyp: 'a' },
      { op: 'del', ref: 'b', hyp: null },
      { op: 'ok', ref: 'c', hyp: 'c' },
      { op: 'ok', ref: 'd', hyp: 'd' },
      { op: 'ins', ref: null, hyp: 'e' },
    ])
  })

  it('on equal cost, prefers a substitution over a deletion + insertion (same error total)', () => {
    // a b c → a c d: S,S (cost 2) and D,I (cost 2) are both minimal
    const steps = align(['a', 'b', 'c'], ['a', 'c', 'd'])
    expect(steps.map((s) => s.op)).toEqual(['ok', 'sub', 'sub'])
  })

  it('corpus WER is total edits / total words, not the mean of sample rates', () => {
    const a = scoreSample('one two three four', 'one two three four').normalized.wer // 0/4
    const b = scoreSample('five', 'six').normalized.wer // 1/1
    // mean of rates would be 50 %; corpus rate is 1/5 = 20 %
    expect(aggregate([a, b])).toMatchObject({ n: 5, substitutions: 1, rate: 0.2 })
    expect(aggregate([])).toMatchObject({ n: 0, rate: null })
  })
})

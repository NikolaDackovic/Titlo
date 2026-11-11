import { describe, expect, it } from 'vitest'
import { decideLanguage, pickDetectionWindows, softmaxSubset, tokenProbability, type WindowDetection } from './languageDetection'

const SR = 16000
const tone = (sec: number, amp = 0.2) => Float32Array.from({ length: sec * SR }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / SR))
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const win = (languages: Record<string, number>, noSpeechProb = 0.02, activeFraction = 0.9): WindowDetection => ({ languages, noSpeechProb, activeFraction })

describe('softmax helpers', () => {
  it('softmax over a subset sums to 1 and keeps order', () => {
    const logits = [0, 2, 1, 5]
    const p = softmaxSubset(logits, [1, 2])
    expect(p[0] + p[1]).toBeCloseTo(1, 12)
    expect(p[0]).toBeCloseTo(Math.exp(2) / (Math.exp(2) + Math.exp(1)), 12)
  })
  it('token probability uses the full vocabulary', () => {
    expect(tokenProbability([0, 0, 0, 0], 2)).toBeCloseTo(0.25, 12)
  })
})

describe('pickDetectionWindows', () => {
  it('finds no window in digital silence', () => {
    const r = pickDetectionWindows(new Float32Array(10 * SR), SR)
    expect(r.windows).toEqual([])
    expect(r.speechSeconds).toBe(0)
  })
  it('skips a silent intro and keeps at most three loud windows in time order', () => {
    const audio = concat(new Float32Array(60 * SR), tone(30), tone(30, 0.001), tone(30), tone(30), tone(30))
    const r = pickDetectionWindows(audio, SR)
    expect(r.windows).toHaveLength(3)
    expect(r.windows.every((w) => w.start >= 60 * SR)).toBe(true)
    expect(r.windows.map((w) => w.start)).toEqual([...r.windows.map((w) => w.start)].sort((a, b) => a - b))
    expect(r.speechSeconds).toBeCloseTo(120, 0)
  })
  it('handles audio shorter than one window', () => {
    const r = pickDetectionWindows(tone(3), SR)
    expect(r.windows).toHaveLength(1)
    expect(r.windows[0]).toMatchObject({ start: 0, end: 3 * SR })
  })
})

describe('decideLanguage', () => {
  it('detects English', () => {
    const d = decideLanguage([win({ en: 0.95, de: 0.03, sr: 0.02 })], 10)
    expect(d).toMatchObject({ status: 'detected', language: 'en', variantIsHint: false, reason: 'ok' })
    expect(d.probability).toBeCloseTo(0.95)
  })

  it('treats Serbian, Croatian and Bosnian as one group; the variant is only a hint', () => {
    // No single variant is above 60 %, but the group clearly is.
    const d = decideLanguage([win({ hr: 0.4, sr: 0.3, bs: 0.25, sl: 0.05 })], 20)
    expect(d).toMatchObject({ status: 'detected', language: 'hr', variantIsHint: true })
    expect(d.groups.sh).toBeCloseTo(0.95)
  })

  it('returns no-speech when there is no window (silence)', () => {
    expect(decideLanguage([], 0)).toMatchObject({ status: 'no-speech', language: null, reason: 'silence' })
  })

  it('returns no-speech when the model hears no speech (music/noise)', () => {
    expect(decideLanguage([win({ en: 0.7, sr: 0.3 }, 0.85)], 10)).toMatchObject({ status: 'no-speech', reason: 'model-no-speech' })
  })

  it('does not decide on very short speech', () => {
    expect(decideLanguage([win({ en: 0.99 })], 1.2)).toMatchObject({ status: 'uncertain', reason: 'too-short', language: 'en' })
  })

  it('does not decide when the language is not supported', () => {
    const d = decideLanguage([win({ ru: 0.8, sr: 0.1, en: 0.1 })], 10)
    expect(d).toMatchObject({ status: 'uncertain', reason: 'unsupported-language', language: null })
    expect(d.groups.otherCode).toBe('ru')
  })

  it('does not decide when probabilities are low', () => {
    expect(decideLanguage([win({ en: 0.45, de: 0.35, sr: 0.2 })], 10)).toMatchObject({ status: 'uncertain', reason: 'low-probability', language: 'en' })
  })

  it('averages windows weighted by how much sound they contain', () => {
    const d = decideLanguage([win({ en: 1 }, 0.02, 0.1), win({ sr: 1 }, 0.02, 0.9)], 40)
    expect(d.groups.sh).toBeCloseTo(0.9)
    expect(d.language).toBe('sr')
  })

  it('ignores windows whose no-speech probability could not be measured', () => {
    const d = decideLanguage([win({ en: 0.9, sr: 0.1 }, Number.NaN), win({ en: 0.9, sr: 0.1 }, 0.1)], 10)
    expect(d.noSpeechProb).toBeCloseTo(0.1)
    expect(d.status).toBe('detected')
  })
})

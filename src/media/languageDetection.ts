/**
 * Spoken-language detection for "Detect automatically" (pure logic, unit-tested).
 *
 * Transformers.js 4.3 has no language detection for Whisper: with no language it silently
 * forces English ("No language specified - defaulting to English"). We therefore do what
 * OpenAI Whisper does: one decoder step after <|startoftranscript|>, softmax over the
 * language tokens only. The same step's full-vocabulary softmax at <|nocaptions|> is
 * Whisper's own no-speech probability.
 *
 * Serbian, Croatian and Bosnian are one group here: Whisper cannot reliably tell them
 * apart from audio (they are mutually intelligible standards of one language), so the
 * group decision is reported, and the closest variant is only a hint.
 */
import type { SourceLanguage } from '../domain/languages'

/** Raw output of one detection window (from the worker). */
export interface WindowDetection {
  /** Probability per Whisper language code (sums to 1 over the language tokens). */
  languages: Record<string, number>
  /** Whisper no-speech probability (full-vocabulary softmax at <|nocaptions|>). */
  noSpeechProb: number
  /** Fraction (0–1) of 20 ms frames in this window that contain sound above the floor. */
  activeFraction: number
}

export interface LanguageCandidate {
  code: string
  probability: number
}

export type DetectionStatus = 'detected' | 'uncertain' | 'no-speech'

export interface LanguageDetection {
  status: DetectionStatus
  /** Language to transcribe with (only when status is 'detected'). */
  language: SourceLanguage | null
  /** Probability of the winning group (English, or Serbian+Croatian+Bosnian). */
  probability: number
  /** True only for the sr/hr/bs group: the exact variant is a hint, not a decision. */
  variantIsHint: boolean
  groups: { en: number; sh: number; other: number; otherCode: string | null }
  /** Top languages as the model saw them, averaged over windows. */
  candidates: LanguageCandidate[]
  noSpeechProb: number
  windows: number
  speechSeconds: number
  reason: 'ok' | 'silence' | 'model-no-speech' | 'too-short' | 'unsupported-language' | 'low-probability'
}

export interface DetectionWindow {
  start: number // sample index
  end: number
  activeFraction: number
}

export const DETECTION_WINDOW_SEC = 30
/** Frame RMS above this (≈ −40 dBFS) counts as sound. */
export const ACTIVE_RMS = 0.01
/** Thresholds (initial values, see docs/SPEECH_ACCURACY_REPORT.md for how they were checked). */
export const MIN_SPEECH_SEC = 2
export const MIN_PROBABILITY = 0.6
export const NO_SPEECH_LIMIT = 0.6

const SH = ['sr', 'hr', 'bs'] as const

/**
 * Pick up to `maxWindows` 30-second windows that contain the most sound, in time order.
 * Long files are sampled in several places so an intro (music, silence) does not decide alone.
 */
export function pickDetectionWindows(samples: Float32Array, sampleRate: number, maxWindows = 3): { windows: DetectionWindow[]; speechSeconds: number } {
  const frame = Math.round(0.02 * sampleRate)
  const win = DETECTION_WINDOW_SEC * sampleRate
  const all: DetectionWindow[] = []
  let activeFrames = 0
  for (let start = 0; start < samples.length; start += win) {
    const end = Math.min(samples.length, start + win)
    let active = 0
    let frames = 0
    for (let f = start; f + frame <= end; f += frame) {
      let sum = 0
      for (let i = f; i < f + frame; i += 1) sum += samples[i] * samples[i]
      if (Math.sqrt(sum / frame) > ACTIVE_RMS) active += 1
      frames += 1
    }
    activeFrames += active
    all.push({ start, end, activeFraction: frames ? active / frames : 0 })
  }
  const speechSeconds = (activeFrames * frame) / sampleRate
  const windows = all
    .filter((w) => w.activeFraction > 0.05)
    .sort((a, b) => b.activeFraction - a.activeFraction)
    .slice(0, maxWindows)
    .sort((a, b) => a.start - b.start)
  return { windows, speechSeconds }
}

/** Softmax over a subset of logits (by token id). */
export function softmaxSubset(logits: ArrayLike<number>, ids: number[]): number[] {
  let max = Number.NEGATIVE_INFINITY
  for (const id of ids) max = Math.max(max, logits[id])
  const exps = ids.map((id) => Math.exp(logits[id] - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sum)
}

/** Full-vocabulary softmax probability of one token. */
export function tokenProbability(logits: ArrayLike<number>, id: number): number {
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < logits.length; i += 1) max = Math.max(max, logits[i])
  let sum = 0
  for (let i = 0; i < logits.length; i += 1) sum += Math.exp(logits[i] - max)
  return Math.exp(logits[id] - max) / sum
}

/** Combine windows into one decision. */
export function decideLanguage(windows: WindowDetection[], speechSeconds: number): LanguageDetection {
  const empty: LanguageDetection = {
    status: 'no-speech',
    language: null,
    probability: 0,
    variantIsHint: false,
    groups: { en: 0, sh: 0, other: 0, otherCode: null },
    candidates: [],
    noSpeechProb: 1,
    windows: windows.length,
    speechSeconds,
    reason: 'silence',
  }
  if (!windows.length) return empty

  // Windows with more sound count more; if none has a measured fraction, weigh them equally.
  const total = windows.reduce((s, w) => s + w.activeFraction, 0)
  const weight = (w: WindowDetection) => (total > 0 ? w.activeFraction / total : 1 / windows.length)
  const avg: Record<string, number> = {}
  for (const w of windows) for (const [code, p] of Object.entries(w.languages)) avg[code] = (avg[code] ?? 0) + p * weight(w)
  // No-speech probability is averaged only over windows where the model could report it.
  const measured = windows.filter((w) => Number.isFinite(w.noSpeechProb))
  const measuredWeight = measured.reduce((s, w) => s + weight(w), 0)
  const noSpeechProb = measuredWeight > 0 ? measured.reduce((s, w) => s + w.noSpeechProb * weight(w), 0) / measuredWeight : 0
  const candidates = Object.entries(avg)
    .map(([code, probability]) => ({ code, probability }))
    .sort((a, b) => b.probability - a.probability)
  const en = avg.en ?? 0
  const sh = SH.reduce((s, c) => s + (avg[c] ?? 0), 0)
  const other = candidates.find((c) => c.code !== 'en' && !(SH as readonly string[]).includes(c.code)) ?? null
  const groups = { en, sh, other: other?.probability ?? 0, otherCode: other?.code ?? null }
  const base = { groups, candidates: candidates.slice(0, 5), noSpeechProb, windows: windows.length, speechSeconds }

  if (noSpeechProb > NO_SPEECH_LIMIT) return { ...empty, ...base, reason: 'model-no-speech' }

  const winner = sh >= en && sh >= groups.other ? 'sh' : en >= groups.other ? 'en' : 'other'
  const probability = winner === 'sh' ? sh : winner === 'en' ? en : groups.other
  const shVariant = SH.reduce((best, c) => ((avg[c] ?? 0) > (avg[best] ?? 0) ? c : best), 'sr' as (typeof SH)[number])
  const language: SourceLanguage | null = winner === 'sh' ? shVariant : winner === 'en' ? 'en' : null
  const uncertain = (reason: LanguageDetection['reason']): LanguageDetection => ({ ...base, status: 'uncertain', language, probability, variantIsHint: winner === 'sh', reason })

  if (speechSeconds < MIN_SPEECH_SEC) return uncertain('too-short')
  if (winner === 'other') return uncertain('unsupported-language')
  if (probability < MIN_PROBABILITY) return uncertain('low-probability')
  return { ...base, status: 'detected', language, probability, variantIsHint: winner === 'sh', reason: 'ok' }
}

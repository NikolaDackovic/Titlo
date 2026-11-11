/**
 * Pure transcription helpers (no browser APIs) — block planning on silence and turning
 * Whisper output chunks into subtitle-sized segments. Unit-tested.
 */
import type { SourceLanguage } from '../domain/languages'
import { cyrillicToLatin } from '../localization/transliterate'
import { reflowSubtitle } from '../translation/linebreak'
import { splitSentences } from '../translation/providers/opusMt'
import { BLOCK_TARGET_SEC } from './whisperConfig'

export { BLOCK_TARGET_SEC, WHISPER_DECODE_OPTIONS, WHISPER_RUNTIME } from './whisperConfig'

export const SAMPLE_RATE = 16000

export type TranscriptionLanguage = SourceLanguage | 'auto'

/** Whisper language names (accepted by Transformers.js). */
export const WHISPER_LANGUAGE: Record<SourceLanguage, string> = { en: 'english', sr: 'serbian', hr: 'croatian', bs: 'bosnian' }

export interface AudioBlock {
  start: number // sample index (inclusive)
  end: number // sample index (exclusive)
}

/**
 * Split audio into blocks of about `targetSec`, cutting at the quietest 0.3 s window within
 * the last `searchSec` before each target boundary, so words are not cut in half. Blocks are
 * transcribed one by one: this gives real progress and lets the user cancel between blocks.
 */
export function planBlocks(samples: Float32Array, targetSec = BLOCK_TARGET_SEC, searchSec = 8, sampleRate = SAMPLE_RATE): AudioBlock[] {
  const total = samples.length
  const target = Math.round(targetSec * sampleRate)
  if (total <= target * 1.2) return [{ start: 0, end: total }]
  const frame = Math.round(0.02 * sampleRate) // 20 ms
  const windowFrames = 15 // 0.3 s
  const blocks: AudioBlock[] = []
  let start = 0
  while (total - start > target * 1.2) {
    const idealEnd = start + target
    const searchStart = Math.max(start + frame, idealEnd - Math.round(searchSec * sampleRate))
    let bestEnd = idealEnd
    let bestEnergy = Number.POSITIVE_INFINITY
    // Rolling energy over 20 ms frames.
    const energies: number[] = []
    for (let f = searchStart; f + frame <= idealEnd; f += frame) {
      let sum = 0
      for (let i = f; i < f + frame; i += 1) sum += samples[i] * samples[i]
      energies.push(sum)
    }
    for (let k = 0; k + windowFrames <= energies.length; k += 1) {
      let e = 0
      for (let j = k; j < k + windowFrames; j += 1) e += energies[j]
      if (e < bestEnergy) {
        bestEnergy = e
        bestEnd = searchStart + (k + Math.floor(windowFrames / 2)) * frame
      }
    }
    blocks.push({ start, end: bestEnd })
    start = bestEnd
  }
  blocks.push({ start, end: total })
  return blocks
}

export interface WhisperChunk {
  /** Seconds, absolute (block offset already added). `end` may be null for the last chunk. */
  start: number
  end: number | null
  text: string
}

export interface TranscribedSegment {
  start: number
  end: number
  text: string
}


export function normalizeTranscript(text: string, language: TranscriptionLanguage): string {
  let out = text.replace(/\s+/g, ' ').trim()
  // Serbian/Croatian/Bosnian sources are kept in Latin script (Cyrillic profiles are
  // produced later by deterministic transliteration).
  if (language === 'sr' || language === 'hr' || language === 'bs' || /[Ѐ-ӿ]/.test(out)) out = cyrillicToLatin(out)
  return out
}

export interface SegmentationOptions {
  durationMs: number
  language: TranscriptionLanguage
  maxChars?: number
  maxDurationMs?: number
  minDurationMs?: number
  gapMs?: number
}

/** Split one long chunk into ≤ maxChars pieces at sentence, then comma, then word boundaries. */
function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const pieces: string[] = []
  for (const sentence of splitSentences(text)) {
    if (sentence.length <= maxChars) {
      pieces.push(sentence)
      continue
    }
    let current = ''
    for (const part of sentence.split(/(?<=[,;:])\s+|\s+/)) {
      const next = current ? `${current} ${part}` : part
      if (next.length > maxChars && current) {
        pieces.push(current)
        current = part
      } else current = next
    }
    if (current) pieces.push(current)
  }
  // Merge tiny pieces back where they fit.
  const merged: string[] = []
  for (const p of pieces) {
    const last = merged[merged.length - 1]
    if (last && last.length + p.length + 1 <= maxChars) merged[merged.length - 1] = `${last} ${p}`
    else merged.push(p)
  }
  return merged
}

export function chunksToSegments(chunks: WhisperChunk[], options: SegmentationOptions): TranscribedSegment[] {
  const maxChars = options.maxChars ?? 84
  const maxDuration = options.maxDurationMs ?? 7000
  const minDuration = options.minDurationMs ?? 1000
  const gap = options.gapMs ?? 80

  // Nothing Whisper wrote is dropped (only empty chunks): suspected inventions and repeated
  // lines are kept and flagged by QC, so the user decides.
  const cleaned = chunks.map((c) => ({ ...c, text: normalizeTranscript(c.text, options.language) })).filter((c) => c.text)

  const out: TranscribedSegment[] = []
  cleaned.forEach((chunk, i) => {
    const startMs = Math.max(0, Math.round(chunk.start * 1000))
    const nextStart = cleaned[i + 1] ? Math.round(cleaned[i + 1].start * 1000) : options.durationMs
    let endMs = chunk.end !== null ? Math.round(chunk.end * 1000) : Math.min(nextStart, startMs + Math.max(minDuration, chunk.text.length * 70))
    endMs = Math.min(Math.max(endMs, startMs + 200), options.durationMs || endMs)

    const pieces = endMs - startMs > maxDuration || chunk.text.length > maxChars ? splitText(chunk.text, maxChars) : [chunk.text]
    const totalChars = pieces.reduce((s, p) => s + p.length, 0) || 1
    let cursor = startMs
    pieces.forEach((piece, k) => {
      const share = Math.round(((endMs - startMs) * piece.length) / totalChars)
      const pieceEnd = k === pieces.length - 1 ? endMs : cursor + share
      out.push({ start: cursor, end: pieceEnd, text: reflowSubtitle(piece, 42) })
      cursor = pieceEnd
    })
  })

  // Enforce order, minimum duration (where the next cue allows) and a small gap.
  out.sort((a, b) => a.start - b.start)
  for (let i = 0; i < out.length; i += 1) {
    const next = out[i + 1]
    if (next && out[i].end > next.start - gap) out[i].end = Math.max(out[i].start + 200, next.start - gap)
    if (out[i].end - out[i].start < minDuration) {
      const limit = next ? next.start - gap : options.durationMs || out[i].start + minDuration
      out[i].end = Math.max(out[i].end, Math.min(out[i].start + minDuration, limit))
    }
  }
  return out
}

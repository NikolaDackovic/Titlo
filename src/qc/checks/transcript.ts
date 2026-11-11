/**
 * Whisper quality control: heuristic warnings about the ORIGINAL (transcribed) text.
 *
 * These are rules of thumb, not model confidence: no percentage is invented, every issue
 * explains what was measured. Nothing is ever changed or deleted — the user decides.
 * Only segments whose original came from Whisper are checked; segments the user verified or
 * approved are not flagged again.
 */
import { formatDuration, formatDisplayTime } from '../../domain/time'
import { sourceOriginOf, sourceStatusOf, type Segment } from '../../domain/types'
import { stripMarkup } from '../../formats/markup'
import { t as L } from '../../i18n'
import { activeRegions, describeRange, type AudioActivity, type RangeActivity } from '../../media/audioActivity'
import type { QcInput, QcIssue } from '../types'

export const TRANSCRIPT_CHECKS = [
  'possible-silence-hallucination',
  'possible-repeated-output',
  'possible-low-audio-activity',
  'possible-unusual-segment',
  'possible-missing-speech',
] as const
export type TranscriptCheck = (typeof TRANSCRIPT_CHECKS)[number]

/** Lines Whisper is known to invent on silence or music (credits, "subscribe", "thanks for watching"). */
export const KNOWN_HALLUCINATIONS = [
  /^(?:titlov[ia]|prevod|prijevod|subtitles?|sous-titres)\b.*(?:by|:|\.com|\.net|\.org|amara)/i,
  /^(?:www\.)?\S+\.(?:com|net|org|rs|hr|ba)$/i,
  /^(?:pretplatite se|subscribe)\b/i,
  /^(?:thank(?:s| you) for watching|hvala (?:na|što ste) (?:gledanju|gledali|pažnji))\b/i,
]

/** Very short lines Whisper typically produces on non-speech sound ("you", "Thank you.", "Hvala."). */
const FILLERS = new Set(['you', 'thank you', 'thanks', 'bye', 'hvala', 'okay', 'ok', 'hmm', 'mm', 'uh', 'oh', ''])

/** Limits (documented in docs/TRANSCRIPTION_QUALITY_CONTROL.md). */
export const TRANSCRIPT_LIMITS = {
  /** A Whisper segment longer than this is unusual (subtitle segmentation caps at 7 s). */
  maxDurationMs: 10_000,
  /** Characters per second above which the text cannot fit the speech in that time. */
  maxCps: 30,
  /** Less sound than this share of the segment's time → "little audio activity". */
  minActiveFraction: 0.3,
  /** Sound longer than this without any subtitle → "possible missing speech". */
  missingSpeechMs: 2000,
}

export const normalizeForRepeat = (text: string) =>
  stripMarkup(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** A run of the same 1–4 words repeated at least 3 times in a row ("the the the", "go home go home go home"). */
export function internalRepetition(text: string): string | null {
  const words = normalizeForRepeat(text).split(' ').filter(Boolean)
  for (let size = 1; size <= 4; size += 1) {
    for (let i = 0; i + size * 3 <= words.length; i += 1) {
      const gram = words.slice(i, i + size).join(' ')
      let reps = 1
      while (words.slice(i + reps * size, i + (reps + 1) * size).join(' ') === gram) reps += 1
      if (reps >= 3) return gram
    }
  }
  return null
}

const KIND_LABEL: Record<RangeActivity['kind'], string> = {
  silence: 'silence',
  steady: 'steady sound (noise or hum)',
  varying: 'sound without a speech pattern (e.g. music)',
  'speech-like': 'speech-like sound',
}

const describeMeasure = (r: RangeActivity) =>
  L('Measured: {kind}; sound in {pct}% of the time, loudest {peak} dBFS.', { kind: L(KIND_LABEL[r.kind]), pct: Math.round(r.activeFraction * 100), peak: Math.round(r.peakDb) })

export function checkTranscript(input: Pick<QcInput, 'segments' | 'audio'>): QcIssue[] {
  const issues: QcIssue[] = []
  const audio = input.audio ?? null
  const segments = input.segments
  const whisper = segments.some((s) => sourceOriginOf(s) === 'whisper')
  if (!whisper) return issues

  segments.forEach((s, i) => {
    if (sourceOriginOf(s) !== 'whisper') return
    const status = sourceStatusOf(s)
    // The user already listened and decided.
    if (status === 'verified' || status === 'approved') return
    const n = i + 1
    const base = { segmentId: s.id, segmentNumber: n, category: 'transcription' as const }
    const text = stripMarkup(s.source).trim()
    const norm = normalizeForRepeat(text)
    const duration = s.end - s.start
    const range = audio ? describeRange(audio, s.start, s.end) : null

    // --- text where there is no speech -------------------------------------------------
    const credit = KNOWN_HALLUCINATIONS.some((re) => re.test(text))
    if (text && range && (range.kind === 'silence' || range.kind === 'steady')) {
      issues.push({
        ...base,
        id: `tq-sil:${s.id}`,
        check: 'possible-silence-hallucination',
        severity: 'warning',
        title: L('Text where there is no speech'),
        message: L('Segment {n} has text, but the audio here is {kind}. Whisper often invents text on silence and noise.', { n, kind: L(KIND_LABEL[range.kind]) }) + ' ' + describeMeasure(range),
        suggestion: L('Play this part. If nobody speaks, delete the subtitle; otherwise mark it verified.'),
      })
    } else if (text && (credit || (range && range.kind === 'varying' && FILLERS.has(norm)))) {
      issues.push({
        ...base,
        id: `tq-sil:${s.id}`,
        check: 'possible-silence-hallucination',
        severity: 'warning',
        title: L('Possible invented text'),
        message: credit
          ? L('"{text}" looks like a line Whisper invents on silence or music (credits, "subscribe", "thanks for watching").', { text })
          : L('"{text}" is a typical filler Whisper writes on music or noise.', { text }) + (range ? ' ' + describeMeasure(range) : ''),
        suggestion: L('Play this part. If nobody says it, delete the subtitle; otherwise mark it verified.'),
      })
    }

    // --- repeated output ---------------------------------------------------------------
    const prev = segments[i - 1]
    if (norm && prev && sourceOriginOf(prev) === 'whisper' && normalizeForRepeat(prev.source) === norm) {
      issues.push({
        ...base,
        id: `tq-rep:${s.id}`,
        check: 'possible-repeated-output',
        severity: 'warning',
        title: L('Repeated line'),
        message: L('Segment {n} repeats segment {v} word for word. Whisper sometimes loops on the same sentence.', { n, v: n - 1 }),
        suggestion: L('Listen to both. Delete the copy if the sentence is said only once.'),
      })
    } else {
      const gram = internalRepetition(text)
      if (gram) {
        issues.push({
          ...base,
          id: `tq-rep:${s.id}`,
          check: 'possible-repeated-output',
          severity: 'warning',
          title: L('Repeated words'),
          message: L('"{gram}" is repeated three or more times in a row in segment {n}.', { gram, n }),
          suggestion: L('Listen and remove the repetitions that are not spoken.'),
        })
      }
    }

    // --- audio level -------------------------------------------------------------------
    if (text && range && range.kind !== 'silence' && range.kind !== 'steady') {
      if (range.activeFraction < TRANSCRIPT_LIMITS.minActiveFraction && duration >= 1500) {
        issues.push({
          ...base,
          id: `tq-low:${s.id}`,
          check: 'possible-low-audio-activity',
          severity: 'warning',
          title: L('Little sound in this subtitle'),
          message: L('There is sound in only {pct}% of segment {n} ({duration}). The text may be invented or the timing may be off.', { pct: Math.round(range.activeFraction * 100), n, duration: formatDuration(duration) }),
          suggestion: L('Play it and check the text and the start/end times.'),
        })
      } else if (range.quiet) {
        issues.push({
          ...base,
          id: `tq-low:${s.id}`,
          check: 'possible-low-audio-activity',
          severity: 'suggestion',
          title: L('Quiet speech'),
          message: L('The sound in segment {n} is quiet (average {level} dBFS). Quiet or whispered speech is recognised less accurately.', { n, level: Math.round(range.levelDb) }),
          suggestion: L('Listen with headphones and check the words.'),
        })
      }
    }

    // --- unusual shape -----------------------------------------------------------------
    const cps = duration > 0 ? text.replace(/\n/g, '').length / (duration / 1000) : 0
    if (!text && range && range.kind === 'speech-like') {
      issues.push({
        ...base,
        id: `tq-empty:${s.id}`,
        check: 'possible-missing-speech',
        severity: 'warning',
        title: L('Empty subtitle over speech'),
        message: L('Segment {n} has no text, but the audio sounds like speech.', { n }) + ' ' + describeMeasure(range),
        suggestion: L('Listen and type what is said.'),
      })
    } else if (duration > TRANSCRIPT_LIMITS.maxDurationMs) {
      issues.push({
        ...base,
        id: `tq-odd:${s.id}`,
        check: 'possible-unusual-segment',
        severity: 'warning',
        title: L('Unusually long transcribed segment'),
        message: L('Segment {n} lasts {duration}. Long Whisper segments often hide skipped or merged speech.', { n, duration: formatDuration(duration) }),
        suggestion: L('Play it and split it where the speakers pause.'),
      })
    } else if (cps > TRANSCRIPT_LIMITS.maxCps) {
      issues.push({
        ...base,
        id: `tq-odd:${s.id}`,
        check: 'possible-unusual-segment',
        severity: 'warning',
        title: L('Too much text for the time'),
        message: L('Segment {n} has {cps} characters per second of speech — more than anyone speaks. Text may be invented or the timing is wrong.', { n, cps: cps.toFixed(0) }),
        suggestion: L('Listen and check the text and the timing.'),
      })
    }
  })

  if (audio) issues.push(...missingSpeech(audio, segments))
  return issues
}

/** Speech-like sound that no subtitle covers. */
function missingSpeech(audio: AudioActivity, segments: Segment[]): QcIssue[] {
  const out: QcIssue[] = []
  // Intervals sorted by start, plus the longest end so far: each region scans only the
  // subtitles that can overlap it (binary search), so 2,000 subtitles × many regions stays linear-ish.
  const spans = segments.filter((s) => s.source.trim()).map((s) => [s.start, s.end] as const).sort((a, b) => a[0] - b[0])
  // Display index of each subtitle ordered by end time, for "the subtitle before this gap".
  const byEnd = segments.map((s, i) => [s.end, i] as const).sort((a, b) => a[0] - b[0])
  const latestIndex: number[] = []
  byEnd.forEach(([, i], k) => latestIndex.push(Math.max(i, k ? latestIndex[k - 1] : -1)))
  const firstStartingAtOrAfter = (ms: number) => {
    let lo = 0
    let hi = spans.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (spans[mid][0] < ms) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const maxSpan = spans.reduce((m, [a, b]) => Math.max(m, b - a), 0)
  for (const region of activeRegions(audio, TRANSCRIPT_LIMITS.missingSpeechMs)) {
    let covered = 0
    for (let k = firstStartingAtOrAfter(region.startMs - maxSpan); k < spans.length && spans[k][0] < region.endMs; k += 1) {
      covered += Math.max(0, Math.min(spans[k][1], region.endMs) - Math.max(spans[k][0], region.startMs))
    }
    const length = region.endMs - region.startMs
    if (covered / length > 0.2) continue
    const r = describeRange(audio, region.startMs, region.endMs)
    if (r.kind !== 'speech-like') continue
    // Attach to the subtitle just before the gap (if any) so the issue shows up in the list.
    let count = 0 // subtitles that end at or before the gap starts
    for (let hi = byEnd.length; count < hi; ) {
      const mid = (count + hi) >> 1
      if (byEnd[mid][0] <= region.startMs) count = mid + 1
      else hi = mid
    }
    const before = count ? latestIndex[count - 1] : -1
    out.push({
      id: `tq-miss:${region.startMs}`,
      check: 'possible-missing-speech',
      category: 'transcription',
      severity: 'warning',
      segmentId: before >= 0 ? segments[before].id : undefined,
      segmentNumber: before >= 0 ? before + 1 : undefined,
      range: { startMs: region.startMs, endMs: region.endMs },
      title: L('Speech without subtitles?'),
      message: L('From {from} to {to} ({duration}) the audio sounds like speech, but no subtitle covers it.', { from: formatDisplayTime(region.startMs), to: formatDisplayTime(region.endMs), duration: formatDuration(length) }) + ' ' + describeMeasure(r),
      suggestion: L('Play this part. If someone speaks, add a subtitle (it may also be singing or music).'),
    })
  }
  return out
}

/** Segment ids that got a transcription warning (used to set "needs-review" after transcribing). */
export const flaggedSegmentIds = (issues: QcIssue[]) =>
  new Set(issues.filter((i) => i.category === 'transcription' && i.severity !== 'suggestion' && i.segmentId && !i.range).map((i) => i.segmentId!))

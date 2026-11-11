/**
 * The review workflow end to end, at the state level (the same pure functions the Studio uses):
 * transcribe → QC flags a segment → the user corrects it → verifies → translates → changes the
 * original → the translation is out of date, the manual translation is kept.
 * Audio is SYNTHETIC (src/test/syntheticAudio.ts).
 */
import { describe, expect, it } from 'vitest'
import { isSourceProtected, isTranslationStale, needsSourceReview, newId, type Segment } from '../domain/types'
import { analyzeActivity } from '../media/audioActivity'
import { checkTranscript, flaggedSegmentIds } from '../qc/checks/transcript'
import { concat, silence, speechLike, SR } from '../test/syntheticAudio'
import { TranslationJob, isEligible, type SegmentUpdate } from '../translation/engine'
import type { TranslationProvider, TranslationRequest } from '../translation/types'
import { applyTranslationUpdates, editTranslation, flagForReview, mergeTranscription, setSourceStatus, updateSegment } from './segmentOps'

class DictionaryProvider implements TranslationProvider {
  readonly id = 'dict'
  readonly label = 'Dictionary (test)'
  readonly kind = 'local-nmt' as const
  readonly isTest = false
  readonly usesContext = false
  readonly maxBatchItems = 10
  readonly maxBatchChars = 10_000
  cacheKey = () => 'dict'
  supports = () => true
  checkAvailability = async () => ({ available: true, message: '' })
  async translateBatch(req: TranslationRequest) {
    const words: Record<string, string> = { 'we are going home.': 'Idemo kući.', 'see you tomorrow.': 'Vidimo se sutra.', 'see you on monday.': 'Vidimo se u ponedeljak.' }
    return req.items.map((i) => ({ id: i.id, text: words[i.text.toLowerCase()] ?? `[${i.text}]` }))
  }
}

async function translate(segments: Segment[], options: { segmentIds?: string[]; overwriteManual?: boolean; retranslateMachine?: boolean } = {}) {
  const updates: SegmentUpdate[] = []
  const startedAt = new Date().toISOString()
  await new TranslationJob({
    provider: new DictionaryProvider(),
    segments,
    profile: 'sr-Latn',
    sourceLanguage: 'en',
    neutralYat: 'ijekavian',
    contentType: 'movie',
    glossary: [],
    retryBaseDelayMs: 1,
    onUpdate: (u) => updates.push(...u),
    onProgress: () => {},
    ...options,
  }).run()
  return applyTranslationUpdates(segments, 'sr-Latn', updates, startedAt).segments
}

describe('review workflow', () => {
  it('runs from transcription to an out-of-date translation without losing manual work', async () => {
    // 1. "Transcription": 0–3 s speech, 3–8 s silence (Whisper invented "you" there), 8–11 s speech.
    const audio = analyzeActivity(concat(speechLike(3), silence(5), speechLike(3)), SR)
    const whisperOut = [
      { start: 0, end: 2900, text: 'We are going home.' },
      { start: 4000, end: 6000, text: 'you' },
      { start: 8100, end: 10900, text: 'See you tomorow.' },
    ]
    let segments: Segment[] = whisperOut.map((w) => ({ id: newId(), start: w.start, end: w.end, source: w.text, translations: {}, sourceOrigin: 'whisper', sourceStatus: 'unreviewed' }))

    // 2. QC detects the problematic segment and it is marked "needs-review"; nothing is deleted.
    const issues = checkTranscript({ segments, audio })
    const flagged = flaggedSegmentIds(issues)
    expect([...flagged]).toEqual([segments[1].id])
    segments = flagForReview(segments, flagged)
    expect(segments.map((s) => s.sourceStatus)).toEqual(['unreviewed', 'needs-review', 'unreviewed'])
    expect(segments.map((s) => s.source)).toEqual(whisperOut.map((w) => w.text))
    // 3–4. The warning points to the segment and its time (the UI seeks the player there).
    const warning = issues.find((i) => i.segmentId === segments[1].id)!
    expect(warning.check).toBe('possible-silence-hallucination')
    expect(segments.find((s) => s.id === warning.segmentId)!.start).toBe(4000)

    // 5–6. The user corrects a misheard word in segment 3 → "manually-edited".
    segments = updateSegment(segments, segments[2].id, { source: 'See you tomorrow.' })
    expect(segments[2].sourceStatus).toBe('manually-edited')
    // Timing changes alone do not change the review state.
    segments = updateSegment(segments, segments[0].id, { start: 100, end: 2900 })
    expect(segments[0].sourceStatus).toBe('unreviewed')

    // 7. The user verifies segments 1 and 2 (segment 2: someone does say "you" there).
    segments = setSourceStatus(segments, [segments[0].id, segments[1].id], 'verified')
    expect(segments.filter(needsSourceReview)).toHaveLength(0)
    // A verified original is no longer flagged.
    expect(flaggedSegmentIds(checkTranscript({ segments, audio })).size).toBe(0)

    // 8–9. Translation.
    segments = await translate(segments)
    expect(segments.map((s) => s.translations['sr-Latn']?.text)).toEqual(['Idemo kući.', '[you]', 'Vidimo se sutra.'])
    expect(segments.every((s) => s.translations['sr-Latn']?.sourceText === s.source)).toBe(true)

    // The user edits one translation by hand.
    segments = editTranslation(segments, segments[0].id, 'sr-Latn', 'Idemo kući, odmah.')

    // 10–11. The user changes the original after translating → both translations are out of date.
    segments = updateSegment(segments, segments[2].id, { source: 'See you on Monday.' })
    segments = updateSegment(segments, segments[0].id, { source: 'We are going home now.' })
    expect(isTranslationStale(segments[2], segments[2].translations['sr-Latn'])).toBe(true)
    expect(isTranslationStale(segments[0], segments[0].translations['sr-Latn'])).toBe(true)
    expect(isTranslationStale(segments[1], segments[1].translations['sr-Latn'])).toBe(false)
    // The old translations are kept, not cleared.
    expect(segments[2].translations['sr-Latn']?.text).toBe('Vidimo se sutra.')

    // 12. Re-translating the out-of-date segments: the machine one is updated, the manual one is
    // kept unless the user explicitly allows overwriting it.
    const stale = segments.filter((s) => isTranslationStale(s, s.translations['sr-Latn'])).map((s) => s.id)
    expect(isEligible(segments[0], 'sr-Latn', { retranslateMachine: true })).toBe(false)
    segments = await translate(segments, { segmentIds: stale, retranslateMachine: true })
    expect(segments[2].translations['sr-Latn']?.text).toBe('Vidimo se u ponedeljak.')
    expect(isTranslationStale(segments[2], segments[2].translations['sr-Latn'])).toBe(false)
    expect(segments[0].translations['sr-Latn']).toMatchObject({ text: 'Idemo kući, odmah.', origin: 'manual' })
    expect(isTranslationStale(segments[0], segments[0].translations['sr-Latn'])).toBe(true)
  })

  it('a new transcription keeps verified, edited and approved originals unless the user replaces everything', () => {
    const mk = (start: number, end: number, source: string, sourceStatus: Segment['sourceStatus']): Segment => ({ id: newId(), start, end, source, translations: {}, sourceOrigin: 'whisper', sourceStatus })
    const current = [mk(0, 2000, 'Edited by me', 'manually-edited'), mk(2000, 4000, 'raw', 'unreviewed'), mk(4000, 6000, 'Approved line', 'approved'), mk(6000, 8000, 'Checked', 'verified')]
    const incoming = [mk(0, 1900, 'new 1', 'unreviewed'), mk(2100, 3900, 'new 2', 'unreviewed'), mk(4100, 5900, 'new 3', 'unreviewed'), mk(8200, 9000, 'new 4', 'unreviewed')]
    const kept = mergeTranscription(current, incoming, true)
    expect(kept.segments.map((s) => s.source)).toEqual(['Edited by me', 'new 2', 'Approved line', 'Checked', 'new 4'])
    expect(kept.segments.filter(isSourceProtected).map((s) => s.id)).toEqual([current[0].id, current[2].id, current[3].id])
    expect(kept).toMatchObject({ kept: 3, added: 2, dropped: 2 })
    // Explicit "replace everything".
    expect(mergeTranscription(current, incoming, false).segments).toBe(incoming)
  })
})

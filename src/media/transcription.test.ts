import { describe, expect, it } from 'vitest'
import { chunksToSegments, normalizeTranscript, planBlocks, SAMPLE_RATE } from './transcription'

/** Synthetic audio: loud noise everywhere except silent gaps at the given seconds. */
function audio(seconds: number, silences: Array<[number, number]>): Float32Array {
  const a = new Float32Array(seconds * SAMPLE_RATE)
  for (let i = 0; i < a.length; i += 1) a[i] = Math.sin(i * 0.3) * 0.8
  for (const [s, e] of silences) a.fill(0, s * SAMPLE_RATE, e * SAMPLE_RATE)
  return a
}

describe('planBlocks', () => {
  it('keeps short audio in one block', () => {
    expect(planBlocks(audio(60, []))).toEqual([{ start: 0, end: 60 * SAMPLE_RATE }])
  })
  it('cuts long audio in silence near the target boundary and covers everything', () => {
    const a = audio(300, [[85, 86], [172, 173]])
    const blocks = planBlocks(a)
    // 300 s with 90 s targets → 4 blocks; the first two cuts must fall inside the silences.
    expect(blocks.length).toBe(4)
    expect(blocks[0].start).toBe(0)
    expect(blocks[blocks.length - 1].end).toBe(a.length)
    blocks.slice(1).forEach((b, i) => expect(b.start).toBe(blocks[i].end))
    const [cut1, cut2] = [blocks[0].end / SAMPLE_RATE, blocks[1].end / SAMPLE_RATE]
    expect(cut1).toBeGreaterThanOrEqual(85)
    expect(cut1).toBeLessThanOrEqual(86)
    expect(cut2).toBeGreaterThanOrEqual(172)
    expect(cut2).toBeLessThanOrEqual(173)
  })
})

describe('chunksToSegments', () => {
  it('produces ordered, non-overlapping subtitle segments with minimum duration', () => {
    const segs = chunksToSegments(
      [
        { start: 0.5, end: 1.0, text: ' Zdravo. ' },
        { start: 1.1, end: 4, text: 'Kako si danas?' },
        { start: 3.9, end: null, text: 'Dobro sam.' },
      ],
      { durationMs: 8000, language: 'sr' },
    )
    expect(segs.map((s) => s.text)).toEqual(['Zdravo.', 'Kako si danas?', 'Dobro sam.'])
    for (let i = 1; i < segs.length; i += 1) expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].end)
    expect(segs[0].end - segs[0].start).toBeGreaterThanOrEqual(500)
    expect(segs[2].end).toBeLessThanOrEqual(8000)
  })
  it('splits long chunks into subtitle-sized pieces with proportional timing', () => {
    const text = 'Ovo je jedna dugačka rečenica koja opisuje šta se dešava. A ovo je druga rečenica, takođe dovoljno dugačka da ne stane.'
    const segs = chunksToSegments([{ start: 0, end: 12, text }], { durationMs: 20000, language: 'sr' })
    expect(segs.length).toBeGreaterThan(1)
    expect(segs.every((s) => s.text.replace(/\n/g, ' ').length <= 84)).toBe(true)
    expect(segs[0].start).toBe(0)
    expect(segs[segs.length - 1].end).toBe(12000)
  })
  it('keeps suspected hallucinations and repeated lines (QC flags them; nothing is deleted)', () => {
    const segs = chunksToSegments(
      [
        { start: 0, end: 2, text: 'Idemo kući.' },
        { start: 2, end: 4, text: 'Idemo kući.' },
        { start: 5, end: 7, text: 'Titlovi: www.example.com' },
      ],
      { durationMs: 8000, language: 'sr' },
    )
    expect(segs.map((s) => s.text)).toEqual(['Idemo kući.', 'Idemo kući.', 'Titlovi: www.example.com'])
  })
  it('keeps Serbian/Croatian/Bosnian transcripts in Latin script', () => {
    expect(normalizeTranscript('  Где  си, Љубо? ', 'sr')).toBe('Gde si, Ljubo?')
    expect(normalizeTranscript('Hello there', 'en')).toBe('Hello there')
  })
})

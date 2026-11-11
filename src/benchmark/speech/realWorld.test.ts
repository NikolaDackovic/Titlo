import { describe, expect, it } from 'vitest'
import {
  bumpVersion,
  findWhisperLikeReference,
  hypothesisWordSegments,
  missedCandidates,
  parseReview,
  renderReport,
  reviewTemplateRows,
  summarizeGroup,
  summarizeReview,
  toCsv,
  validateRealSample,
  type BenchResult,
  type RealSampleInput,
} from '../../../benchmark/speech/scripts/lib/realWorld'
import { renderDiff, scoreSample, wordAlignment } from './metrics'

// No real recordings are used here: texts below are hand-written test fixtures.

const input = (patch: Partial<RealSampleInput> = {}): RealSampleInput => ({
  id: 'sr-podcast-01',
  language: 'sr',
  audio: 'D:/snimci/podcast.mp3',
  reference: 'Dobro veče, danas pričamo o lokalnim izborima u gradu.',
  qualityNote: 'podcast mikrofon, tiha soba',
  contentType: 'podcast',
  notes: '',
  source: 'sopstveni snimak',
  license: 'own recording',
  confirmReference: true,
  ...patch,
})

describe('adding a real sample', () => {
  it('accepts a complete Serbian/Croatian/Bosnian sample in a supported format', () => {
    expect(validateRealSample(input(), [], false)).toEqual([])
    expect(validateRealSample(input({ language: 'hr', audio: 'a.wav' }), [], false)).toEqual([])
    expect(validateRealSample(input({ language: 'bs', audio: 'a.M4A' }), [], false)).toEqual([])
  })
  it('rejects other languages, unknown formats, empty or tiny references and missing metadata', () => {
    const errors = (p: Partial<RealSampleInput>) => validateRealSample(input(p), [], false).join(' ')
    expect(errors({ language: 'en' })).toMatch(/sr, hr or bs/)
    expect(errors({ audio: 'clip.txt' })).toMatch(/Unsupported audio format/)
    expect(errors({ reference: '   ' })).toMatch(/empty/)
    expect(errors({ reference: 'samo tri reči' })).toMatch(/fewer than 5 words/)
    expect(errors({ qualityNote: '' })).toMatch(/--quality/)
    expect(errors({ license: '' })).toMatch(/--license/)
  })
  it('does not silently replace an existing sample', () => {
    expect(validateRealSample(input(), ['sr-podcast-01'], false).join()).toMatch(/already exists/)
    expect(validateRealSample(input(), ['sr-podcast-01'], true)).toEqual([])
  })
  it('refuses a reference that is (nearly) Whisper output for the same audio', () => {
    const whisper = { runId: 'r1', model: 'onnx-community/whisper-small', hypothesis: 'Dobro veče danas pričamo o lokalnim izborima u gradu' }
    expect(findWhisperLikeReference('Dobro veče, danas pričamo o lokalnim izborima u gradu.', [whisper])?.wer).toBe(0)
    // A real, different human transcript is accepted.
    expect(findWhisperLikeReference('Dobro veče, danas pričamo o lokalnim izborima u našem gradu.', [whisper])).toBeNull()
    expect(findWhisperLikeReference('Bilo šta.', [])).toBeNull()
  })
  it('bumps the dataset version on every change', () => {
    expect(bumpVersion('0.0.0')).toBe('0.1.0')
    expect(bumpVersion('1.4.0')).toBe('1.5.0')
  })
})

describe('diff and metrics for South Slavic text', () => {
  it('shows substitutions, omissions and insertions word by word', () => {
    const diff = renderDiff(wordAlignment('Vidimo se sutra u devet', 'vidimo se sutra uveče u deset'))
    expect(diff).toBe('vidimo se sutra [+uveče+] u [devet→deset]')
    expect(renderDiff(wordAlignment('Dobar dan svima', 'Dobar dan'))).toBe('dobar dan [-svima-]')
  })
  it('does not hide ekavian/ijekavian, sr/hr word choice or numbers', () => {
    expect(scoreSample('Gde je mleko?', 'Gdje je mlijeko?').normalized.wer.substitutions).toBe(2)
    expect(scoreSample('Uđi u voz.', 'Uđi u vlak.').normalized.wer.substitutions).toBe(1)
    expect(scoreSample('Košta 15 evra.', 'Košta 50 evra.').normalized.wer.substitutions).toBe(1)
  })
  it('counts a Cyrillic/Latin difference in the strict view and flags it explicitly', () => {
    const s = scoreSample('Добро вече', 'Dobro veče')
    expect(s.normalized.wer.rate).toBe(0)
    expect(s.strict.wer.rate).toBe(1)
    expect(s.scriptDiffers).toBe(true)
  })
})

describe('QC evaluation', () => {
  const segments = [
    { start: 0, end: 3000, text: 'Dobro veče, danas pričamo o izborima.' },
    { start: 3000, end: 7000, text: 'Kad salo ne radi, idemo kući.' },
  ]
  const reference = 'Dobro veče, danas pričamo o izborima. Kada sajt ne radi, odlazimo kući.'

  it('maps every recognised word to the segment it came from', () => {
    expect(hypothesisWordSegments(segments)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1])
  })
  it('lists segments with many errors and no QC warning as "missed" candidates', () => {
    const candidates = missedCandidates(segments, reference, [])!
    expect(candidates.map((c) => c.segmentIndex)).toEqual([1])
    expect(candidates[0].errors).toBe(3)
    expect(candidates[0].diff).toContain('[kada→kad]')
    // The same segment with a QC warning is not a "missed" candidate.
    const warned = [{ id: 'q', check: 'possible-low-audio-activity', severity: 'warning', segmentIndex: 1, startMs: 3000, endMs: 7000, title: '', message: '' }]
    expect(missedCandidates(segments, reference, warned)).toEqual([])
  })

  const result: BenchResult = {
    model: 'onnx-community/whisper-base',
    id: 'sr-podcast-01',
    language: 'sr',
    realWorld: true,
    audioMs: 7000,
    transcribeMs: 9100,
    rtf: 1.3,
    hypothesis: segments.map((s) => s.text).join(' '),
    reference,
    score: scoreSample(reference, segments.map((s) => s.text).join(' ')),
    error: null,
    detection: { status: 'detected', language: 'hr', probability: 0.71, groups: { en: 0.02, sh: 0.93, other: 0.05 } },
    segmentList: segments,
    qcIssues: [{ id: 'tq-low:seg-0', check: 'possible-low-audio-activity', severity: 'warning', segmentIndex: 0, startMs: 0, endMs: 3000, title: 'x', message: 'Malo zvuka' }],
    qcMissedCandidates: missedCandidates(segments, reference, []),
  }

  it('writes a review template with every warning and every candidate, and reads ratings back', () => {
    const rows = reviewTemplateRows('run-1', [result])
    expect(rows.slice(1).map((r) => r[3])).toEqual(['warning', 'missed-candidate'])
    // The person rates in Excel (semicolon CSV, Serbian words allowed) and adds a missed problem.
    const filled = toCsv(rows)
      .replace(/^(.*,warning,.*),,\r$/m, '$1,tačno,')
      .replace(/^(.*,missed-candidate,.*),,\r$/m, '$1,propušteno,ime pogrešno')
      .concat('run-1,onnx-community/whisper-base,sr-podcast-01,missed,,,1,,,,,missed,ime u prvoj rečenici\r\n')
    const { rows: parsed, errors } = parseReview(filled.replace(/,/g, ';'))
    expect(errors).toEqual([])
    const s = summarizeReview(parsed)
    expect(s).toMatchObject({ warnings: 1, correct: 1, falseAlarms: 0, unrated: 0, precision: 1, missedProblems: 2 })
  })
  it('rejects unknown ratings and "missed" on a warning', () => {
    const csv = 'model,sample_id,kind,check,rating\nm,a,warning,x,maybe\nm,a,warning,x,missed\n'
    expect(parseReview(csv).errors).toHaveLength(2)
  })

  it('summaries and the report always state how many samples and how much audio', () => {
    const g = summarizeGroup([result])
    expect(g).toMatchObject({ samples: 1, scored: 1, audioSeconds: 7 })
    const md = renderReport({ runId: 'run-1', date: '2026-11-12', command: 'x', datasets: [{ name: 'real-world', version: '0.1.0', sha256: 'abc', samples: 1 }], models: [{ modelId: 'onnx-community/whisper-base', revision: '27a07b4b' }], config: {}, hardware: { cpu: 'Ryzen', totalPhysicalMb: 3460 } }, [result])
    expect(md).toContain('1 stvarnih ljudskih snimaka')
    expect(md).toMatch(/\| srpski \| whisper-base \| 1 \(1\) \| 0:07 \|/)
    expect(md).toContain('hr 71 % (sr/hr/bs 93 %)')
    expect(md).toContain('[kada→kad]')
  })
  it('says so plainly when there are no real recordings', () => {
    const md = renderReport({ runId: 'r', date: '', command: '', datasets: [], models: [], config: {}, hardware: {} }, [{ ...result, realWorld: false, score: null }])
    expect(md).toContain('nijedan stvaran ljudski snimak')
    expect(md).toContain('WER/CER nije izračunat')
  })
})

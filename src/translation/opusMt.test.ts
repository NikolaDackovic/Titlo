/**
 * OPUS-MT provider behaviour with a MOCK runtime (no model).
 * The real model is covered separately by `npm run test:model`.
 */
import { describe, expect, it } from 'vitest'
import type { Project, Segment } from '../domain/types'
import { buildExport } from '../formats/exporter'
import { parseAss } from '../formats/ass'
import { parseSrt } from '../formats/srt'
import { parseVtt } from '../formats/vtt'
import { applyTranslationUpdates } from '../state/segmentOps'
import { TranslationJob, type JobProgress, type SegmentUpdate } from './engine'
import { OpusMtProvider, countMojibake, repairMojibake, splitForModel, splitSentences, type MarianRuntime } from './providers/opusMt'
import type { TranslationRequest } from './types'

/** MOCK runtime: deterministic fake "translation" — clearly not a model. */
function mockRuntime(behaviour: { fail?: (input: string) => boolean; loadError?: string } = {}) {
  const calls: string[][] = []
  const runtime: MarianRuntime = {
    async translate(_model, texts, _options, signal) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (behaviour.loadError) throw new Error(behaviour.loadError)
      calls.push(texts)
      return texts.map((t) => {
        if (behaviour.fail?.(t)) throw new Error('inference failed')
        return `MOCK(${t.replace(/^>>\w+<<\s*/, '')})`
      })
    },
    dispose() {},
  }
  return { runtime, calls }
}

const allFiles = { exists: async () => true }
const opts = { device: 'cpu' as const, dtype: 'q8' as const, numBeams: 4 }
const target = { profile: 'hr' as const, language: 'sh' as const, variant: 'hr' as const, yat: 'ijekavian' as const, label: 'Croatian' }
const req = (texts: string[], patch: Partial<TranslationRequest> = {}): TranslationRequest => ({
  items: texts.map((text, i) => ({ id: `s${i}`, text, before: [], after: [] })),
  sourceLanguage: 'en',
  target,
  glossary: [],
  contentType: 'movie',
  signal: new AbortController().signal,
  ...patch,
})

describe('OPUS-MT text preparation', () => {
  it('splits sentences but not abbreviations or ellipses inside a sentence', () => {
    expect(splitSentences('Get down! Now!')).toEqual(['Get down!', 'Now!'])
    expect(splitSentences('Mr. Smith is here. Run!')).toEqual(['Mr. Smith is here.', 'Run!'])
    expect(splitSentences('Wait... what?')).toEqual(['Wait... what?'])
  })
  it('handles dialogue subtitles line by line and removes spurious dashes', () => {
    const s = splitForModel('- Is he dead?\n- Not yet.')
    expect(s.parts).toEqual(['Is he dead?', 'Not yet.'])
    expect(s.join(['Je li mrtav?', '-Još ne.'])).toBe('- Je li mrtav?\n- Još ne.')
    const n = splitForModel('Get in the car.\nNow.')
    expect(n.join(['-Ulazi u auto.', 'Odmah.'])).toBe('Ulazi u auto. Odmah.')
  })
  it('splits very long input into sentences (no single huge model input)', () => {
    const long = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i}.`).join(' ')
    const s = splitForModel(long)
    expect(s.parts).toHaveLength(30)
    expect(Math.max(...s.parts.map((p) => p.length))).toBeLessThan(40)
  })
  it('repairs the model\'s Windows-1250 mojibake only', () => {
    expect(repairMojibake('Zvaæu te, èekaj, ðavo! Æao Èeda Ðorðe')).toBe('Zvaću te, čekaj, đavo! Ćao Čeda Đorđe')
    expect(repairMojibake('Čekaj, Ćao, Đorđe, šđčćž')).toBe('Čekaj, Ćao, Đorđe, šđčćž')
    expect(countMojibake('kuæa')).toBe(1)
  })
})

describe('OPUS-MT provider (mock runtime)', () => {
  it('reports a missing model and lists the missing files', async () => {
    const p = new OpusMtProvider(mockRuntime().runtime, { exists: async () => false }, opts)
    const a = await p.checkAvailability()
    expect(a.available).toBe(false)
    expect(a.details?.filter((d) => d.startsWith('Missing')).length).toBe(6)
  })
  it('reports incomplete model files', async () => {
    const p = new OpusMtProvider(mockRuntime().runtime, { exists: async (f) => !f.endsWith('decoder_model_merged_quantized.onnx') }, opts)
    const a = await p.checkAvailability()
    expect(a.details?.filter((d) => d.startsWith('Missing'))).toEqual(['Missing: models/Helsinki-NLP/opus-mt-tc-base-en-sh/onnx/decoder_model_merged_quantized.onnx'])
  })
  it('turns a model load error into a retryable provider error', async () => {
    const p = new OpusMtProvider(mockRuntime({ loadError: 'Protobuf parsing failed' }).runtime, allFiles, opts)
    await expect(p.translateBatch(req(['Hello.']))).rejects.toThrow(/Local model error: Protobuf parsing failed/)
  })
  it('sends every sentence separately with the target token, one input per call (no padding effects)', async () => {
    const m = mockRuntime()
    const p = new OpusMtProvider(m.runtime, allFiles, opts)
    const out = await p.translateBatch(req(['Get down! Now!', '- Is he dead?\n- Not yet.']))
    expect(m.calls).toEqual([['>>hrv<< Get down!'], ['>>hrv<< Now!'], ['>>hrv<< Is he dead?'], ['>>hrv<< Not yet.']])
    expect(out.map((o) => o.text)).toEqual(['MOCK(Get down!) MOCK(Now!)', '- MOCK(Is he dead?)\n- MOCK(Not yet.)'])
  })
  it('returns an empty string for empty input without calling the model', async () => {
    const m = mockRuntime()
    const out = await new OpusMtProvider(m.runtime, allFiles, opts).translateBatch(req(['', '   ']))
    expect(out.map((o) => o.text)).toEqual(['', ''])
    expect(m.calls).toHaveLength(0)
  })
  it('keeps Unicode and diacritics intact', async () => {
    const out = await new OpusMtProvider(mockRuntime().runtime, allFiles, opts).translateBatch(req(['Đorđe says “ćao” — 100 €.']))
    expect(out[0].text).toBe('MOCK(Đorđe says “ćao” — 100 €.)')
  })
  it('rejects unsupported pairs (sr source into a sr/hr/bs profile)', async () => {
    await expect(new OpusMtProvider(mockRuntime().runtime, allFiles, opts).translateBatch(req(['Zdravo'], { sourceLanguage: 'sr' }))).rejects.toThrow('English → Serbian/Croatian/Bosnian and')
  })
})

// ---------------------------------------------------------------- job + export with the provider
const segs = (): Segment[] => [
  { id: 'a', start: 1000, end: 3000, source: 'You know what?', translations: {} },
  { id: 'b', start: 3500, end: 5000, source: '<i>I never trusted him.</i>', translations: {} },
  { id: 'c', start: 5500, end: 7000, source: 'Locked line.', translations: { 'sr-Cyrl': { text: 'Закључано.', status: 'translated', origin: 'manual', locked: true, updatedAt: '' } } },
  { id: 'd', start: 7500, end: 9000, source: 'Manual line.', translations: { 'sr-Cyrl': { text: 'Моје.', status: 'translated', origin: 'manual', locked: false, updatedAt: '' } } },
  { id: 'e', start: 9500, end: 11000, source: 'Fails here.', translations: {} },
]

async function runJob(runtime: MarianRuntime, segments: Segment[], extra: Partial<ConstructorParameters<typeof TranslationJob>[0]> = {}) {
  const updates: SegmentUpdate[] = []
  const progress: JobProgress[] = []
  const job = new TranslationJob({
    provider: new OpusMtProvider(runtime, allFiles, opts),
    segments, profile: 'sr-Cyrl', sourceLanguage: 'en', neutralYat: 'ijekavian', contentType: 'movie', glossary: [], retryBaseDelayMs: 1, maxRetries: 1,
    onUpdate: (u) => updates.push(...u), onProgress: (p) => progress.push(p), ...extra,
  })
  return { job, run: job.run().then((final) => ({ final, updates, progress })) }
}

describe('translation job with OPUS-MT provider (mock runtime)', () => {
  it('translates, keeps locked/manual segments and timings, isolates the failing segment, exports SRT/VTT/ASS in Cyrillic', async () => {
    // Mock "translation" that returns Latin text so the engine's Cyrillic step is visible.
    const runtime: MarianRuntime = {
      async translate(_m, texts) {
        return texts.map((t) => {
          if (t.includes('Fails here')) throw new Error('inference failed')
          return t.includes('know') ? 'Znaš šta?' : 'Nikad mu nisam verovao, Ljubo.'
        })
      },
      dispose() {},
    }
    const original = segs()
    const { run } = await runJob(runtime, original)
    const { final, updates } = await run
    expect(final).toMatchObject({ state: 'completed', done: 2, failed: 1, skipped: 2 })
    const applied = applyTranslationUpdates(original, 'sr-Cyrl', updates, '2000-01-01T00:00:00Z').segments
    expect(applied.map((s) => [s.start, s.end])).toEqual(original.map((s) => [s.start, s.end]))
    expect(applied[0].translations['sr-Cyrl']?.text).toBe('Знаш шта?')
    expect(applied[1].translations['sr-Cyrl']?.text).toBe('<i>Никад му нисам веровао, Љубо.</i>')
    expect(applied[2].translations['sr-Cyrl']?.text).toBe('Закључано.')
    expect(applied[3].translations['sr-Cyrl']?.text).toBe('Моје.')
    expect(applied[4].translations['sr-Cyrl']?.status).toBe('failed')

    const project: Project = { id: 'p', name: 'Test', contentType: 'movie', sourceLanguage: 'en', activeProfile: 'sr-Cyrl', neutralYat: 'ijekavian', sourceFormat: 'srt', sourceFileName: null, formatHeader: null, createdAt: '', updatedAt: '', lastOpenedAt: null }
    const srt = buildExport(project, applied, { format: 'srt', content: 'translation', profile: 'sr-Cyrl', lineEnding: 'lf', bom: false })
    const vtt = buildExport(project, applied, { format: 'vtt', content: 'translation', profile: 'sr-Cyrl', lineEnding: 'lf', bom: false })
    const ass = buildExport(project, applied, { format: 'ass', content: 'translation', profile: 'sr-Cyrl', lineEnding: 'lf', bom: false })
    expect(parseSrt(srt.text).cues.map((c) => [c.start, c.end, c.text]).slice(0, 2)).toEqual([[1000, 3000, 'Знаш шта?'], [3500, 5000, '<i>Никад му нисам веровао, Љубо.</i>']])
    expect(parseVtt(vtt.text).cues[0].text).toBe('Знаш шта?')
    expect(parseAss(ass.text).cues[1].text).toBe('{\\i1}Никад му нисам веровао, Љубо.{\\i0}')
    expect(new TextDecoder().decode(srt.bytes)).toContain('Љубо')
  })

  it('retrying failed segments translates them when the model recovers', async () => {
    let broken = true
    const runtime: MarianRuntime = { async translate(_m, texts) { if (broken) throw new Error('temporary'); return texts.map(() => 'Ok.') }, dispose() {} }
    const first = await (await runJob(runtime, [segs()[0]])).run
    expect(first.final.failed).toBe(1)
    broken = false
    const second = await (await runJob(runtime, [segs()[0]], { segmentIds: ['a'] })).run
    expect(second.final).toMatchObject({ done: 1, failed: 0 })
  })

  it('pause → resume and cancel keep finished work', async () => {
    const runtime: MarianRuntime = { async translate(_m, texts) { await new Promise((r) => setTimeout(r, 5)); return texts.map(() => 'X.') }, dispose() {} }
    const many: Segment[] = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, start: i * 1000, end: i * 1000 + 800, source: `Line ${i}.`, translations: {} }))
    const states: string[] = []
    const { job, run } = await runJob(runtime, many, { profile: 'hr', onProgress: (p) => states.push(p.state) })
    setTimeout(() => job.pause(), 15)
    setTimeout(() => job.resume(), 60)
    setTimeout(() => job.cancel(), 120)
    const { final, updates } = await run
    expect(states).toContain('paused')
    expect(final.state).toBe('cancelled')
    expect(updates.length).toBeGreaterThan(0)
    expect(updates.length).toBeLessThan(30)
    expect(updates.every((u) => u.status === 'translated')).toBe(true)
  })

  it('reports a clear failure when the model is not installed (job does not start translating)', async () => {
    const p = new OpusMtProvider(mockRuntime().runtime, { exists: async () => false }, opts)
    expect((await p.checkAvailability()).message).toMatch(/not found/)
  })
})

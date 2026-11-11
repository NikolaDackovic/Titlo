/**
 * REAL MODEL TEST — runs Helsinki-NLP/opus-mt-tc-base-en-sh locally (no mocks).
 *   npm run test:model
 * Skipped (with an explicit message) when the model is not installed: `npm run model:install`.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveModelsDir } from '../../build/modelsDir'
import { createNodeOpusProvider } from '../../scripts/lib/nodeMarian'
import type { Segment } from '../../src/domain/types'
import { buildExport } from '../../src/formats/exporter'
import { parseSrt } from '../../src/formats/srt'
import { applyTranslationUpdates } from '../../src/state/segmentOps'
import { buildTarget, TranslationJob, type SegmentUpdate } from '../../src/translation/engine'
import { countMojibake, OPUS_MODEL_ID } from '../../src/translation/providers/opusMt'

const modelDir = path.join(resolveModelsDir(), ...OPUS_MODEL_ID.split('/'))
const installed = existsSync(path.join(modelDir, 'tokenizer.json')) && existsSync(path.join(modelDir, 'onnx', 'decoder_model_merged_quantized.onnx'))
if (!installed) console.warn(`[test:model] SKIPPED — model not installed in ${modelDir}. Run: npm run model:install`)

describe.skipIf(!installed)('OPUS-MT real local inference', () => {
  const { provider, runtime } = createNodeOpusProvider()
  const signal = new AbortController().signal
  const translate = async (texts: string[], profile: Parameters<typeof buildTarget>[0] = 'hr') =>
    (await provider.translateBatch({ items: texts.map((text, i) => ({ id: String(i), text, before: [], after: [] })), sourceLanguage: 'en', target: buildTarget(profile, 'ijekavian'), glossary: [], contentType: 'movie', signal })).map((r) => r.text)

  beforeAll(async () => {
    expect((await provider.checkAvailability()).available).toBe(true)
  })

  it('loads the model and generates real, input-dependent output', async () => {
    const [a, b] = await translate(['The train leaves at seven.', 'Where did you put my keys?'])
    expect(runtime.stats.loads).toBe(1)
    expect(a.length).toBeGreaterThan(5)
    expect(a).not.toBe(b)
    expect(a).not.toMatch(/train|leaves/i)
    expect(a.toLowerCase()).toContain('vlak') // Croatian token is effective
  })

  it('is repeatable with the same model', async () => {
    const first = await translate(['I never trusted him.', 'We need to talk. Not here.'])
    const second = await translate(['I never trusted him.', 'We need to talk. Not here.'])
    expect(second).toEqual(first)
    expect(runtime.stats.loads).toBe(1)
  })

  it('selects the regional variant through the target token', async () => {
    const [hr] = await translate(['We need bread and milk.'], 'hr')
    const [sr] = await translate(['We need bread and milk.'], 'sr-Latn')
    expect(hr.toLowerCase()).toContain('kruh')
    expect(sr.toLowerCase()).toContain('hleb')
  })

  it('does not drop sentences in multi-sentence subtitles and keeps dialogue dashes', async () => {
    const [cmd, dialogue] = await translate(['Get down! Now!', '- Is he dead?\n- Not yet.'])
    expect(cmd.split(/[.!?]/).filter((s) => s.trim()).length).toBe(2)
    expect(dialogue.split('\n')).toHaveLength(2)
    expect(dialogue.split('\n').every((l) => l.startsWith('- '))).toBe(true)
  })

  it('Serbian output has correct diacritics (mojibake repaired)', async () => {
    const out = await translate(["I'll call you when I get home.", 'Hold on tight!', 'Speak of the devil.'], 'sr-Latn')
    expect(out.map(countMojibake)).toEqual([0, 0, 0])
    expect(out.join(' ')).toMatch(/[čćđ]/)
  })

  it('translates several segments through the real job engine, keeping locked/manual text and timings', async () => {
    const segments: Segment[] = [
      { id: 'a', start: 1000, end: 2500, source: 'Where were you last night?', translations: {} },
      { id: 'b', start: 3000, end: 4500, source: 'I was gonna tell you, I swear.', translations: {} },
      { id: 'c', start: 5000, end: 6500, source: 'Locked.', translations: { 'sr-Cyrl': { text: 'Закључано.', status: 'approved', origin: 'manual', locked: true, updatedAt: '' } } },
      { id: 'd', start: 7000, end: 8500, source: 'Drop the gun!', translations: {} },
    ]
    const updates: SegmentUpdate[] = []
    const job = new TranslationJob({ provider, segments, profile: 'sr-Cyrl', sourceLanguage: 'en', neutralYat: 'ijekavian', contentType: 'movie', glossary: [], onUpdate: (u) => updates.push(...u), onProgress: () => {} })
    const final = await job.run()
    expect(final).toMatchObject({ state: 'completed', done: 3, failed: 0, skipped: 1 })
    const result = applyTranslationUpdates(segments, 'sr-Cyrl', updates, '2000-01-01T00:00:00Z').segments
    expect(result[2].translations['sr-Cyrl']?.text).toBe('Закључано.')
    for (const s of [result[0], result[1], result[3]]) {
      expect(s.translations['sr-Cyrl']?.text).toMatch(/[Ѐ-ӿ]/)
      expect(s.translations['sr-Cyrl']?.text).not.toMatch(/[A-Za-z]/)
    }
    const srt = buildExport({ id: 'p', name: 'Real', contentType: 'movie', sourceLanguage: 'en', activeProfile: 'sr-Cyrl', neutralYat: 'ijekavian', sourceFormat: 'srt', sourceFileName: null, formatHeader: null, createdAt: '', updatedAt: '', lastOpenedAt: null }, result, { format: 'srt', content: 'translation', profile: 'sr-Cyrl', lineEnding: 'crlf', bom: false })
    expect(parseSrt(srt.text).cues.map((c) => [c.start, c.end])).toEqual(segments.map((s) => [s.start, s.end]))
    console.log('[test:model] real job output:', result.map((s) => s.translations['sr-Cyrl']?.text))
  })
})

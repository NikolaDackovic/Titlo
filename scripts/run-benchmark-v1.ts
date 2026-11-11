/**
 * Translation benchmark runner.
 *
 *   npm run benchmark -- --provider opus --profiles hr,bs,sr-Latn,exyu-neutral
 *   npm run benchmark -- --provider llm --llm-url http://127.0.0.1:8080 --llm-model eurollm-9b-instruct
 *   npm run benchmark -- --provider test            (pipeline check only — scores are meaningless)
 *
 * Writes benchmark-results/<timestamp>-<provider>-<profile>.csv/.json with the model output,
 * sentence chrF, and EMPTY columns for human ratings (accuracy, naturalness, regional
 * suitability, readability, 1–5). Automatic scores never replace human evaluation.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { corpusChrf, sentenceChrf } from '../src/benchmark/chrf'
import { BENCHMARK, type BenchmarkItem } from '../src/benchmark/sentences'
import { isProfileId, type ProfileId } from '../src/domain/languages'
import { cyrillicToLatin } from '../src/localization/transliterate'
import { buildTarget } from '../src/translation/engine'
import { LocalLlmProvider } from '../src/translation/providers/localLlm'
import { OPUS_MODEL_ID, OpusMtProvider, type MarianRuntime } from '../src/translation/providers/opusMt'
import { TestTranslationProvider } from '../src/translation/providers/testProvider'
import type { TranslationProvider } from '../src/translation/types'

const args = new Map<string, string>()
process.argv.slice(2).forEach((a, i, all) => {
  if (a.startsWith('--')) args.set(a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true')
})

const providerName = args.get('provider') ?? 'test'
const profiles = (args.get('profiles') ?? 'hr,bs,sr-Latn,exyu-neutral').split(',').map((p) => p.trim())
const modelsDir = path.resolve(args.get('models') ?? 'models')
const outDir = path.resolve(args.get('out') ?? 'benchmark-results')
const limit = Number(args.get('limit') ?? BENCHMARK.length)

for (const p of profiles) if (!isProfileId(p)) throw new Error(`Unknown profile "${p}"`)

/** Node runtime for Marian models (same Transformers.js library as the app worker). */
function nodeMarianRuntime(): MarianRuntime {
  let translator: ((texts: string[], o?: Record<string, unknown>) => Promise<Array<{ translation_text: string }>>) | null = null
  return {
    async translate(modelId, texts, options) {
      if (!translator) {
        const { env, pipeline } = await import('@huggingface/transformers')
        env.allowRemoteModels = false
        env.localModelPath = modelsDir + path.sep
        translator = (await pipeline('translation', modelId, { dtype: options.dtype, local_files_only: true })) as unknown as typeof translator
      }
      const out = await translator!(texts, { num_beams: options.numBeams, max_new_tokens: 256 })
      return out.map((o) => o.translation_text)
    },
    dispose() {},
  }
}

function createBenchmarkProvider(): TranslationProvider {
  if (providerName === 'test') return new TestTranslationProvider(0)
  if (providerName === 'opus') {
    return new OpusMtProvider(
      nodeMarianRuntime(),
      { exists: async (rel) => existsSync(path.join(modelsDir, rel)) },
      { device: 'cpu', dtype: (args.get('dtype') as 'q8' | 'fp32') ?? 'q8', numBeams: Number(args.get('beams') ?? 4) },
      args.get('model') ?? OPUS_MODEL_ID,
    )
  }
  if (providerName === 'llm') {
    return new LocalLlmProvider({ baseUrl: args.get('llm-url') ?? 'http://127.0.0.1:8080', model: args.get('llm-model') ?? '', temperature: 0.2, timeoutMs: 180_000 })
  }
  throw new Error(`Unknown provider "${providerName}" (use test, opus or llm)`)
}

const referenceFor = (item: BenchmarkItem, profile: ProfileId) =>
  profile === 'hr' ? item.hr : profile === 'bs' ? item.bs : profile === 'exyu-neutral' ? item.neutral : item.sr

const csv = (v: string | number) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const provider = createBenchmarkProvider()
  const availability = await provider.checkAvailability()
  if (!availability.available) {
    console.error(`Provider not available: ${availability.message}`)
    for (const d of availability.details ?? []) console.error(`  ${d}`)
    process.exit(2)
  }
  if (provider.isTest) console.warn('WARNING: TEST provider — output is not a translation; scores only check the pipeline.')
  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const items = BENCHMARK.slice(0, limit)

  for (const profile of profiles as ProfileId[]) {
    const target = buildTarget(profile, 'ijekavian')
    const started = Date.now()
    const outputs: string[] = []
    const batchSize = provider.maxBatchItems
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const result = await provider.translateBatch({
        items: batch.map((b, k) => ({
          id: String(b.id),
          text: b.en,
          before: provider.usesContext ? items.slice(Math.max(0, i + k - 1), i + k).map((x) => x.en) : [],
          after: [],
        })),
        sourceLanguage: 'en',
        target,
        glossary: [],
        contentType: 'movie',
        signal: new AbortController().signal,
      })
      const byId = new Map(result.map((r) => [r.id, r.text]))
      for (const b of batch) outputs.push(byId.get(String(b.id)) ?? '')
      process.stdout.write(`\r${profile}: ${Math.min(i + batchSize, items.length)}/${items.length}`)
    }
    const seconds = (Date.now() - started) / 1000
    const rows = items.map((item, i) => {
      const hypothesis = cyrillicToLatin(outputs[i])
      const reference = referenceFor(item, profile)
      return { id: item.id, category: item.category, source: item.en, reference, hypothesis, chrf: sentenceChrf(hypothesis, reference) }
    })
    const corpus = corpusChrf(rows.map((r) => ({ hypothesis: r.hypothesis, reference: r.reference })))
    const byCategory = Object.fromEntries(
      [...new Set(rows.map((r) => r.category))].map((c) => [c, corpusChrf(rows.filter((r) => r.category === c).map((r) => ({ hypothesis: r.hypothesis, reference: r.reference })))]),
    )

    const base = path.join(outDir, `${stamp}-${provider.id}-${profile}`)
    const header = ['id', 'category', 'source', 'reference', 'hypothesis', 'chrF', 'accuracy_1_5', 'naturalness_1_5', 'regional_suitability_1_5', 'readability_1_5', 'notes']
    writeFileSync(
      `${base}.csv`,
      '﻿' + [header.join(','), ...rows.map((r) => [r.id, r.category, r.source, r.reference, r.hypothesis, r.chrf.toFixed(1), '', '', '', '', ''].map(csv).join(','))].join('\r\n') + '\r\n',
    )
    writeFileSync(
      `${base}.json`,
      JSON.stringify({ provider: provider.id, cacheKey: provider.cacheKey(), profile, isTestProvider: provider.isTest, references: 'draft references, pending native-speaker review', items: rows.length, seconds, corpusChrf: corpus, byCategory, rows }, null, 2),
    )
    console.log(`\n${profile}: corpus chrF ${corpus.toFixed(1)} over ${rows.length} lines in ${seconds.toFixed(1)}s → ${base}.csv`)
    for (const [c, v] of Object.entries(byCategory)) console.log(`   ${c.padEnd(11)} ${v.toFixed(1)}`)
  }
  provider.dispose?.()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

/**
 * Real-model smoke test: proves that the local model loads, receives input, generates
 * output, is repeatable and handles a batch. Output is saved, never hard-coded.
 *
 *   npm run model:smoke
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildTarget } from '../src/translation/engine'
import type { ProfileId } from '../src/domain/languages'
import { createNodeOpusProvider, startResourceSampler } from './lib/nodeMarian'

const SENTENCES = ["You're about to make a very serious mistake.", 'The train leaves at seven.', 'I never trusted him.', 'Where did you put my keys?', 'Get in the car. Now.']
const PROFILES: ProfileId[] = ['hr', 'bs', 'sr-Latn', 'sr-Cyrl', 'exyu-neutral']

async function main() {
  const { provider, runtime, modelsDir } = createNodeOpusProvider()
  const availability = await provider.checkAvailability()
  console.log(`Models dir: ${modelsDir}`)
  console.log(`Availability: ${availability.available ? 'OK' : 'MISSING'} — ${availability.message}`)
  if (!availability.available) {
    for (const d of availability.details ?? []) console.log(`  ${d}`)
    process.exit(2)
  }
  const sampler = startResourceSampler()
  const signal = new AbortController().signal
  const runs: Array<{ profile: ProfileId; token: string; mode: string; ms: number; outputs: string[] }> = []

  for (const profile of PROFILES) {
    const target = buildTarget(profile, 'ijekavian')
    // single-item calls (first one includes model loading)
    const singles: string[] = []
    let ms = 0
    for (const s of SENTENCES) {
      const t0 = performance.now()
      const [r] = await provider.translateBatch({ items: [{ id: 'x', text: s, before: [], after: [] }], sourceLanguage: 'en', target, glossary: [], contentType: 'movie', signal })
      ms += performance.now() - t0
      singles.push(r.text)
    }
    runs.push({ profile, token: (await import('../src/translation/providers/opusMt')).opusTargetToken(target), mode: 'single', ms, outputs: singles })
    console.log(`\n[${profile}] single calls, ${ms.toFixed(0)} ms total`)
    SENTENCES.forEach((s, i) => console.log(`  EN: ${s}\n  →  ${singles[i]}`))
  }

  // Repeatability + batch: same input twice as a batch of 5 for Croatian.
  const target = buildTarget('hr', 'ijekavian')
  const batchItems = SENTENCES.map((text, i) => ({ id: String(i), text, before: [], after: [] }))
  const t0 = performance.now()
  const batch = await provider.translateBatch({ items: batchItems, sourceLanguage: 'en', target, glossary: [], contentType: 'movie', signal })
  const batchMs = performance.now() - t0
  const repeat = await provider.translateBatch({ items: batchItems, sourceLanguage: 'en', target, glossary: [], contentType: 'movie', signal })
  const resources = sampler.stop()
  const singleHr = runs.find((r) => r.profile === 'hr')!.outputs
  const repeatable = batch.every((b, i) => b.text === repeat[i].text)
  const batchEqualsSingle = batch.every((b, i) => b.text === singleHr[i])
  console.log(`\nBatch of ${batchItems.length} (hr): ${batchMs.toFixed(0)} ms · repeatable: ${repeatable} · batch == single: ${batchEqualsSingle}`)
  console.log(`Model load: ${runtime.stats.loadMs?.toFixed(0)} ms · peak RSS ${resources.peakRssMb.toFixed(0)} MB · avg cores busy ${resources.avgCoresBusy.toFixed(2)}`)

  const out = {
    kind: 'real-model-smoke-test',
    date: new Date().toISOString(),
    machine: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, threads: os.cpus().length, ramGb: +(os.totalmem() / 2 ** 30).toFixed(1), freeRamGbAtEnd: +(os.freemem() / 2 ** 30).toFixed(2) },
    versions: await runtime.versions(),
    model: { id: 'Helsinki-NLP/opus-mt-tc-base-en-sh', dtype: 'q8', numBeams: 4, modelsDir },
    loadMs: runtime.stats.loadMs,
    runs,
    batch: { ms: batchMs, outputs: batch.map((b) => b.text), repeatable, batchEqualsSingle },
    resources,
  }
  const dir = path.resolve('benchmark/results')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `smoke-${out.date.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(`Saved: ${file}`)
}

main().catch((error) => {
  console.error('SMOKE TEST FAILED:', error)
  process.exit(1)
})

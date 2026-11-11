/**
 * ExYu translation benchmark v2 (real local model).
 *
 *   npm run benchmark                       # all model tokens, beam 4, batch 1
 *   npm run benchmark -- --beams 1          # greedy
 *   npm run benchmark -- --limit 10         # quick run
 *
 * Stage 1  — RAW model output for each target token, one sentence per call (true per-sentence latency).
 * Stage 1b — batch consistency check (same inputs in batches of 8 vs one by one).
 * Stage 2  — profile candidates built from raw output WITHOUT new inference
 *            (mojibake repair, transliteration, localization engine). Every candidate
 *            records which steps were applied, so model output and post-processing are never mixed up.
 *
 * Results: benchmark/results/<run-id>/ (never overwritten).
 * Human evaluation columns are left EMPTY on purpose.
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { corpusChrf, sentenceChrf } from '../../src/benchmark/chrf'
import { getProfile, type ProfileId } from '../../src/domain/languages'
import { applyProposals, findLocalizationProposals } from '../../src/localization/engine'
import { SEED_TERMBASE } from '../../src/localization/termbase'
import { cyrillicToLatin, latinToCyrillic } from '../../src/localization/transliterate'
import { detectYat } from '../../src/localization/yat'
import { OPUS_MODEL_ID, countMojibake, repairMojibake, splitForModel } from '../../src/translation/providers/opusMt'
import { createNodeMarianRuntime, startResourceSampler } from '../../scripts/lib/nodeMarian'
import { resolveModelsDir } from '../../build/modelsDir'

// ---------------------------------------------------------------- args & data
const args = new Map<string, string>()
process.argv.slice(2).forEach((a, i, all) => {
  if (a.startsWith('--')) args.set(a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true')
})
const beams = Number(args.get('beams') ?? 4)
const dtype = (args.get('dtype') ?? 'q8') as 'q8' | 'fp32'
const limit = Number(args.get('limit') ?? 1000)
const TOKENS = (args.get('tokens') ?? '>>hrv<<,>>bos_Latn<<,>>srp_Latn<<,>>srp_Cyrl<<').split(',')
const datasetPath = path.resolve(args.get('dataset') ?? 'benchmark/datasets/exyu-translation-100.json')

interface Item { id: string; category: string; source: string; references: Record<'sr-Latn' | 'hr' | 'bs' | 'exyu-neutral', string>; challenge: string }
const dataset = JSON.parse(readFileSync(datasetPath, 'utf8')) as { name: string; version: string; contentSha256: string; items: Item[] }
const items = dataset.items.slice(0, limit)

// ---------------------------------------------------------------- environment
const sh = (cmd: string) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unavailable'
  }
}
function environment() {
  const gpu = process.platform === 'win32' ? sh('powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController).Name -join \'; \'"') : 'unavailable'
  return {
    os: `${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`,
    cpu: os.cpus()[0]?.model?.trim(),
    logicalCpus: os.cpus().length,
    ramTotalGb: +(os.totalmem() / 2 ** 30).toFixed(2),
    ramFreeAtStartGb: +(os.freemem() / 2 ** 30).toFixed(2),
    gpu,
    gpuUsedByRuntime: false,
    gpuNote: 'Inference runs on the CPU execution provider of onnxruntime-node; GPU utilisation was not used or measured.',
  }
}

function modelInfo(modelsDir: string) {
  const dir = path.join(modelsDir, ...OPUS_MODEL_ID.split('/'))
  const manifestPath = path.join(dir, 'MODEL_INFO.json')
  if (!existsSync(manifestPath)) return { dir, manifest: null }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const onnx = (manifest.files as Array<{ path: string; bytes: number; sha256: string }>).filter((f) => f.path.startsWith('onnx/') || f.path === 'tokenizer.json')
  return { dir, totalBytes: manifest.totalBytes, original: manifest.original, onnxConversion: manifest.onnxConversion, keyFiles: onnx }
}

// ---------------------------------------------------------------- metrics helpers
const quantile = (values: number[], q: number) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const round = (v: number | null, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d)

/** Signals that a line is not a usable translation (checked automatically, not a quality score). */
function automaticFlags(source: string, output: string, profile: ProfileId | null) {
  const flags: string[] = []
  const plain = output.trim()
  if (!plain) flags.push('empty')
  if (/^\[?\d+\]?\.?$|^\d+\.\)\.?$/.test(plain)) flags.push('garbage')
  if (plain && plain.toLowerCase() === source.trim().toLowerCase()) flags.push('untranslated')
  const englishHits = (plain.toLowerCase().match(/\b(the|you|and|what|is|are|this|that|with|don't|i'm)\b/g) ?? []).length
  if (englishHits >= 2) flags.push('english-left')
  if (countMojibake(plain)) flags.push('mojibake')
  if (/\d/.test(plain) && !/\d/.test(source)) flags.push('digits-introduced')
  if (plain.length > source.length * 2.2 + 10) flags.push('too-long')
  if (plain.length < source.length * 0.25) flags.push('too-short')
  if (profile) {
    const def = getProfile(profile)
    const latin = def.script === 'Cyrl' ? cyrillicToLatin(plain) : plain
    const yat = detectYat(latin)
    const expected = def.yat === 'project' ? 'ijekavian' : def.yat
    if ((expected === 'ekavian' ? yat.ijekavian : yat.ekavian).length) flags.push('wrong-yat')
    if (def.script === 'Cyrl' && /[A-Za-zČĆŠŽĐčćšžđ]/.test(plain)) flags.push('latin-in-cyrillic')
    if (def.script === 'Latn' && /[Ѐ-ӿ]/.test(plain)) flags.push('cyrillic-in-latin')
  }
  return flags
}

// ---------------------------------------------------------------- stage 2 candidates
type Raw = Record<string, string[]>
interface Candidate { profile: ProfileId; id: string; description: string; steps: string[]; outputs: string[] }

function localize(texts: string[], profile: ProfileId) {
  let accepted = 0
  let advisory = 0
  const out = texts.map((t) => {
    const { proposals } = findLocalizationProposals(t, { profile, neutralYat: 'ijekavian', termbase: SEED_TERMBASE, rules: [] })
    const high = proposals.filter((p) => p.confidence === 'high' && p.replacement !== null)
    accepted += high.length
    advisory += proposals.length - high.length
    return high.length ? applyProposals(t, high) : t
  })
  return { out, accepted, advisory }
}

function buildCandidates(raw: Raw): { candidates: Candidate[]; localizationStats: Record<string, { accepted: number; advisory: number }> } {
  const c: Candidate[] = []
  const stats: Record<string, { accepted: number; advisory: number }> = {}
  const has = (t: string) => Array.isArray(raw[t])
  if (has('>>hrv<<')) c.push({ profile: 'hr', id: 'hr:hrv', description: 'hrv token, raw model output', steps: ['model'], outputs: raw['>>hrv<<'] })
  if (has('>>srp_Latn<<')) c.push({ profile: 'sr-Latn', id: 'sr-Latn:srp_Latn+repair', description: 'srp_Latn token + mojibake repair', steps: ['model', 'mojibake-repair'], outputs: raw['>>srp_Latn<<'].map(repairMojibake) })
  if (has('>>srp_Cyrl<<')) c.push({ profile: 'sr-Latn', id: 'sr-Latn:srp_Cyrl→Latn', description: 'srp_Cyrl token, transliterated to Latin', steps: ['model', 'transliteration'], outputs: raw['>>srp_Cyrl<<'].map(cyrillicToLatin) })
  if (has('>>srp_Cyrl<<')) c.push({ profile: 'sr-Cyrl', id: 'sr-Cyrl:srp_Cyrl', description: 'srp_Cyrl token, raw model output', steps: ['model'], outputs: raw['>>srp_Cyrl<<'] })
  if (has('>>srp_Latn<<')) c.push({ profile: 'sr-Cyrl', id: 'sr-Cyrl:srp_Latn+repair→Cyrl', description: 'srp_Latn + mojibake repair, transliterated to Cyrillic', steps: ['model', 'mojibake-repair', 'transliteration'], outputs: raw['>>srp_Latn<<'].map((t) => latinToCyrillic(repairMojibake(t))) })
  if (has('>>bos_Latn<<')) c.push({ profile: 'bs', id: 'bs:bos_Latn', description: 'bos_Latn token, raw model output', steps: ['model'], outputs: raw['>>bos_Latn<<'] })
  if (has('>>hrv<<')) {
    const l = localize(raw['>>hrv<<'], 'bs')
    stats['bs:hrv+localization'] = { accepted: l.accepted, advisory: l.advisory }
    c.push({ profile: 'bs', id: 'bs:hrv+localization', description: 'hrv token + localization engine (high-confidence proposals auto-accepted, analysis only)', steps: ['model', 'localization'], outputs: l.out })
  }
  if (has('>>bos_Latn<<')) c.push({ profile: 'exyu-neutral', id: 'neutral:bos_Latn', description: 'bos_Latn token, raw (current app heuristic for ijekavian Neutral)', steps: ['model'], outputs: raw['>>bos_Latn<<'] })
  if (has('>>hrv<<')) {
    const l = localize(raw['>>hrv<<'], 'exyu-neutral')
    stats['neutral:hrv+localization'] = { accepted: l.accepted, advisory: l.advisory }
    c.push({ profile: 'exyu-neutral', id: 'neutral:hrv+localization', description: 'hrv token + localization engine (high-confidence proposals auto-accepted, analysis only)', steps: ['model', 'localization'], outputs: l.out })
  }
  return { candidates: c, localizationStats: stats }
}

const referenceFor = (item: Item, profile: ProfileId) => (profile === 'sr-Latn' || profile === 'sr-Cyrl' ? item.references['sr-Latn'] : profile === 'hr' ? item.references.hr : profile === 'bs' ? item.references.bs : item.references['exyu-neutral'])
const csv = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ---------------------------------------------------------------- main
async function main() {
  const modelsDir = resolveModelsDir()
  const runtime = createNodeMarianRuntime(modelsDir)
  const signal = new AbortController().signal
  const options = { device: 'cpu' as const, dtype, numBeams: beams }
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-opus-${dtype}-b${beams}`
  const outDir = path.resolve('benchmark/results', runId)
  mkdirSync(outDir, { recursive: true })
  const env = environment()
  console.log(`Run ${runId}\n${env.cpu} · ${env.logicalCpus} threads · RAM ${env.ramTotalGb} GB (free ${env.ramFreeAtStartGb} GB)`)

  const errors: Array<{ token: string; id: string; error: string }> = []
  const raw: Raw = {}
  const latency: Record<string, number[]> = {}
  const sampler = startResourceSampler()
  const benchStart = performance.now()
  // Warm-up: loads the model and produces the first result. Measured separately so that
  // per-sentence latencies below do not include model loading.
  const warm = await runtime.translate(OPUS_MODEL_ID, [`${TOKENS[0]} ${items[0].source.split('\n')[0]}`], options, signal)
  const firstResultMs: number | null = performance.now() - benchStart
  console.log(`Warm-up output (real): ${JSON.stringify(warm[0])}`)

  // Stage 1 — raw outputs, one subtitle per call (dialogue lines are separate model inputs).
  for (const token of TOKENS) {
    raw[token] = []
    latency[token] = []
    for (const item of items) {
      const split = splitForModel(item.source)
      const t0 = performance.now()
      try {
        const outs = await runtime.translate(OPUS_MODEL_ID, split.parts.map((p) => `${token} ${p}`), options, signal)
        raw[token].push(split.join(outs.map((o) => o.trim())))
      } catch (error) {
        raw[token].push('')
        errors.push({ token, id: item.id, error: (error as Error).message })
      }
      latency[token].push(performance.now() - t0)
      process.stdout.write(`\r${token.padEnd(14)} ${raw[token].length}/${items.length}`)
    }
    process.stdout.write('\n')
  }
  const stage1Ms = performance.now() - benchStart

  // Stage 1b — batch consistency (first 24 single-part items, batches of 8, first token).
  const token0 = TOKENS[0]
  const sample = items.filter((i) => splitForModel(i.source).parts.length === 1).slice(0, 24)
  let batchSame = 0
  const batchDiffs: Array<{ id: string; single: string; batch: string }> = []
  const tb = performance.now()
  for (let i = 0; i < sample.length; i += 8) {
    const chunk = sample.slice(i, i + 8)
    const outs = await runtime.translate(OPUS_MODEL_ID, chunk.map((it) => `${token0} ${splitForModel(it.source).parts[0]}`), options, signal)
    chunk.forEach((it, k) => {
      const single = raw[token0][items.indexOf(it)]
      if (outs[k].trim() === single) batchSame += 1
      else batchDiffs.push({ id: it.id, single, batch: outs[k].trim() })
    })
  }
  const batchMs = performance.now() - tb
  const resources = sampler.stop()

  // Stage 2 — candidates and automatic metrics.
  const { candidates, localizationStats } = buildCandidates(raw)
  const candidateResults = candidates.map((c) => {
    const pairs = items.map((item, i) => {
      const hyp = getProfile(c.profile).script === 'Cyrl' ? cyrillicToLatin(c.outputs[i]) : c.outputs[i]
      return { hypothesis: hyp, reference: referenceFor(item, c.profile) }
    })
    const flags = items.map((item, i) => automaticFlags(item.source, c.outputs[i], c.profile))
    const flagCounts: Record<string, number> = {}
    flags.flat().forEach((f) => (flagCounts[f] = (flagCounts[f] ?? 0) + 1))
    const byCategory: Record<string, number> = {}
    for (const cat of [...new Set(items.map((i) => i.category))]) {
      byCategory[cat] = round(corpusChrf(pairs.filter((_, i) => items[i].category === cat)))!
    }
    return { ...c, chrF: round(corpusChrf(pairs)), byCategory, flagCounts, sentenceChrf: pairs.map((p) => round(sentenceChrf(p.hypothesis, p.reference))), flags }
  })

  const allLat = Object.values(latency).flat()
  const sourceChars = items.reduce((s, i) => s + i.source.length, 0)
  const tokenStats = Object.fromEntries(
    TOKENS.map((t) => {
      const lat = latency[t]
      const flags = items.map((item, i) => automaticFlags(item.source, raw[t][i], null))
      const counts: Record<string, number> = {}
      flags.flat().forEach((f) => (counts[f] = (counts[f] ?? 0) + 1))
      return [t, {
        processed: items.length,
        succeeded: raw[t].filter((x) => x.trim()).length,
        failed: errors.filter((e) => e.token === t).length,
        meanMs: round(mean(lat)), medianMs: round(quantile(lat, 0.5)), p95Ms: round(quantile(lat, 0.95)), totalMs: round(lat.reduce((a, b) => a + b, 0), 0),
        sourceCharsPerSecond: round(sourceChars / (lat.reduce((a, b) => a + b, 0) / 1000)),
        automaticFlags: counts,
      }]
    }),
  )

  const result = {
    runId,
    kind: 'real-model-benchmark',
    date: new Date().toISOString(),
    environment: env,
    runtime: { ...(await runtime.versions()), executionProvider: 'cpu (onnxruntime-node)', device: 'cpu' },
    model: { id: OPUS_MODEL_ID, dtype, ...modelInfo(modelsDir) },
    dataset: { path: path.relative(process.cwd(), datasetPath), name: dataset.name, version: dataset.version, contentSha256: dataset.contentSha256, itemsUsed: items.length },
    config: { numBeams: beams, maxNewTokens: 256, batchSize: 1, tokens: TOKENS, dialogueSplit: true, sentenceSplit: true },
    timing: {
      modelLoadMs: round(runtime.stats.loadMs, 0),
      timeToFirstResultMs: round(firstResultMs, 0),
      stage1TotalMs: round(stage1Ms, 0),
      overallMeanMs: round(mean(allLat)), overallMedianMs: round(quantile(allLat, 0.5)), overallP95Ms: round(quantile(allLat, 0.95)),
      note: 'Per-sentence latency = one subtitle per call after a separate warm-up (dialogue subtitles = several model inputs in one call). Model loading is measured only in modelLoadMs / timeToFirstResultMs.',
    },
    resources: { ...resources, note: 'peakRssMb is the whole Node process (includes native ONNX Runtime memory). avgCoresBusy = CPU time / wall time.' },
    batchConsistency: { token: token0, items: sample.length, batchSize: 8, identical: batchSame, differing: batchDiffs.length, examples: batchDiffs.slice(0, 10), batchTotalMs: round(batchMs, 0) },
    tokens: tokenStats,
    candidates: candidateResults.map(({ outputs: _o, flags: _f, sentenceChrf: _s, ...rest }) => rest),
    localizationStats,
    errors,
    humanEvaluation: 'NOT PERFORMED — see eval-*.csv templates',
  }
  writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(result, null, 2))

  // Raw outputs (one row per item, one column per token).
  writeFileSync(
    path.join(outDir, 'raw-outputs.csv'),
    '﻿' + [['id', 'category', 'source', ...TOKENS].join(','), ...items.map((it, i) => [it.id, it.category, it.source, ...TOKENS.map((t) => raw[t][i])].map(csv).join(','))].join('\r\n') + '\r\n',
  )
  // Human evaluation templates per candidate.
  const evalHeader = ['id', 'category', 'source', 'reference', 'candidate_output', 'steps', 'chrF', 'auto_flags', 'accuracy_1_5', 'naturalness_1_5', 'grammar_1_5', 'tone_1_5', 'slang_idioms_1_5', 'subtitle_suitability_1_5', 'regional_naturalness_1_5', 'critical_error_yes_no', 'notes']
  for (const c of candidateResults) {
    const rows = items.map((it, i) => [it.id, it.category, it.source, referenceFor(it, c.profile), c.outputs[i], c.steps.join('+'), c.sentenceChrf[i], c.flags[i].join(' '), '', '', '', '', '', '', '', '', ''])
    writeFileSync(path.join(outDir, `eval-${c.id.replace(/[^\w.-]+/g, '_')}.csv`), '﻿' + [evalHeader, ...rows].map((r) => r.map(csv).join(',')).join('\r\n') + '\r\n')
  }
  writeFileSync(path.join(outDir, 'checksums.json'), JSON.stringify({ datasetFileSha256: createHash('sha256').update(readFileSync(datasetPath)).digest('hex') }, null, 2))

  // Console summary
  console.log(`\nModel load ${result.timing.modelLoadMs} ms · first result ${result.timing.timeToFirstResultMs} ms · peak RSS ${resources.peakRssMb.toFixed(0)} MB · avg cores ${resources.avgCoresBusy.toFixed(2)}`)
  for (const [t, s] of Object.entries(tokenStats)) console.log(`${t.padEnd(14)} ok ${s.succeeded}/${s.processed} · mean ${s.meanMs} ms · median ${s.medianMs} · p95 ${s.p95Ms} · flags ${JSON.stringify(s.automaticFlags)}`)
  console.log(`Batch consistency (${token0}, batch 8): ${batchSame}/${sample.length} identical`)
  for (const c of candidateResults) console.log(`${c.id.padEnd(30)} chrF ${c.chrF} · ${JSON.stringify(c.flagCounts)}`)
  console.log(`Results: ${outDir}`)
}

main().catch((error) => {
  console.error('BENCHMARK FAILED:', error)
  process.exit(1)
})

/**
 * Add (or update) a REAL human recording in benchmark/speech/datasets/real-world.json.
 *
 *   npm run benchmark:speech:add -- --id sr-podcast-01 --language sr --audio "D:\snimci\podcast.mp3" \
 *     --reference-file "D:\snimci\podcast.txt" --quality "podcast mic, quiet room" --content-type podcast \
 *     --source "own recording" --license "own recording" --notes "two speakers" --confirm-reference [--copy]
 *
 * The reference is the exact text a PERSON typed or checked. Without --confirm-reference the sample is
 * stored as "unconfirmed" and no WER is computed for it. A reference that matches an earlier Whisper
 * output for the same file is refused: Whisper output must never become the reference.
 * Every change bumps the dataset version; the previous file is kept in datasets/history/.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { bumpVersion, findWhisperLikeReference, validateRealSample, type PreviousHypothesis, type RealLanguage } from './lib/realWorld'
import type { SpeechDataset, SpeechSample } from './lib/types'

const argv = process.argv.slice(2)
const arg = (name: string, fallback = '') => (argv.includes(`--${name}`) ? (argv[argv.indexOf(`--${name}`) + 1] ?? '') : fallback)
const flag = (name: string) => argv.includes(`--${name}`)

const root = path.resolve('benchmark/speech')
const datasetFile = path.join(root, 'datasets', 'real-world.json')
const audioDir = path.join(root, 'audio', 'real-world')

const fail = (lines: string[]) => {
  console.error(lines.map((l) => `✗ ${l}`).join('\n'))
  process.exit(1)
}

// ---- reference: typed by a person, from a file or inline
const referenceFile = arg('reference-file')
if (referenceFile && !existsSync(referenceFile)) fail([`Reference file not found: ${referenceFile}`])
const reference = (referenceFile ? readFileSync(referenceFile, 'utf8') : arg('reference-text')).replace(/^\uFEFF/, '').normalize('NFC').replace(/\s+/g, ' ').trim()

const input = {
  id: arg('id'),
  language: arg('language'),
  audio: arg('audio'),
  reference,
  qualityNote: arg('quality'),
  contentType: arg('content-type'),
  notes: arg('notes'),
  source: arg('source', 'not stated'),
  license: arg('license'),
  confirmReference: flag('confirm-reference'),
}

const dataset: SpeechDataset = existsSync(datasetFile)
  ? (JSON.parse(readFileSync(datasetFile, 'utf8')) as SpeechDataset)
  : {
      name: 'real-world',
      version: '0.0.0',
      createdAt: new Date().toISOString(),
      description: 'REAL human recordings in Serbian, Croatian and Bosnian with references typed or checked by a person. Audio stays local (benchmark/speech/audio/real-world/ is not committed).',
      generator: { script: 'benchmark/speech/scripts/add-real-sample.ts' },
      samples: [],
    }

const errors = validateRealSample(input, dataset.samples.map((s) => s.id), flag('replace'))
if (input.audio && !existsSync(input.audio)) errors.push(`Audio file not found: ${input.audio}`)
if (errors.length) fail(errors)

const sha = createHash('sha256').update(readFileSync(input.audio)).digest('hex')

// ---- guard: the reference must not be (nearly) identical to an earlier Whisper output for this audio
const previous: PreviousHypothesis[] = []
const resultsDir = path.join(root, 'results')
if (existsSync(resultsDir)) {
  for (const run of readdirSync(resultsDir)) {
    const file = path.join(resultsDir, run, 'samples.json')
    if (!existsSync(file)) continue
    try {
      for (const r of JSON.parse(readFileSync(file, 'utf8')) as Array<{ id: string; model: string; hypothesis: string | null; audioSha256?: string }>) {
        if (r.hypothesis && (r.audioSha256 === sha || r.id === input.id)) previous.push({ runId: run, model: r.model, hypothesis: r.hypothesis })
      }
    } catch {
      /* unreadable old result: skip */
    }
  }
}
const whisperLike = findWhisperLikeReference(reference, previous)
if (whisperLike)
  fail([
    `The reference is ${whisperLike.wer === 0 ? 'identical to' : 'almost identical to'} Whisper output (${whisperLike.model}, run ${whisperLike.runId}, normalized WER ${(100 * whisperLike.wer).toFixed(1)} %).`,
    'Type the reference while listening to the recording (or check it word by word). Whisper output must never be used as the reference.',
  ])

// ---- audio location: copied into the (git-ignored) project folder, or referenced where it is
let audioPath = path.resolve(input.audio)
if (flag('copy')) {
  mkdirSync(audioDir, { recursive: true })
  const target = path.join(audioDir, `${input.id}${path.extname(audioPath).toLowerCase()}`)
  if (path.resolve(target) !== audioPath) copyFileSync(audioPath, target)
  audioPath = target
}
const relative = path.relative(process.cwd(), audioPath)
const stored = relative.startsWith('..') || path.isAbsolute(relative) ? audioPath : relative.split(path.sep).join('/')

// ---- duration: from the WAV header when possible, otherwise measured by the browser during the run
function wavDurationMs(file: string): number | null {
  try {
    const buf = readFileSync(file)
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
    let offset = 12
    let byteRate = 0
    while (offset + 8 <= buf.length) {
      const id = buf.toString('ascii', offset, offset + 4)
      const size = buf.readUInt32LE(offset + 4)
      if (id === 'fmt ') byteRate = buf.readUInt32LE(offset + 16)
      if (id === 'data' && byteRate) return Math.round((size / byteRate) * 1000)
      offset += 8 + size + (size % 2)
    }
  } catch {
    /* not readable as WAV */
  }
  return null
}
const durationMs = path.extname(audioPath).toLowerCase() === '.wav' ? wavDurationMs(audioPath) : null
if (durationMs !== null && (durationMs < 10_000 || durationMs > 10 * 60_000)) console.warn(`! Duration ${(durationMs / 1000).toFixed(0)} s (recommended 30 s – 2 min).`)

const sample: SpeechSample = {
  id: input.id,
  language: input.language as RealLanguage,
  category: `real-${input.contentType.trim().toLowerCase().replace(/\s+/g, '-')}`,
  audio: stored,
  durationMs,
  sha256: sha,
  reference,
  referenceStatus: input.confirmReference ? 'human-verified' : 'unconfirmed',
  evaluation: input.confirmReference ? 'wer' : 'demo',
  expectedLanguage: input.language as RealLanguage,
  source: input.source,
  license: input.license,
  qualityNote: input.qualityNote,
  contentType: input.contentType,
  notes: input.notes,
  referenceConfirmedAt: input.confirmReference ? new Date().toISOString() : undefined,
  referenceSource: referenceFile ? 'file' : 'typed',
  realWorld: true,
}

// ---- write: keep the previous version, never lose data
if (existsSync(datasetFile)) {
  const historyDir = path.join(root, 'datasets', 'history')
  mkdirSync(historyDir, { recursive: true })
  const backup = path.join(historyDir, `real-world@${dataset.version}-${statSync(datasetFile).mtimeMs.toFixed(0)}.json`)
  if (!existsSync(backup)) copyFileSync(datasetFile, backup)
}
const next: SpeechDataset = {
  ...dataset,
  version: bumpVersion(dataset.version),
  updatedAt: new Date().toISOString(),
  samples: [...dataset.samples.filter((s) => s.id !== sample.id), sample].sort((a, b) => a.id.localeCompare(b.id)),
}
mkdirSync(path.dirname(datasetFile), { recursive: true })
writeFileSync(datasetFile, `${JSON.stringify(next, null, 2)}\n`)
console.log(`✓ ${sample.id} (${sample.language}) → real-world@${next.version}: ${next.samples.length} sample(s)`)
console.log(`  audio: ${stored}${durationMs !== null ? ` · ${(durationMs / 1000).toFixed(1)} s` : ' · duration measured during the run'}`)
console.log(`  reference: ${reference.split(' ').length} words · ${sample.referenceStatus}`)
if (!input.confirmReference) console.log('  ! Reference NOT confirmed: no WER/CER will be computed for this sample. Re-run with --confirm-reference after checking it word by word.')

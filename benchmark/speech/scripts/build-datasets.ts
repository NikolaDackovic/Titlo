/**
 * Builds the speech benchmark datasets (run once; datasets are versioned, not overwritten).
 *
 *   powershell -File benchmark/speech/scripts/tts-en.ps1      # renders the TTS WAVs first
 *   npx tsx benchmark/speech/scripts/build-datasets.ts
 *
 * Produces:
 *   datasets/asr-synthetic-en-v1.json  TTS English + artificial-noise variants + no-speech controls
 *   datasets/local-demo.json           the user's own recordings (no reference transcript → demo only)
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mixAtSnr, musicBed, readWav, whiteNoise, writeWav } from './lib/wav'
import type { SpeechDataset, SpeechSample } from './lib/types'

const root = path.resolve('benchmark/speech')
const rel = (p: string) => path.relative(process.cwd(), p).split(path.sep).join('/')
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const textsSpec = JSON.parse(readFileSync(path.join(root, 'references/synthetic-en-texts.json'), 'utf8')) as {
  version: string
  texts: Array<{ id: string; category: string; text: string }>
  noisy: string[]
}
const tts = JSON.parse(readFileSync(path.join(root, 'audio/synthetic-en/tts/tts-manifest.json'), 'utf8').replace(/^\uFEFF/, '')) as {
  engine: string
  os: string
  generatedAt: string
  items: Array<{ textId: string; voice: string; rate: number; file: string }>
}
const textById = new Map(textsSpec.texts.map((t) => [t.id, t]))
const SR = 16000
const samples: SpeechSample[] = []
const LICENSE = 'Generated locally for this project with Windows SAPI voices; text written for this benchmark.'

const durationMs = (file: string) => {
  const wav = readWav(file)
  if (wav.sampleRate !== SR) throw new Error(`${file}: expected ${SR} Hz`)
  return Math.round((wav.samples.length / SR) * 1000)
}

const push = (s: Omit<SpeechSample, 'durationMs' | 'sha256'>) => {
  const file = path.resolve(s.audio)
  samples.push({ ...s, durationMs: durationMs(file), sha256: sha256(file) })
}

// 1. Clean / fast TTS.
for (const item of tts.items) {
  const text = textById.get(item.textId)!
  const voice = item.voice.includes('Zira') ? 'zira' : 'david'
  push({
    id: `en-${item.textId}-${voice}-r${item.rate}`,
    language: 'en',
    category: item.rate > 0 ? 'synthetic-fast' : text.category,
    audio: rel(path.resolve(item.file)),
    reference: text.text,
    referenceStatus: 'exact-by-construction',
    evaluation: 'wer',
    expectedLanguage: 'en',
    source: `${tts.engine}, voice "${item.voice}", rate ${item.rate}`,
    license: LICENSE,
    qualityNote: 'Synthetic TTS voice, studio-clean. Not representative of human speech.',
  })
}

// 2. Artificial background: white noise (10 dB SNR) and a synthetic music bed (6 dB SNR).
const mixDir = path.join(root, 'audio/synthetic-en/mixed')
mkdirSync(mixDir, { recursive: true })
textsSpec.noisy.forEach((id, i) => {
  const voice = i % 2 === 0 ? 'david' : 'zira'
  const clean = readWav(path.join(root, `audio/synthetic-en/tts/${id}-${voice}-r0.wav`))
  const variants: Array<[string, string, Float32Array, number]> = [
    ['noise10', 'synthetic-noise', whiteNoise(clean.samples.length, 1000 + i), 10],
    ['music6', 'synthetic-music', musicBed(clean.samples.length, SR), 6],
  ]
  for (const [tag, category, noise, snr] of variants) {
    const file = path.join(mixDir, `${id}-${voice}-${tag}.wav`)
    writeWav(file, { sampleRate: SR, samples: mixAtSnr(clean.samples, noise, SR, snr) })
    push({
      id: `en-${id}-${voice}-${tag}`,
      language: 'en',
      category,
      audio: rel(file),
      reference: textById.get(id)!.text,
      referenceStatus: 'exact-by-construction',
      evaluation: 'wer',
      expectedLanguage: 'en',
      source: `TTS (${voice}) mixed with ${tag.startsWith('noise') ? `white noise (seed ${1000 + i})` : 'a synthetic chord + kick bed'} at ${snr} dB SNR`,
      license: LICENSE,
      qualityNote: 'Artificial background sound, not a real recording.',
    })
  }
})

// 3. No-speech controls (language detection must say "no speech" / not decide).
const ctlDir = path.join(root, 'audio/controls')
mkdirSync(ctlDir, { recursive: true })
const controls: Array<[string, string, Float32Array]> = [
  ['silence-10s', 'Digital silence, 10 s', new Float32Array(10 * SR)],
  ['noise-10s', 'White noise only, 10 s, ≈ −30 dBFS', whiteNoise(10 * SR, 7).map((v) => v * 0.055)],
  ['music-10s', 'Synthetic music bed only, 10 s', musicBed(10 * SR, SR).map((v) => v * 0.25)],
]
for (const [id, note, data] of controls) {
  const file = path.join(ctlDir, `${id}.wav`)
  writeWav(file, { sampleRate: SR, samples: data })
  push({
    id: `ctl-${id}`,
    language: null,
    category: 'no-speech',
    audio: rel(file),
    reference: '',
    referenceStatus: 'exact-by-construction',
    evaluation: 'detection-only',
    expectedLanguage: 'no-speech',
    source: note,
    license: LICENSE,
    qualityNote: 'Contains no speech by construction.',
  })
}

const dataset: SpeechDataset = {
  name: 'asr-synthetic-en',
  version: '1.0.0',
  createdAt: new Date().toISOString(),
  description: 'Synthetic English speech (Windows TTS Zira/David), artificial noise/music variants and no-speech controls. Exact references by construction. Not representative of real human voices.',
  generator: { tts: tts.engine, os: tts.os, ttsGeneratedAt: tts.generatedAt, textsVersion: textsSpec.version },
  samples,
}
const out = path.join(root, 'datasets/asr-synthetic-en-v1.json')
if (existsSync(out)) throw new Error(`${rel(out)} already exists. Datasets are versioned: bump the version instead of overwriting.`)
writeFileSync(out, JSON.stringify(dataset, null, 2))
console.log(`${rel(out)}: ${samples.length} samples, ${(samples.reduce((s, x) => s + x.durationMs, 0) / 1000).toFixed(1)} s of audio`)

// 4. The user's own recordings (local paths, no reference transcript): demonstration only.
const demo: SpeechSample[] = []
for (const [id, file, lang] of [
  ['demo-eng-video', 'C:/Users/38169/Downloads/eng-video.mp4', 'en'],
  ['demo-srp-video', 'C:/Users/38169/Downloads/srp-video.mp4', 'sr'],
] as const) {
  if (!existsSync(file)) continue
  demo.push({
    id,
    language: lang,
    category: 'user-demo',
    audio: file,
    durationMs: 0, // measured by the browser at run time (MP4 is decoded there)
    sha256: sha256(file),
    reference: null,
    referenceStatus: 'none',
    evaluation: 'demo',
    expectedLanguage: lang,
    source: 'User-provided recording (CapCut voice). Language label given by the user.',
    license: 'User-provided, used with permission for local testing only. Not redistributed.',
    qualityNote: 'No reference transcript: output is shown, WER/CER cannot be computed.',
  })
}
const demoOut = path.join(root, 'datasets/local-demo.json')
writeFileSync(demoOut, JSON.stringify({ name: 'local-demo', version: '1.0.0', createdAt: new Date().toISOString(), description: 'User recordings on this computer (absolute paths). No reference transcripts: demonstration only, never a WER/CER result.', generator: {}, samples: demo } satisfies SpeechDataset, null, 2))
console.log(`${rel(demoOut)}: ${demo.length} demo recordings`)

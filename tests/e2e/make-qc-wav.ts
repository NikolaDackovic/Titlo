// SYNTHETIC test clip for qc-review.e2e.mjs: Windows TTS speech + 35 s digital silence + TTS speech.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWav, writeWav } from '../../benchmark/speech/scripts/lib/wav'

const here = path.dirname(fileURLToPath(import.meta.url))
const tts = path.join(here, '../../benchmark/speech/audio/synthetic-en/tts')
const a = readWav(path.join(tts, 't01-david-r0.wav'))
const b = readWav(path.join(tts, 't03-zira-r0.wav'))
const gap = 35 * a.sampleRate
const out = new Float32Array(a.samples.length + gap + b.samples.length)
out.set(a.samples, 0)
out.set(b.samples, a.samples.length + gap)
const file = path.join(here, 'qc-speech-silence-speech.wav')
writeWav(file, { sampleRate: a.sampleRate, samples: out })
console.log(file, `${(out.length / a.sampleRate).toFixed(1)} s`)

/** Minimal PCM16 mono WAV reader/writer for the speech benchmark (no dependencies). */
import { readFileSync, writeFileSync } from 'node:fs'

export interface Pcm {
  sampleRate: number
  samples: Float32Array
}

export function readWav(file: string): Pcm {
  const buf = readFileSync(file)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: not a WAV file`)
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bits = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      if (buf.readUInt16LE(body) !== 1) throw new Error(`${file}: only PCM WAV is supported`)
      channels = buf.readUInt16LE(body + 2)
      sampleRate = buf.readUInt32LE(body + 4)
      bits = buf.readUInt16LE(body + 14)
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`${file}: only 16-bit WAV is supported`)
      const frames = Math.floor(size / 2 / channels)
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i += 1) {
        let sum = 0
        for (let c = 0; c < channels; c += 1) sum += buf.readInt16LE(body + (i * channels + c) * 2)
        samples[i] = sum / channels / 32768
      }
      return { sampleRate, samples }
    }
    offset = body + size + (size % 2)
  }
  throw new Error(`${file}: no data chunk`)
}

export function writeWav(file: string, { sampleRate, samples }: Pcm) {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i += 1) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2)
  writeFileSync(file, buf)
}

/** RMS of the frames that contain sound (so leading/trailing silence does not distort SNR). */
export function activeRms(samples: Float32Array, sampleRate: number, floor = 0.01): number {
  const frame = Math.round(0.02 * sampleRate)
  let sum = 0
  let n = 0
  for (let f = 0; f + frame <= samples.length; f += frame) {
    let s = 0
    for (let i = f; i < f + frame; i += 1) s += samples[i] * samples[i]
    if (Math.sqrt(s / frame) > floor) {
      sum += s
      n += frame
    }
  }
  return n ? Math.sqrt(sum / n) : 0
}

/** Deterministic PRNG (mulberry32) so generated noise is identical on every machine. */
export function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function whiteNoise(length: number, seed: number): Float32Array {
  const rand = prng(seed)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) out[i] = rand() * 2 - 1
  return out
}

/**
 * A synthetic "music bed": a slowly changing three-note chord plus a soft kick every 0.5 s.
 * It is NOT real music; it only tests robustness to tonal background sound.
 */
export function musicBed(length: number, sampleRate: number): Float32Array {
  const out = new Float32Array(length)
  const chords = [
    [220, 277.18, 329.63],
    [196, 246.94, 293.66],
    [174.61, 220, 261.63],
  ]
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate
    const chord = chords[Math.floor(t / 2) % chords.length]
    let v = 0
    for (const f of chord) v += Math.sin(2 * Math.PI * f * t) / 3
    const beat = t % 0.5
    v = v * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t)) + 0.8 * Math.sin(2 * Math.PI * 60 * beat) * Math.exp(-beat * 18)
    out[i] = v
  }
  return out
}

export function rms(x: Float32Array): number {
  let s = 0
  for (let i = 0; i < x.length; i += 1) s += x[i] * x[i]
  return Math.sqrt(s / (x.length || 1))
}

/** speech + noise scaled so that active-speech-RMS / noise-RMS equals `snrDb`. */
export function mixAtSnr(speech: Float32Array, noise: Float32Array, sampleRate: number, snrDb: number): Float32Array {
  const target = activeRms(speech, sampleRate) / 10 ** (snrDb / 20)
  const gain = target / (rms(noise) || 1)
  const out = new Float32Array(speech.length)
  let peak = 0
  for (let i = 0; i < speech.length; i += 1) {
    out[i] = speech[i] + noise[i % noise.length] * gain
    peak = Math.max(peak, Math.abs(out[i]))
  }
  if (peak > 0.99) for (let i = 0; i < out.length; i += 1) out[i] *= 0.99 / peak
  return out
}

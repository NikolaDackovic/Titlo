/**
 * SYNTHETIC test signals (16 kHz mono). They imitate the *energy pattern* of speech and music
 * for unit tests of the activity heuristics. They are not speech and say nothing about
 * recognition accuracy for Serbian, Croatian, Bosnian or English.
 */
export const SR = 16000

/** Deterministic PRNG (mulberry32). */
export function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const silence = (sec: number) => new Float32Array(Math.round(sec * SR))

export function noise(sec: number, amp: number, seed = 1) {
  const r = prng(seed)
  return Float32Array.from({ length: Math.round(sec * SR) }, () => (r() * 2 - 1) * amp)
}

/**
 * Speech-like signal: syllables of ~180 ms at ~4 per second, alternating voiced (harmonic,
 * 120 Hz) and unvoiced (noise) sounds, with short gaps between syllables and a longer gap
 * between "words".
 */
export function speechLike(sec: number, amp = 0.25, seed = 7) {
  const r = prng(seed)
  const out = new Float32Array(Math.round(sec * SR))
  let i = 0
  let syllable = 0
  while (i < out.length) {
    const len = Math.round((0.14 + r() * 0.1) * SR)
    const voiced = syllable % 3 !== 2
    for (let k = 0; k < len && i + k < out.length; k += 1) {
      const env = Math.sin((Math.PI * k) / len)
      const t = (i + k) / SR
      const v = voiced
        ? (Math.sin(2 * Math.PI * 120 * t) + 0.5 * Math.sin(2 * Math.PI * 240 * t) + 0.3 * Math.sin(2 * Math.PI * 360 * t)) / 1.8
        : r() * 2 - 1
      out[i + k] = amp * env * v
    }
    i += len + Math.round((syllable % 4 === 3 ? 0.18 : 0.05 + r() * 0.04) * SR)
    syllable += 1
  }
  return out
}

/** Whisper: unvoiced (noise) syllables only, very quiet. */
export function whisper(sec: number, amp = 0.012, seed = 3) {
  const r = prng(seed)
  const out = new Float32Array(Math.round(sec * SR))
  let i = 0
  while (i < out.length) {
    const len = Math.round((0.15 + r() * 0.1) * SR)
    for (let k = 0; k < len && i + k < out.length; k += 1) out[i + k] = amp * Math.sin((Math.PI * k) / len) * (r() * 2 - 1)
    i += len + Math.round((0.06 + r() * 0.06) * SR)
  }
  return out
}

/** Music without speech: sustained chords (no gaps) with a soft pulse. */
export function music(sec: number, amp = 0.2) {
  const chords = [
    [220, 277.18, 329.63],
    [196, 246.94, 293.66],
  ]
  return Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => {
    const t = i / SR
    const chord = chords[Math.floor(t / 2) % chords.length]
    let v = 0
    for (const f of chord) v += Math.sin(2 * Math.PI * f * t) / 3
    return amp * v * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.5 * t))
  })
}

export const mix = (a: Float32Array, b: Float32Array) => a.map((v, i) => v + (b[i] ?? 0))

export function concat(...parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

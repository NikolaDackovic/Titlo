/**
 * Lightweight audio activity analysis (no model): short-time energy (RMS) and zero-crossing rate
 * per 20 ms frame, computed once from the decoded 16 kHz audio that transcription / the waveform
 * already have in memory. Used ONLY for quality-control warnings — it never removes, cuts or
 * retimes anything.
 *
 * What it can tell apart (heuristically):
 * - digital or near silence (no frame above the silence threshold),
 * - quiet sound (e.g. whisper, distant speech) versus normal level,
 * - steady sound (hum, noise, sustained tones: little energy variation),
 * - varying sound that looks like speech (many short low-energy gaps between syllables, changing
 *   voiced/unvoiced character) versus varying sound that does not.
 *
 * What it cannot do reliably: separate speech over music from music, or detect words in noise.
 * Every result is a hint for a human, never a decision. Thresholds were tuned on synthetic
 * signals and Windows TTS clips (see docs/TRANSCRIPTION_QUALITY_CONTROL.md).
 */

export const FRAME_MS = 20
/** A frame below this level (dBFS) counts as silent. Room tone of a quiet recording is ~-60…-50. */
export const SILENT_DB = -55
/** Active sound below this average level (dBFS) is "quiet" (whisper, distant or very low speech). */
export const QUIET_DB = -40

export interface AudioActivity {
  frameMs: number
  /** RMS level per frame in dBFS, rounded, clamped to [-100, 0]. */
  db: Int8Array
  /** Zero crossings per frame, scaled 0–255 (255 = every sample changes sign). */
  zcr: Uint8Array
  durationMs: number
}

/** One pass over the samples; ~1 byte per 10 ms of audio for both tracks (2 h ≈ 0.7 MB). */
export function analyzeActivity(samples: Float32Array, sampleRate = 16000): AudioActivity {
  const frame = Math.max(1, Math.round((FRAME_MS / 1000) * sampleRate))
  const frames = Math.ceil(samples.length / frame)
  const db = new Int8Array(frames)
  const zcr = new Uint8Array(frames)
  for (let f = 0; f < frames; f += 1) {
    const start = f * frame
    const end = Math.min(samples.length, start + frame)
    let sum = 0
    let crossings = 0
    let prev = samples[start] ?? 0
    for (let i = start; i < end; i += 1) {
      const v = samples[i]
      sum += v * v
      if ((v >= 0) !== (prev >= 0)) crossings += 1
      prev = v
    }
    const n = end - start || 1
    const rms = Math.sqrt(sum / n)
    db[f] = Math.max(-100, Math.min(0, Math.round(20 * Math.log10(rms || 1e-10))))
    zcr[f] = Math.min(255, Math.round((crossings / n) * 255))
  }
  return { frameMs: FRAME_MS, db, zcr, durationMs: Math.round((samples.length / sampleRate) * 1000) }
}

export type ActivityKind = 'silence' | 'steady' | 'varying' | 'speech-like'

export interface RangeActivity {
  kind: ActivityKind
  /** Share of frames above the silence threshold (0–1). */
  activeFraction: number
  /** Milliseconds above the silence threshold. */
  activeMs: number
  /** Power-average level of the active frames (dBFS); -100 when there are none. */
  levelDb: number
  /** Loudest frame (dBFS). */
  peakDb: number
  /** Active sound whose average level is below QUIET_DB. */
  quiet: boolean
  /** Diagnostics (shown in the QC explanation, documented). */
  lowEnergyRatio: number
  zcrSpread: number
  dynamicDb: number
}

const LEVEL_HIST = new Uint32Array(101)
const ZCR_HIST = new Uint32Array(256)

/** Linear power for each integer level -100…0 dBFS. */
const POWER = Float64Array.from({ length: 101 }, (_, i) => 10 ** ((i - 100) / 10))

/** Value at quantile q of a histogram (same rank rule as indexing a sorted array). */
function histQuantile(hist: Uint32Array, total: number, q: number): number {
  const rank = Math.min(total - 1, Math.max(0, Math.round(q * (total - 1))))
  let seen = 0
  for (let v = 0; v < hist.length; v += 1) {
    seen += hist[v]
    if (seen > rank) return hist.length === 101 ? v - 100 : v
  }
  return 0
}

/**
 * Describe the sound between startMs and endMs.
 *
 * Speech cue (Scheirer & Slaney, 1997): within each 1 s window, the share of frames whose energy
 * is below half of the window's mean energy is high for speech (pauses between syllables and
 * words) and low for steady music or noise. A second cue is the spread of the zero-crossing rate
 * (speech alternates voiced and unvoiced sounds).
 */
export function describeRange(activity: AudioActivity, startMs: number, endMs: number): RangeActivity {
  const from = Math.max(0, Math.floor(startMs / activity.frameMs))
  const to = Math.min(activity.db.length, Math.ceil(endMs / activity.frameMs))
  const count = Math.max(0, to - from)
  const empty: RangeActivity = { kind: 'silence', activeFraction: 0, activeMs: 0, levelDb: -100, peakDb: -100, quiet: false, lowEnergyRatio: 0, zcrSpread: 0, dynamicDb: 0 }
  if (!count) return empty

  // Levels are integers in [-100, 0] and ZCR in [0, 255]: histograms instead of sorting and a
  // lookup table instead of Math.pow keep this cheap for thousands of subtitles.
  let active = 0
  let power = 0
  let peak = -100
  // Reused scratch buffers (allocating typed arrays per call dominated the cost).
  const levelHist = LEVEL_HIST.fill(0)
  const zcrHist = ZCR_HIST.fill(0)
  for (let f = from; f < to; f += 1) {
    const d = activity.db[f]
    levelHist[d + 100] += 1
    if (d > peak) peak = d
    if (d > SILENT_DB) {
      active += 1
      power += POWER[d + 100]
      zcrHist[activity.zcr[f]] += 1
    }
  }
  const activeFraction = active / count
  const levelDb = active ? 10 * Math.log10(power / active) : -100
  const dynamicDb = histQuantile(levelHist, count, 0.9) - histQuantile(levelHist, count, 0.1)
  const zcrSpread = active > 4 ? (histQuantile(zcrHist, active, 0.9) - histQuantile(zcrHist, active, 0.1)) / 255 : 0

  // Low-energy-frame ratio over 1 s windows (frames of one window: 50).
  const win = Math.max(5, Math.round(1000 / activity.frameMs))
  let ratioSum = 0
  let windows = 0
  for (let w = from; w < to; w += win) {
    const end = Math.min(to, w + win)
    if (end - w < win / 2 && windows > 0) break
    let mean = 0
    for (let f = w; f < end; f += 1) mean += POWER[activity.db[f] + 100]
    mean /= end - w
    if (10 * Math.log10(mean || 1e-10) <= SILENT_DB) continue
    let low = 0
    for (let f = w; f < end; f += 1) if (POWER[activity.db[f] + 100] < 0.5 * mean) low += 1
    ratioSum += low / (end - w)
    windows += 1
  }
  const lowEnergyRatio = windows ? ratioSum / windows : 0

  let kind: ActivityKind
  if (activeFraction < 0.1 || peak <= SILENT_DB) kind = 'silence'
  else if (dynamicDb < 6) kind = 'steady'
  else if (lowEnergyRatio >= SPEECH_LOW_ENERGY_RATIO && zcrSpread >= SPEECH_ZCR_SPREAD) kind = 'speech-like'
  else kind = 'varying'

  return {
    kind,
    activeFraction,
    activeMs: active * activity.frameMs,
    levelDb,
    peakDb: peak,
    quiet: active > 0 && levelDb < QUIET_DB,
    lowEnergyRatio,
    zcrSpread,
    dynamicDb,
  }
}

/** Tuned on synthetic data (TTS speech, synthetic music bed, white noise). */
export const SPEECH_LOW_ENERGY_RATIO = 0.2
export const SPEECH_ZCR_SPREAD = 0.04

export interface ActiveRegion {
  startMs: number
  endMs: number
}

/**
 * Continuous stretches of sound (gaps shorter than `bridgeMs` are bridged), at least `minMs` long.
 * Used to find sound that no subtitle covers.
 */
export function activeRegions(activity: AudioActivity, minMs = 1500, bridgeMs = 400): ActiveRegion[] {
  const out: ActiveRegion[] = []
  const bridge = Math.round(bridgeMs / activity.frameMs)
  let start = -1
  let lastActive = -1
  for (let f = 0; f <= activity.db.length; f += 1) {
    const on = f < activity.db.length && activity.db[f] > SILENT_DB
    if (on) {
      if (start < 0) start = f
      lastActive = f
    } else if (start >= 0 && (f - lastActive > bridge || f === activity.db.length)) {
      const r = { startMs: start * activity.frameMs, endMs: (lastActive + 1) * activity.frameMs }
      if (r.endMs - r.startMs >= minMs) out.push(r)
      start = -1
    }
  }
  return out
}

/**
 * Browser audio decoding: any file the browser can decode (MP4/MOV/M4A/MP3/WAV/WebM/OGG)
 * → mono Float32 PCM at 16 kHz, plus a compact waveform for the timeline.
 * Everything stays in memory on this computer.
 */
import { SAMPLE_RATE } from './transcription'
import { t as L } from '../i18n'

/** The browser build keeps the whole file in memory; larger files need the desktop build (FFmpeg). */
export const MAX_BROWSER_MEDIA_BYTES = 700 * 1024 * 1024

export class MediaDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaDecodeError'
  }
}

export async function decodeToMono16k(file: File): Promise<{ samples: Float32Array; durationMs: number }> {
  if (file.size > MAX_BROWSER_MEDIA_BYTES) {
    throw new MediaDecodeError(L('File is {size} MB. The browser version can decode files up to {max} MB; longer films need the desktop build (FFmpeg).', { size: (file.size / 2 ** 20).toFixed(0), max: MAX_BROWSER_MEDIA_BYTES / 2 ** 20 }))
  }
  const bytes = await file.arrayBuffer()
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  // The context resamples to 16 kHz while decoding.
  const ctx = new AudioCtx({ sampleRate: SAMPLE_RATE })
  let buffer: AudioBuffer
  try {
    buffer = await ctx.decodeAudioData(bytes)
  } catch {
    throw new MediaDecodeError(L('The browser could not decode the audio track of this file (unsupported codec or container, e.g. some MKV/AC3/DTS files). Convert it to MP4 (AAC) or WAV, or use the desktop build.'))
  } finally {
    void ctx.close()
  }
  const { numberOfChannels, length } = buffer
  const samples = new Float32Array(length)
  for (let c = 0; c < numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i += 1) samples[i] += data[i] / numberOfChannels
  }
  return { samples, durationMs: Math.round((length / SAMPLE_RATE) * 1000) }
}

/** Peak amplitude per bucket (0–1), for drawing a waveform. */
export function computePeaks(samples: Float32Array, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets)
  const size = Math.max(1, Math.floor(samples.length / buckets))
  let max = 0
  for (let b = 0; b < buckets; b += 1) {
    let peak = 0
    const end = Math.min(samples.length, (b + 1) * size)
    for (let i = b * size; i < end; i += 1) {
      const v = Math.abs(samples[i])
      if (v > peak) peak = v
    }
    peaks[b] = peak
    if (peak > max) max = peak
  }
  if (max > 0) for (let b = 0; b < buckets; b += 1) peaks[b] /= max
  return peaks
}

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readWav } from '../../benchmark/speech/scripts/lib/wav'
import { concat, mix, music, noise, silence, speechLike, SR, whisper } from '../test/syntheticAudio'
import { activeRegions, analyzeActivity, describeRange } from './audioActivity'

// All signals here are SYNTHETIC (see src/test/syntheticAudio.ts); the WAV block below uses
// Windows TTS clips. Neither is a benchmark of real human speech.

const whole = (samples: Float32Array) => {
  const a = analyzeActivity(samples, SR)
  return describeRange(a, 0, a.durationMs)
}

describe('audio activity (synthetic signals)', () => {
  it('digital silence is silence', () => {
    expect(whole(silence(5))).toMatchObject({ kind: 'silence', activeFraction: 0, peakDb: -100 })
  })

  it('music without speech is not speech-like', () => {
    const r = whole(music(8))
    expect(r.kind).not.toBe('silence')
    expect(r.kind).not.toBe('speech-like')
  })

  it('steady noise is "steady", not speech', () => {
    expect(whole(noise(5, 0.05)).kind).toBe('steady')
  })

  it('normal speech is speech-like and not quiet', () => {
    const r = whole(speechLike(6))
    expect(r.kind).toBe('speech-like')
    expect(r.quiet).toBe(false)
  })

  it('low-volume speech is still speech-like, flagged as quiet, never silence', () => {
    const r = whole(speechLike(6, 0.006))
    expect(r.kind).toBe('speech-like')
    expect(r.quiet).toBe(true)
  })

  it('whisper (quiet unvoiced syllables) is active sound, quiet, not silence', () => {
    const r = whole(whisper(6))
    expect(r.kind).not.toBe('silence')
    expect(r.activeFraction).toBeGreaterThan(0.3)
    expect(r.quiet).toBe(true)
  })

  it('speech over background music is still recognised as speech-like', () => {
    expect(whole(mix(speechLike(8, 0.25), music(8, 0.05))).kind).toBe('speech-like')
  })

  it('a short word in silence: the word is active, the rest is silence', () => {
    const audio = concat(silence(1), speechLike(0.3), silence(1))
    const a = analyzeActivity(audio, SR)
    expect(describeRange(a, 1000, 1300).kind).not.toBe('silence')
    expect(describeRange(a, 1500, 2300).kind).toBe('silence')
    expect(describeRange(a, 0, a.durationMs).activeFraction).toBeLessThan(0.2)
  })

  it('long pauses split speech into separate regions with the original timeline', () => {
    const audio = concat(speechLike(3), silence(6), speechLike(3))
    const regions = activeRegions(analyzeActivity(audio, SR), 1000)
    expect(regions).toHaveLength(2)
    expect(regions[0].startMs).toBeLessThan(200)
    expect(regions[1].startMs).toBeGreaterThanOrEqual(8900)
    expect(regions[1].startMs).toBeLessThan(9300)
  })

  it('speech after a long silence starts at the right time', () => {
    const audio = concat(silence(10), speechLike(4))
    const regions = activeRegions(analyzeActivity(audio, SR), 1000)
    expect(regions).toHaveLength(1)
    expect(Math.abs(regions[0].startMs - 10_000)).toBeLessThan(300)
  })

  it('keeps the memory small: 2 bytes per 20 ms frame', () => {
    const a = analyzeActivity(silence(60), SR)
    expect(a.db.length).toBe(3000)
    expect(a.db.byteLength + a.zcr.byteLength).toBe(6000)
    expect(a.durationMs).toBe(60_000)
  })
})

// Windows TTS (Zira/David) clips from the speech benchmark — synthetic voices, used only to check
// that the heuristic does not call clear speech "silence" or noise "speech".
const AUDIO = path.join(__dirname, '../../benchmark/speech/audio')
describe.runIf(existsSync(AUDIO))('audio activity on benchmark WAV files (synthetic TTS)', () => {
  it('every TTS clip (also mixed with noise or music) is speech-like', () => {
    const dirs = ['synthetic-en/tts', 'synthetic-en/mixed']
    const files = dirs.flatMap((d) => readdirSync(path.join(AUDIO, d)).filter((f) => f.endsWith('.wav')).map((f) => path.join(AUDIO, d, f)))
    expect(files.length).toBeGreaterThan(40)
    const wrong = files.filter((f) => {
      const { samples, sampleRate } = readWav(f)
      const a = analyzeActivity(samples, sampleRate)
      return describeRange(a, 0, a.durationMs).kind !== 'speech-like'
    })
    expect(wrong.map((f) => path.basename(f))).toEqual([])
  })

  it('controls without speech are not speech-like', () => {
    const kinds = Object.fromEntries(
      ['silence-10s', 'noise-10s', 'music-10s'].map((name) => {
        const { samples, sampleRate } = readWav(path.join(AUDIO, 'controls', `${name}.wav`))
        const a = analyzeActivity(samples, sampleRate)
        return [name, describeRange(a, 0, a.durationMs).kind]
      }),
    )
    expect(kinds).toEqual({ 'silence-10s': 'silence', 'noise-10s': 'steady', 'music-10s': 'varying' })
  })
})

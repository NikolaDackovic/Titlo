/**
 * Integration tests of the transcription engine (BrowserWhisperEngine) with a FAKE worker and
 * fake audio decoding. They test the engine's control flow — language handling, detection,
 * cancellation, errors, segment building — not recognition quality. Real Whisper runs are in
 * benchmark/speech (see benchmark/speech/README.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const decoded: { samples: Float32Array<ArrayBufferLike>; durationMs: number } = { samples: new Float32Array(0), durationMs: 0 }
vi.mock('./audio', async (importOriginal) => {
  const real = await importOriginal<typeof import('./audio')>()
  return {
    ...real,
    decodeToMono16k: vi.fn(async (file: File) => {
      if (file.name.endsWith('.broken')) throw new real.MediaDecodeError('The browser could not decode the audio track of this file')
      return decoded
    }),
  }
})

import { BrowserWhisperEngine, LanguageNotDetected, TranscriptionCancelled } from './browserWhisper'

type Msg = { type: 'load' | 'detect' | 'transcribe'; requestId: number; modelId: string; audio?: Float32Array; language?: string; offsetSec?: number }
type Reply = (msg: Msg) => Record<string, unknown> | 'hang' | 'crash'

class FakeWorker {
  static instances: FakeWorker[] = []
  static reply: Reply = () => ({})
  messages: Msg[] = []
  terminated = false
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(msg: Msg) {
    this.messages.push({ ...msg, audio: msg.audio ? new Float32Array(msg.audio.length) : undefined })
    const r = msg.type === 'load' ? {} : FakeWorker.reply(msg)
    if (r === 'hang') return
    queueMicrotask(() => {
      if (r === 'crash') this.onerror?.({ message: 'Out of memory' })
      else this.onmessage?.({ data: { type: 'result', requestId: msg.requestId, ...r } })
    })
  }
  terminate() {
    this.terminated = true
  }
}

const SR = 16000
const speech = (sec: number) => Float32Array.from({ length: sec * SR }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 180 * i) / SR))
const setAudio = (samples: Float32Array) => {
  decoded.samples = samples
  decoded.durationMs = Math.round((samples.length / SR) * 1000)
}
const files = { exists: vi.fn(async (_path: string) => true) }
const file = (name = 'clip.wav') => new File([new Uint8Array(4)], name)
const worker = () => FakeWorker.instances.at(-1)!
const sent = (type: Msg['type']) => worker().messages.filter((m) => m.type === type)
const run = (engine: BrowserWhisperEngine, language: 'auto' | 'en' | 'sr' | 'hr' | 'bs', signal = new AbortController().signal) =>
  engine.transcribe(file(), { modelId: 'onnx-community/whisper-small', language }, signal, () => {})
const detection = (languages: Record<string, number>, noSpeechProb = 0.02) => ({ detection: { languages, noSpeechProb } })

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  files.exists.mockResolvedValue(true)
})
afterEach(() => vi.unstubAllGlobals())

describe('explicit language', () => {
  it('passes the chosen language to Whisper and never runs detection', async () => {
    setAudio(speech(5))
    FakeWorker.reply = () => ({ chunks: [{ start: 0.5, end: 2.5, text: ' Dobro jutro.' }] })
    const r = await run(new BrowserWhisperEngine(files), 'sr')
    expect(sent('detect')).toHaveLength(0)
    expect(sent('transcribe')[0].language).toBe('serbian')
    expect(r).toMatchObject({ language: 'sr', detection: null, modelId: 'onnx-community/whisper-small' })
    expect(r.segments).toEqual([{ start: 500, end: 2500, text: 'Dobro jutro.' }])
  })

  it.each([['en', 'english'], ['hr', 'croatian'], ['bs', 'bosnian']] as const)('%s → Whisper "%s"', async (lang, whisper) => {
    setAudio(speech(3))
    FakeWorker.reply = () => ({ chunks: [] })
    await run(new BrowserWhisperEngine(files), lang)
    expect(sent('transcribe')[0].language).toBe(whisper)
  })
})

describe('automatic detection', () => {
  it('detects English and transcribes with it (no silent English default)', async () => {
    setAudio(speech(8))
    FakeWorker.reply = (m) => (m.type === 'detect' ? detection({ en: 0.97, de: 0.03 }) : { chunks: [{ start: 0, end: 2, text: 'Hello there.' }] })
    const r = await run(new BrowserWhisperEngine(files), 'auto')
    expect(sent('detect')).toHaveLength(1)
    expect(sent('transcribe')[0].language).toBe('english')
    expect(r.language).toBe('en')
    expect(r.detection).toMatchObject({ status: 'detected', language: 'en' })
  })

  it('detects the Serbian/Croatian/Bosnian group and transcribes with the closest variant', async () => {
    setAudio(speech(8))
    FakeWorker.reply = (m) => (m.type === 'detect' ? detection({ hr: 0.5, sr: 0.3, bs: 0.15, sl: 0.05 }) : { chunks: [] })
    const r = await run(new BrowserWhisperEngine(files), 'auto')
    expect(sent('transcribe')[0].language).toBe('croatian')
    expect(r.detection).toMatchObject({ status: 'detected', variantIsHint: true })
  })

  it("uses the project's own variant when the sr/hr/bs group is detected", async () => {
    setAudio(speech(8))
    // Whisper typically leans to "hr" for Serbian speech; a Serbian project must stay Serbian.
    FakeWorker.reply = (m) => (m.type === 'detect' ? detection({ hr: 0.56, bs: 0.23, sr: 0.09, sl: 0.09 }) : { chunks: [] })
    const r = await new BrowserWhisperEngine(files).transcribe(file(), { modelId: 'm', language: 'auto', shVariant: 'sr' }, new AbortController().signal, () => {})
    expect(sent('transcribe')[0].language).toBe('serbian')
    expect(r.language).toBe('sr')
  })

  it('an English project does not override detected English', async () => {
    setAudio(speech(8))
    FakeWorker.reply = (m) => (m.type === 'detect' ? detection({ en: 0.99 }) : { chunks: [] })
    const r = await new BrowserWhisperEngine(files).transcribe(file(), { modelId: 'm', language: 'auto', shVariant: 'sr' }, new AbortController().signal, () => {})
    expect(r.language).toBe('en')
  })

  it('stops before transcribing when the language is not supported', async () => {
    setAudio(speech(8))
    FakeWorker.reply = (m) => (m.type === 'detect' ? detection({ ru: 0.85, sr: 0.1, en: 0.05 }) : { chunks: [] })
    const error = await run(new BrowserWhisperEngine(files), 'auto').catch((e) => e)
    expect(error).toBeInstanceOf(LanguageNotDetected)
    expect(error.detection).toMatchObject({ status: 'uncertain', reason: 'unsupported-language' })
    expect(sent('transcribe')).toHaveLength(0)
  })

  it('stops on unclear audio (low probability)', async () => {
    setAudio(speech(8))
    FakeWorker.reply = (m) => (m.type === 'detect' ? detection({ en: 0.4, sr: 0.3, de: 0.3 }) : { chunks: [] })
    const error = await run(new BrowserWhisperEngine(files), 'auto').catch((e) => e)
    expect(error.detection.reason).toBe('low-probability')
  })

  it('stops on very short audio', async () => {
    setAudio(speech(1))
    FakeWorker.reply = (m) => (m.type === 'detect' ? detection({ en: 0.99 }) : { chunks: [] })
    const error = await run(new BrowserWhisperEngine(files), 'auto').catch((e) => e)
    expect(error.detection.reason).toBe('too-short')
  })

  it('silence: reports no speech without asking the model', async () => {
    setAudio(new Float32Array(10 * SR))
    FakeWorker.reply = () => ({ chunks: [] })
    const error = await run(new BrowserWhisperEngine(files), 'auto').catch((e) => e)
    expect(error).toBeInstanceOf(LanguageNotDetected)
    expect(error.detection).toMatchObject({ status: 'no-speech', reason: 'silence' })
    expect(sent('detect')).toHaveLength(0)
  })

  it('music/noise: reports no speech when the model hears none', async () => {
    setAudio(speech(10))
    FakeWorker.reply = (m) => (m.type === 'detect' ? detection({ en: 0.6, sr: 0.4 }, 0.9) : { chunks: [] })
    const error = await run(new BrowserWhisperEngine(files), 'auto').catch((e) => e)
    expect(error.detection.reason).toBe('model-no-speech')
  })

  it('detectLanguage() alone never transcribes', async () => {
    setAudio(speech(8))
    FakeWorker.reply = () => detection({ en: 0.9, sr: 0.1 })
    const d = await new BrowserWhisperEngine(files).detectLanguage(file(), 'onnx-community/whisper-base', new AbortController().signal)
    expect(d.language).toBe('en')
    expect(sent('transcribe')).toHaveLength(0)
  })
})

describe('segments and timing', () => {
  it('keeps timestamps across blocks of a long recording', async () => {
    setAudio(speech(250)) // > 90 s × 1.2 → several blocks
    FakeWorker.reply = (m) => ({ chunks: [{ start: (m.offsetSec ?? 0) + 1, end: (m.offsetSec ?? 0) + 3, text: `Block at ${Math.round(m.offsetSec ?? 0)}.` }] })
    const r = await run(new BrowserWhisperEngine(files), 'en')
    const blocks = sent('transcribe')
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    expect(blocks[0].offsetSec).toBe(0)
    expect(r.segments).toHaveLength(blocks.length)
    r.segments.forEach((s, i) => expect(s.start).toBe(Math.round(((blocks[i].offsetSec ?? 0) + 1) * 1000)))
  })

  it('keeps Serbian in Latin script and preserves diacritics', async () => {
    setAudio(speech(4))
    FakeWorker.reply = () => ({ chunks: [{ start: 0, end: 3, text: 'Ћао, ђаче! Čuješ li me?' }] })
    const r = await run(new BrowserWhisperEngine(files), 'sr')
    expect(r.segments[0].text.replace(/\n/g, ' ')).toBe('Ćao, đače! Čuješ li me?')
  })

  it('an empty result gives no segments (not an error)', async () => {
    setAudio(speech(4))
    FakeWorker.reply = () => ({ chunks: [] })
    expect((await run(new BrowserWhisperEngine(files), 'en')).segments).toEqual([])
  })
})

describe('failures', () => {
  it('cancel stops the worker immediately', async () => {
    setAudio(speech(4))
    FakeWorker.reply = () => 'hang'
    const controller = new AbortController()
    const promise = run(new BrowserWhisperEngine(files), 'en', controller.signal)
    await vi.waitFor(() => expect(sent('transcribe')).toHaveLength(1))
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(TranscriptionCancelled)
    expect(worker().terminated).toBe(true)
  })

  it('a worker crash rejects with its message', async () => {
    setAudio(speech(4))
    FakeWorker.reply = () => 'crash'
    await expect(run(new BrowserWhisperEngine(files), 'en')).rejects.toThrow('Out of memory')
  })

  it('a worker error message is passed through', async () => {
    setAudio(speech(4))
    FakeWorker.reply = () => 'hang'
    const p = run(new BrowserWhisperEngine(files), 'en')
    await vi.waitFor(() => expect(sent('transcribe')).toHaveLength(1))
    worker().onmessage?.({ data: { type: 'error', requestId: sent('transcribe')[0].requestId, message: 'Protobuf parsing failed (damaged model file)' } })
    await expect(p).rejects.toThrow('Protobuf parsing failed')
  })

  it('an undecodable file fails with a clear error before any model work', async () => {
    const error = await new BrowserWhisperEngine(files).transcribe(file('movie.broken'), { modelId: 'm', language: 'en' }, new AbortController().signal, () => {}).catch((e) => e)
    expect(error.name).toBe('MediaDecodeError')
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('a missing model is reported with the missing files', async () => {
    files.exists.mockImplementation(async (p: string) => !p.endsWith('decoder_model_merged_quantized.onnx'))
    const r = await new BrowserWhisperEngine(files).checkModel('onnx-community/whisper-small')
    expect(r.available).toBe(false)
    expect(r.details).toEqual(['Missing: models/onnx-community/whisper-small/onnx/decoder_model_merged_quantized.onnx'])
  })
})

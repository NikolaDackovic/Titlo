import { transcriptionModelStatus, type ModelPhase } from '../services/modelStatus'
import type { ModelFileCheck } from '../translation/providers/opusMt'
import type { ProviderAvailability } from '../translation/types'
import { computePeaks, decodeToMono16k } from './audio'
import { analyzeActivity } from './audioActivity'
import { decideLanguage, pickDetectionWindows, type LanguageDetection, type WindowDetection } from './languageDetection'
import { chunksToSegments, planBlocks, SAMPLE_RATE, WHISPER_LANGUAGE, type WhisperChunk } from './transcription'
import type { TranscriptionEngine, TranscriptionOptions, TranscriptionProgress, TranscriptionResult } from './types'
import { t as L } from '../i18n'

const REQUIRED_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
]

/** "Detect automatically" could not decide; the user has to pick the language. */
export class LanguageNotDetected extends Error {
  constructor(readonly detection: LanguageDetection) {
    super(detection.status === 'no-speech' ? 'No speech found for language detection' : 'Spoken language could not be determined reliably')
    this.name = 'LanguageNotDetected'
  }
}

type WorkerReply = { chunks?: WhisperChunk[]; detection?: Omit<WindowDetection, 'activeFraction'> }

export class TranscriptionCancelled extends Error {
  constructor() {
    super('Transcription cancelled')
    this.name = 'TranscriptionCancelled'
  }
}

/**
 * Local speech-to-text in the browser: Web Audio decoding + Whisper in a Web Worker.
 * Cancelling terminates the worker immediately (the model is reloaded next time).
 */
export class BrowserWhisperEngine implements TranscriptionEngine {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (reply: WorkerReply) => void; reject: (e: Error) => void }>()

  constructor(private readonly files: ModelFileCheck) {}

  async checkModel(modelId: string): Promise<ProviderAvailability> {
    const missing: string[] = []
    for (const f of REQUIRED_FILES) if (!(await this.files.exists(`${modelId}/${f}`))) missing.push(f)
    const result: ProviderAvailability = missing.length
      ? { available: false, message: L('Speech-to-text model is not installed.'), details: missing.map((m) => `Missing: models/${modelId}/${m}`) }
      : { available: true, message: L('Found {modelId}.', { modelId }) }
    transcriptionModelStatus.reportAvailability(modelId, result.available, result.message)
    return result
  }

  async warmUp(modelId: string): Promise<void> {
    await this.call({ type: 'load', modelId }, [], new AbortController().signal)
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as WorkerReply & { type: string; requestId?: number; message?: string; phase?: ModelPhase; modelId?: string; loadMs?: number }
      if (data.type === 'status') {
        if (data.phase) transcriptionModelStatus.set({ phase: data.phase, modelId: data.modelId ?? null, message: data.message ?? '', loadMs: data.loadMs })
        return
      }
      const entry = data.requestId !== undefined ? this.pending.get(data.requestId) : undefined
      if (!entry) return
      this.pending.delete(data.requestId!)
      if (data.type === 'result') entry.resolve(data)
      else entry.reject(new Error(data.message ?? 'Speech-to-text worker error'))
    }
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Speech-to-text worker crashed (often: not enough memory).')
      transcriptionModelStatus.set({ phase: 'error', modelId: null, message: error.message })
      this.rejectAll(error)
      this.terminate()
    }
    this.worker = worker
    return worker
  }

  private rejectAll(error: Error) {
    for (const entry of this.pending.values()) entry.reject(error)
    this.pending.clear()
  }

  private terminate() {
    this.worker?.terminate()
    this.worker = null
  }

  private call(message: Record<string, unknown>, transfer: Transferable[], signal: AbortSignal): Promise<WorkerReply> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new TranscriptionCancelled())
      const requestId = this.nextId++
      this.pending.set(requestId, { resolve, reject })
      const onAbort = () => {
        // Inference cannot be interrupted inside ONNX Runtime: stop the worker right away.
        this.rejectAll(new TranscriptionCancelled())
        this.terminate()
        transcriptionModelStatus.set({ phase: 'available', modelId: String(message.modelId), message: L('Unloaded after cancel.') })
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.ensureWorker().postMessage({ ...message, requestId }, transfer)
    })
  }

  /** Detect the language of decoded 16 kHz samples (model must be installed). */
  async detectFromSamples(samples: Float32Array, modelId: string, signal: AbortSignal): Promise<LanguageDetection> {
    const { windows, speechSeconds } = pickDetectionWindows(samples, SAMPLE_RATE)
    const results: WindowDetection[] = []
    for (const w of windows) {
      const audio = samples.slice(w.start, w.end)
      const reply = await this.call({ type: 'detect', modelId, audio }, [audio.buffer], signal)
      if (reply.detection) results.push({ ...reply.detection, activeFraction: w.activeFraction })
    }
    return decideLanguage(results, speechSeconds)
  }

  async detectLanguage(file: File, modelId: string, signal: AbortSignal): Promise<LanguageDetection> {
    const { samples } = await decodeToMono16k(file)
    if (signal.aborted) throw new TranscriptionCancelled()
    return this.detectFromSamples(samples, modelId, signal)
  }

  async transcribe(file: File, options: TranscriptionOptions, signal: AbortSignal, onProgress: (p: TranscriptionProgress) => void): Promise<TranscriptionResult> {
    const started = performance.now()
    onProgress({ stage: 'decoding', done: 0, total: 0, audioDoneMs: 0, audioTotalMs: 0 })
    const { samples, durationMs } = await decodeToMono16k(file)
    if (signal.aborted) throw new TranscriptionCancelled()
    const peaks = computePeaks(samples, Math.min(4000, Math.max(200, Math.round(durationMs / 50))))
    const activity = analyzeActivity(samples, SAMPLE_RATE)

    onProgress({ stage: 'loading', done: 0, total: 0, audioDoneMs: 0, audioTotalMs: durationMs })
    await this.call({ type: 'load', modelId: options.modelId }, [], signal)

    // Never let Whisper guess: without a language Transformers.js silently uses English.
    let detection: LanguageDetection | null = null
    let spoken = options.language
    if (spoken === 'auto') {
      onProgress({ stage: 'detecting', done: 0, total: 0, audioDoneMs: 0, audioTotalMs: durationMs })
      detection = await this.detectFromSamples(samples, options.modelId, signal)
      if (detection.status !== 'detected' || !detection.language) throw new LanguageNotDetected(detection)
      spoken = detection.variantIsHint && options.shVariant && options.shVariant !== 'en' ? options.shVariant : detection.language
    }

    const blocks = planBlocks(samples)
    const language = WHISPER_LANGUAGE[spoken]
    const chunks: WhisperChunk[] = []
    for (let i = 0; i < blocks.length; i += 1) {
      onProgress({ stage: 'transcribing', done: i, total: blocks.length, audioDoneMs: Math.round((blocks[i].start / SAMPLE_RATE) * 1000), audioTotalMs: durationMs })
      const audio = samples.slice(blocks[i].start, blocks[i].end)
      const { chunks: out = [] } = await this.call({ type: 'transcribe', modelId: options.modelId, audio, language, offsetSec: blocks[i].start / SAMPLE_RATE }, [audio.buffer], signal)
      // Clamp chunk ends to the block (Whisper can leave the last end open).
      const blockEnd = blocks[i].end / SAMPLE_RATE
      chunks.push(...out.map((c) => ({ ...c, end: c.end === null ? null : Math.min(c.end, blockEnd) })))
    }
    onProgress({ stage: 'transcribing', done: blocks.length, total: blocks.length, audioDoneMs: durationMs, audioTotalMs: durationMs })

    return {
      segments: chunksToSegments(chunks, { durationMs, language: spoken }),
      durationMs,
      peaks,
      activity,
      elapsedMs: Math.round(performance.now() - started),
      modelId: options.modelId,
      language: spoken,
      detection,
    }
  }
}

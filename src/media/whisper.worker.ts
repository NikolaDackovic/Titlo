/// <reference lib="webworker" />
/**
 * Whisper speech-to-text worker (Transformers.js, ONNX Runtime WASM). Runs off the UI thread.
 * Remote downloads are disabled: models are read from the local /models/ folder only.
 */
import { env, pipeline, Tensor } from '@huggingface/transformers'
import { softmaxSubset, tokenProbability } from './languageDetection'
import { WHISPER_DECODE_OPTIONS, WHISPER_RUNTIME } from './whisperConfig'

interface Msg {
  type: 'load' | 'transcribe' | 'detect'
  requestId: number
  modelId: string
  audio?: Float32Array
  language?: string
  offsetSec?: number
}

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: Array<{ timestamp: [number, number | null]; text: string }> }>

interface WhisperParts {
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>
  model: ((inputs: Record<string, unknown>) => Promise<{ logits: { data: Float32Array; dims: number[] } }>) & {
    generation_config: { decoder_start_token_id: number; lang_to_id: Record<string, number> }
  }
}

/**
 * One decoder step after <|startoftranscript|> on a ≤30 s window (what OpenAI Whisper does to
 * detect the language). Returns the softmax over language tokens and the no-speech probability.
 */
async function detectLanguage(run: Transcriber, audio: Float32Array) {
  const { processor, model } = run as unknown as WhisperParts
  const config = model.generation_config
  const { input_features } = await processor(audio)
  const sot = config.decoder_start_token_id
  const out = await model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]) })
  const vocab = out.logits.dims.at(-1)!
  const logits = out.logits.data.subarray(out.logits.data.length - vocab)
  const entries = Object.entries(config.lang_to_id)
  const probs = softmaxSubset(logits, entries.map(([, id]) => id))
  const languages: Record<string, number> = {}
  entries.forEach(([token], i) => (languages[token.slice(2, -2)] = probs[i]))
  const [noSpeechId] = (run as unknown as { tokenizer: { convert_tokens_to_ids: (t: string[]) => Array<number | undefined> } }).tokenizer.convert_tokens_to_ids(['<|nocaptions|>'])
  // A missing token must not look like "certainly speech": report NaN and let the caller ignore it.
  return { languages, noSpeechProb: noSpeechId === undefined || noSpeechId === null ? Number.NaN : tokenProbability(logits, noSpeechId) }
}

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '/models/'
env.useBrowserCache = false

let loaded: { modelId: string; run: Transcriber } | null = null

async function getTranscriber(modelId: string): Promise<Transcriber> {
  if (loaded?.modelId === modelId) return loaded.run
  if (loaded) {
    await (loaded.run as unknown as { dispose?: () => Promise<void> }).dispose?.()
    loaded = null
  }
  self.postMessage({ type: 'status', phase: 'loading', modelId, message: `Loading ${modelId}…` })
  const started = performance.now()
  try {
    const run = (await pipeline('automatic-speech-recognition', modelId, { ...WHISPER_RUNTIME, local_files_only: true })) as unknown as Transcriber
    loaded = { modelId, run }
    const loadMs = Math.round(performance.now() - started)
    self.postMessage({ type: 'status', phase: 'ready', modelId, message: `Loaded in ${(loadMs / 1000).toFixed(1)} s`, loadMs })
    return run
  } catch (error) {
    self.postMessage({ type: 'status', phase: 'error', modelId, message: `Could not load the model: ${(error as Error)?.message ?? String(error)}` })
    throw error
  }
}

self.onmessage = async (event: MessageEvent<Msg>) => {
  const msg = event.data
  try {
    const run = await getTranscriber(msg.modelId)
    if (msg.type === 'load') {
      self.postMessage({ type: 'result', requestId: msg.requestId, chunks: [] })
      return
    }
    if (msg.type === 'detect') {
      self.postMessage({ type: 'result', requestId: msg.requestId, detection: await detectLanguage(run, msg.audio!) })
      return
    }
    const output = await run(msg.audio!, {
      ...WHISPER_DECODE_OPTIONS,
      ...(msg.language ? { language: msg.language } : {}),
    })
    const offset = msg.offsetSec ?? 0
    const chunks = (output.chunks ?? [{ timestamp: [0, null] as [number, number | null], text: output.text }]).map((c) => ({
      start: (c.timestamp[0] ?? 0) + offset,
      end: c.timestamp[1] === null || c.timestamp[1] === undefined ? null : c.timestamp[1] + offset,
      text: c.text,
    }))
    self.postMessage({ type: 'result', requestId: msg.requestId, chunks })
  } catch (error) {
    self.postMessage({ type: 'error', requestId: msg.requestId, message: (error as Error)?.message ?? String(error) })
  }
}

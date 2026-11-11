/// <reference lib="webworker" />
/**
 * Web Worker that runs Marian (OPUS-MT) models with Transformers.js.
 * Runs off the UI thread so the editor stays responsive during translation.
 * Remote model downloads are disabled: only files from /models/ are used.
 * Status messages report real loading progress (loading → ready / error).
 */
import { cat, env, pipeline } from '@huggingface/transformers'
import { noKvCache, patchNoKvCache } from './opusModels'

type TranslateFn = (texts: string[], options?: Record<string, unknown>) => Promise<Array<{ translation_text: string }>>

interface LoadMessage {
  type: 'load' | 'translate'
  requestId: number
  modelId: string
  texts?: string[]
  device: 'wasm' | 'webgpu' | 'cpu'
  dtype: 'q8' | 'fp32' | 'fp16'
  numBeams: number
}

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '/models/'
env.useBrowserCache = false

let loaded: { key: string; translator: TranslateFn } | null = null
let loading: { key: string; promise: Promise<TranslateFn> } | null = null

async function getTranslator(msg: LoadMessage): Promise<TranslateFn> {
  const key = `${msg.modelId}|${msg.device}|${msg.dtype}`
  if (loaded?.key === key) return loaded.translator
  if (loading?.key === key) return loading.promise
  // A different configuration is loading: wait for it, then load the requested one.
  if (loading) await loading.promise.catch(() => undefined)
  if (loaded?.key === key) return loaded.translator
  if (loaded) {
    // Free the previous ONNX sessions before loading another model/precision.
    await (loaded.translator as unknown as { dispose?: () => Promise<void> }).dispose?.()
    loaded = null
  }
  self.postMessage({ type: 'status', phase: 'loading', modelId: msg.modelId, message: `Loading ${msg.modelId} (${msg.dtype}, ${msg.device === 'cpu' ? 'wasm' : msg.device})…` })
  const started = performance.now()
  const promise = (async () => {
    try {
      const translator = (await pipeline('translation', msg.modelId, {
        device: msg.device === 'cpu' ? 'wasm' : msg.device,
        dtype: msg.dtype,
        local_files_only: true,
      })) as unknown as TranslateFn
      if (noKvCache(msg.modelId)) patchNoKvCache((translator as unknown as { model: unknown }).model, cat as never)
      loaded = { key, translator }
      const loadMs = Math.round(performance.now() - started)
      self.postMessage({ type: 'status', phase: 'ready', modelId: msg.modelId, message: `Loaded in ${(loadMs / 1000).toFixed(1)} s`, loadMs })
      return translator
    } catch (error) {
      self.postMessage({ type: 'status', phase: 'error', modelId: msg.modelId, message: `Could not load the model: ${(error as Error)?.message ?? String(error)}` })
      throw error
    } finally {
      if (loading?.key === key) loading = null
    }
  })()
  loading = { key, promise }
  return promise
}

self.onmessage = async (event: MessageEvent<LoadMessage>) => {
  const msg = event.data
  try {
    const translator = await getTranslator(msg)
    if (msg.type === 'load') {
      self.postMessage({ type: 'result', requestId: msg.requestId, texts: [] })
      return
    }
    const output = await translator(msg.texts ?? [], { num_beams: msg.numBeams, max_new_tokens: 256 })
    self.postMessage({ type: 'result', requestId: msg.requestId, texts: output.map((o) => o.translation_text) })
  } catch (error) {
    self.postMessage({ type: 'error', requestId: msg.requestId, message: (error as Error)?.message ?? String(error) })
  }
}

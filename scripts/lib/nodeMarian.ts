/**
 * Node runtime for Marian/OPUS-MT models (Transformers.js + onnxruntime-node, CPU).
 * Shared by the smoke test, the real-model test and the benchmark so all three measure
 * exactly the same code path as the app's OpusMtProvider.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveModelsDir } from '../../build/modelsDir'
import { noKvCache, patchNoKvCache, OPUS_MODEL_ID, OpusMtProvider, type MarianRuntime, type MarianRuntimeOptions } from '../../src/translation/providers/opusMt'

type Translator = (texts: string[], o?: Record<string, unknown>) => Promise<Array<{ translation_text: string }>>

export interface NodeRuntimeStats {
  loadMs: number | null
  loads: number
}

export function createNodeMarianRuntime(modelsDir = resolveModelsDir()): MarianRuntime & { stats: NodeRuntimeStats; versions: () => Promise<Record<string, string>> } {
  let translator: Translator | null = null
  let loadedKey = ''
  const stats: NodeRuntimeStats = { loadMs: null, loads: 0 }
  return {
    stats,
    async translate(modelId, texts, options: MarianRuntimeOptions, signal) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const key = `${modelId}|${options.dtype}`
      if (!translator || loadedKey !== key) {
        const { env, pipeline, cat } = await import('@huggingface/transformers')
        env.allowRemoteModels = false
        env.allowLocalModels = true
        env.localModelPath = modelsDir + path.sep
        const started = performance.now()
        translator = (await pipeline('translation', modelId, { dtype: options.dtype, device: 'cpu', local_files_only: true })) as unknown as Translator
        if (noKvCache(modelId)) patchNoKvCache((translator as unknown as { model: unknown }).model, cat as never)
        stats.loadMs = performance.now() - started
        stats.loads += 1
        loadedKey = key
      }
      const out = await translator(texts, { num_beams: options.numBeams, max_new_tokens: 256 })
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      return out.map((o) => o.translation_text)
    },
    dispose() {
      translator = null
    },
    async versions() {
      const read = (p: string) => {
        try {
          return (JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version
        } catch {
          return 'unknown'
        }
      }
      return {
        node: process.version,
        transformersJs: read(path.resolve('node_modules/@huggingface/transformers/package.json')),
        onnxruntimeNode: read(path.resolve('node_modules/onnxruntime-node/package.json')),
      }
    },
  }
}

export function createNodeOpusProvider(options: Partial<MarianRuntimeOptions> = {}, modelsDir = resolveModelsDir()) {
  const runtime = createNodeMarianRuntime(modelsDir)
  const provider = new OpusMtProvider(
    runtime,
    { exists: async (rel) => existsSync(path.join(modelsDir, rel)) },
    { device: 'cpu', dtype: 'q8', numBeams: 4, ...options },
    OPUS_MODEL_ID,
  )
  return { provider, runtime, modelsDir }
}

/** Samples process memory/CPU while work runs. RSS includes native ONNX Runtime memory. */
export function startResourceSampler(intervalMs = 200) {
  let peakRss = process.memoryUsage().rss
  const startCpu = process.cpuUsage()
  const startWall = performance.now()
  const timer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }, intervalMs)
  return {
    stop() {
      clearInterval(timer)
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
      const cpu = process.cpuUsage(startCpu)
      const wallMs = performance.now() - startWall
      return {
        peakRssMb: peakRss / 1024 / 1024,
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
        wallMs,
        /** Average number of CPU cores busy (1.0 = one core fully used). */
        avgCoresBusy: (cpu.user + cpu.system) / 1000 / wallMs,
      }
    },
  }
}

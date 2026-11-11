import { setModelStatus, type ModelPhase } from '../../services/modelStatus'
import type { MarianRuntime, MarianRuntimeOptions, ModelFileCheck } from './opusMt'

/** Browser runtime: delegates inference to a dedicated Web Worker. */
export class WorkerMarianRuntime implements MarianRuntime {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (t: string[]) => void; reject: (e: Error) => void }>()

  constructor(private readonly onStatus?: (message: string) => void) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./marian.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; requestId?: number; texts?: string[]; message?: string; phase?: ModelPhase; modelId?: string; loadMs?: number }
      if (data.type === 'status') {
        this.onStatus?.(data.message ?? '')
        if (data.phase) setModelStatus({ phase: data.phase, modelId: data.modelId ?? null, message: data.message ?? '', loadMs: data.loadMs })
        return
      }
      const entry = data.requestId !== undefined ? this.pending.get(data.requestId) : undefined
      if (!entry) return
      this.pending.delete(data.requestId!)
      if (data.type === 'result') entry.resolve(data.texts ?? [])
      else entry.reject(new Error(data.message ?? 'Worker error'))
    }
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Translation worker crashed')
      setModelStatus({ phase: 'error', modelId: null, message: `Translation worker crashed: ${error.message}. Low memory is the most common cause.` })
      for (const entry of this.pending.values()) entry.reject(error)
      this.pending.clear()
      this.worker?.terminate()
      this.worker = null
    }
    this.worker = worker
    return worker
  }

  /** Load the model without translating (warm-up). */
  load(modelId: string, options: MarianRuntimeOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestId = this.nextId++
      this.pending.set(requestId, { resolve: () => resolve(), reject })
      this.ensureWorker().postMessage({ type: 'load', requestId, modelId, ...options })
    })
  }

  translate(modelId: string, texts: string[], options: MarianRuntimeOptions, signal: AbortSignal): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
      const requestId = this.nextId++
      this.pending.set(requestId, { resolve, reject })
      // Inference inside ONNX Runtime cannot be interrupted; on cancel we stop waiting
      // and the job ends after the running batch.
      signal.addEventListener('abort', () => {
        if (this.pending.delete(requestId)) reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
      this.ensureWorker().postMessage({ type: 'translate', requestId, modelId, texts, ...options })
    })
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    for (const entry of this.pending.values()) entry.reject(new Error('Runtime disposed'))
    this.pending.clear()
  }
}

/** Checks model files served by the local /models/ endpoint (dev/preview server or desktop shell). */
export const httpModelFiles: ModelFileCheck = {
  async exists(relativePath: string) {
    try {
      const response = await fetch(`/models/${relativePath.split('/').map(encodeURIComponent).join('/')}`, { method: 'HEAD', cache: 'no-store' })
      return response.ok
    } catch {
      return false
    }
  },
}

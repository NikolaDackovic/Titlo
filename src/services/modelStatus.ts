import { useSyncExternalStore } from 'react'
import { t as L } from '../i18n'

/**
 * Status of local models as reported by the runtime (never guessed).
 * - unknown: not checked yet
 * - not-installed: required files missing
 * - available: files present, not loaded
 * - loading / ready / error: reported by the inference worker
 *
 * Two independent stores: the translation model (OPUS-MT) and the speech-to-text model (Whisper).
 */
export type ModelPhase = 'unknown' | 'not-installed' | 'available' | 'loading' | 'ready' | 'error'

export interface ModelStatus {
  phase: ModelPhase
  modelId: string | null
  message: string
  loadMs?: number
  updatedAt: number
}

/** Worker messages are produced outside the UI thread (no locale there); localise the known ones. */
export function localizeWorkerMessage(message: string): string {
  let m: RegExpMatchArray | null
  if ((m = message.match(/^Loading (.+)…$/))) return L('Loading {model}…', { model: m[1] })
  if ((m = message.match(/^Loaded in ([\d.]+) s$/))) return L('Loaded in {s} s', { s: m[1] })
  if ((m = message.match(/^Could not load the model: (.*)$/s))) return L('Could not load the model: {error}', { error: m[1] })
  return message
}

function createStatusStore() {
  let status: ModelStatus = { phase: 'unknown', modelId: null, message: '', updatedAt: Date.now() }
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const get = () => status
  return {
    get,
    set(patch: Omit<ModelStatus, 'updatedAt'>) {
      status = { ...patch, message: localizeWorkerMessage(patch.message), updatedAt: Date.now() }
      listeners.forEach((l) => l())
    },
    /** Record a file check without downgrading a model that is loaded or loading. */
    reportAvailability(modelId: string, available: boolean, message: string) {
      if (available && status.modelId === modelId && (status.phase === 'ready' || status.phase === 'loading')) return
      this.set({ phase: available ? 'available' : 'not-installed', modelId, message })
    },
    useStatus: () => useSyncExternalStore(subscribe, get),
  }
}

export const translationModelStatus = createStatusStore()
export const transcriptionModelStatus = createStatusStore()

// Translation-model API (kept for existing callers).
export const setModelStatus = (patch: Omit<ModelStatus, 'updatedAt'>) => translationModelStatus.set(patch)
export const getModelStatus = () => translationModelStatus.get()
export const useModelStatus = () => translationModelStatus.useStatus()
export const reportAvailability = (modelId: string, available: boolean, message: string) => translationModelStatus.reportAvailability(modelId, available, message)

export const MODEL_PHASE_LABEL: Record<ModelPhase, string> = {
  unknown: 'Not checked',
  'not-installed': 'Model not installed',
  available: 'Model available (not loaded)',
  loading: 'Loading model…',
  ready: 'Model ready',
  error: 'Model error',
}

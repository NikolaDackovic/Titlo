import { FutureCloudTranslationProvider } from './providers/futureCloud'
import { DEFAULT_LLM_CONFIG, LocalLlmProvider, type LocalLlmConfig } from './providers/localLlm'
import { OPUS_MODEL_ID, OPUS_SH_EN_MODEL_ID, OpusMtProvider, type MarianRuntime, type MarianRuntimeOptions, type ModelFileCheck } from './providers/opusMt'
import { TestTranslationProvider } from './providers/testProvider'
import type { TranslationProvider } from './types'

export type ProviderId = 'opus-mt-en-sh' | 'local-llm' | 'test'

export interface TranslationSettings {
  providerId: ProviderId
  opusModelId: string
  /** Serbian/Croatian/Bosnian → English model. */
  opusShEnModelId: string
  opus: MarianRuntimeOptions
  llm: LocalLlmConfig
  contextSize: number
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  providerId: 'opus-mt-en-sh',
  opusModelId: OPUS_MODEL_ID,
  opusShEnModelId: OPUS_SH_EN_MODEL_ID,
  opus: { device: 'wasm', dtype: 'q8', numBeams: 4 },
  llm: DEFAULT_LLM_CONFIG,
  contextSize: 2,
}

export const PROVIDER_OPTIONS: Array<{ id: ProviderId; label: string; description: string }> = [
  { id: 'opus-mt-en-sh', label: 'OPUS-MT (local NMT)', description: 'Recommended. Local models: English → Serbian/Croatian/Bosnian and Serbian/Croatian/Bosnian → English.' },
  { id: 'local-llm', label: 'Local LLM server', description: 'Context-aware translation through llama.cpp / Ollama / LM Studio on this computer.' },
]

/** Development/test only — not offered in the app. */
export const TEST_PROVIDER_OPTION = { id: 'test' as ProviderId, label: 'TEST provider', description: 'No translation. Marks text with [TEST] to exercise the workflow.' }

export interface ProviderDeps {
  marianRuntime: () => MarianRuntime
  modelFiles: ModelFileCheck
  fetchImpl?: typeof fetch
}

export function createProvider(settings: TranslationSettings, deps: ProviderDeps): TranslationProvider {
  switch (settings.providerId) {
    case 'opus-mt-en-sh':
      return new OpusMtProvider(deps.marianRuntime(), deps.modelFiles, settings.opus, settings.opusModelId, settings.opusShEnModelId)
    case 'local-llm':
      return new LocalLlmProvider(settings.llm, deps.fetchImpl)
    case 'test':
      return new TestTranslationProvider()
  }
}

/** Listed for transparency in the Models screen; never selectable. */
export const plannedProviders = () => [new FutureCloudTranslationProvider()]

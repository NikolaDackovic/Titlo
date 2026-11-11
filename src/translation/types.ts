import type { ContentType } from '../domain/types'
import type { ProfileId, SourceLanguage, TargetLanguage, Variant, Yat } from '../domain/languages'

export type ProviderKind = 'local-nmt' | 'local-llm' | 'test' | 'cloud'

/** Target description handed to providers. Providers always produce Latin script. */
export interface TranslationTarget {
  profile: ProfileId
  language: TargetLanguage
  /** Lexical variant, or `null` for ExYu Neutral. */
  variant: Variant | null
  yat: Yat
  label: string
}

export interface TranslationItem {
  /** Opaque id; the provider must return exactly the same ids. */
  id: string
  /** Plain text (markup removed). May contain `\n`. */
  text: string
  /** Neighbouring source segments for context-aware providers (read-only context). */
  before: string[]
  after: string[]
}

export interface GlossaryHint {
  source: string
  /** Preferred rendering (Terminology). */
  target: string
  notes?: string
  /** Accepted, non-preferred renderings. */
  alternatives?: string[]
  wholeWord?: boolean
  caseSensitive?: boolean
}

export interface TranslationRequest {
  items: TranslationItem[]
  sourceLanguage: SourceLanguage
  target: TranslationTarget
  glossary: GlossaryHint[]
  contentType: ContentType
  signal: AbortSignal
}

export interface TranslationResultItem {
  id: string
  text: string
}

export interface ProviderAvailability {
  available: boolean
  message: string
  details?: string[]
}

export interface TranslationProvider {
  readonly id: string
  readonly label: string
  readonly kind: ProviderKind
  /** Test providers never produce real translations; output is flagged everywhere. */
  readonly isTest: boolean
  /** Whether neighbouring segments are used as context. */
  readonly usesContext: boolean
  readonly maxBatchItems: number
  readonly maxBatchChars: number
  /** Identifies model + settings for the translation cache. */
  cacheKey(): string
  supports(source: SourceLanguage, target: TranslationTarget): boolean
  /** `direction` lets multi-model providers check the model for a specific language pair. */
  checkAvailability(direction?: { sourceLanguage: SourceLanguage; target: TranslationTarget }): Promise<ProviderAvailability>
  translateBatch(request: TranslationRequest): Promise<TranslationResultItem[]>
  dispose?(): void
}

export class ProviderError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'ProviderError'
    this.retryable = retryable
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancelledError'
  }
}

export interface TranslationCache {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
}

export class MemoryTranslationCache implements TranslationCache {
  private map = new Map<string, string>()
  async get(key: string) {
    return this.map.get(key)
  }
  async set(key: string, value: string) {
    this.map.set(key, value)
  }
}

import type { ProviderAvailability, TranslationProvider, TranslationRequest, TranslationResultItem } from '../types'
import { t as L } from '../../i18n'

/**
 * TEST provider — for exercising the workflow (batching, progress, cancel, QC, export)
 * without a model. It does NOT translate: it returns the source text wrapped in a
 * visible marker. Output is stored with origin "test", flagged by QC as an error and
 * reported by the exporter.
 */
export class TestTranslationProvider implements TranslationProvider {
  readonly id = 'test'
  readonly label = 'TEST provider (no translation)'
  readonly kind = 'test' as const
  readonly isTest = true
  readonly usesContext = false
  readonly maxBatchItems = 25
  readonly maxBatchChars = 5000

  constructor(private readonly delayMs = 120) {}

  cacheKey() {
    return 'test'
  }

  supports() {
    return true
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    return { available: true, message: L('Always available. Produces marked placeholder text, not translations.') }
  }

  async translateBatch(request: TranslationRequest): Promise<TranslationResultItem[]> {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, this.delayMs)
      request.signal.addEventListener('abort', () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })
    const tag = `[TEST→${request.target.profile}]`
    return request.items.map((item) => ({ id: item.id, text: `${tag} ${item.text}` }))
  }
}

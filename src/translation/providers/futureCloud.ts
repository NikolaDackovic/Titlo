import { ProviderError, type ProviderAvailability, type TranslationProvider } from '../types'
import { t as L } from '../../i18n'

/**
 * Placeholder for an optional, explicitly opt-in cloud provider (Phase 5).
 * Not implemented in this version: it is always unavailable and cannot be selected,
 * so no subtitle text can leave the computer.
 */
export class FutureCloudTranslationProvider implements TranslationProvider {
  readonly id = 'cloud'
  readonly label = 'Cloud provider (planned, disabled)'
  readonly kind = 'cloud' as const
  readonly isTest = false
  readonly usesContext = true
  readonly maxBatchItems = 0
  readonly maxBatchChars = 0

  cacheKey() {
    return 'cloud-disabled'
  }

  supports() {
    return false
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    return { available: false, message: L('Cloud translation is not part of this version. All processing is local.') }
  }

  async translateBatch(): Promise<never> {
    throw new ProviderError('Cloud translation is not available in this version.', false)
  }
}

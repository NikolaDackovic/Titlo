import { sourceLanguageLabel } from '../../domain/languages'
import {
  ProviderError,
  type ProviderAvailability,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResultItem,
  type TranslationTarget,
} from '../types'
import { t as L } from '../../i18n'

/**
 * Local LLM provider for any OpenAI-compatible server running on THIS computer
 * (llama.cpp `llama-server`, Ollama, LM Studio…).
 *
 * Privacy guarantee: only loopback hosts (localhost / 127.0.0.0/8 / ::1) are accepted,
 * so subtitle text cannot be sent to a remote service by misconfiguration.
 *
 * Context-aware: each request contains neighbouring lines as context. The model must
 * answer with one translation per id; anything else is rejected and retried per segment.
 *
 * Quality depends entirely on the chosen model. No open LLM we checked documents
 * Serbian/Bosnian support explicitly (EuroLLM documents Croatian), so results must be
 * evaluated with the benchmark before relying on them.
 */

export interface LocalLlmConfig {
  baseUrl: string
  model: string
  temperature: number
  timeoutMs: number
}

export const DEFAULT_LLM_CONFIG: LocalLlmConfig = {
  baseUrl: 'http://127.0.0.1:8080',
  model: '',
  temperature: 0.2,
  timeoutMs: 120_000,
}

export function isLoopbackUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

const variantInstructions = (target: TranslationTarget): string => {
  const yat = target.yat === 'ijekavian' ? 'ijekavian (e.g. "mlijeko", "vrijeme", "gdje")' : 'ekavian (e.g. "mleko", "vreme", "gde")'
  switch (target.variant) {
    case 'sr':
      return `standard Serbian, ${yat}, Latin script only. Use Serbian vocabulary (voz, hleb, hiljada, istorija, šta, ko).`
    case 'hr':
      return `standard Croatian, ${yat}. Use Croatian vocabulary (vlak, kruh, tisuća, povijest, što, tko) and Croatian syntax (infinitive after modal verbs: "moram ići", not "moram da idem").`
    case 'bs':
      return `standard Bosnian, ${yat}, Latin script. Use Bosnian vocabulary (voz, hljeb, hiljada, historija, šta, ko, sedmica).`
    case null:
      return `a neutral variety of the Serbian-Croatian-Bosnian-Montenegrin language that reads naturally in Serbia, Croatia, Bosnia and Herzegovina and Montenegro. Use the ${yat} reflex consistently, Latin script. Prefer words used in all countries; when no common word exists, keep the most natural phrasing instead of inventing artificial words. Do not mix Serbian and Croatian forms of the same word.`
  }
}

export function buildMessages(request: TranslationRequest) {
  const glossary = request.glossary.length
    ? `\nMandatory terminology (use these renderings, inflected as needed):\n${request.glossary.map((g) => `- "${g.source}" → "${g.target}"${g.notes ? ` (${g.notes})` : ''}`).join('\n')}`
    : ''
  const system = [
    `You are a professional subtitle translator. Translate from ${sourceLanguageLabel(request.sourceLanguage)} into ${variantInstructions(request.target)}`,
    'Rules:',
    '- Translate every segment separately. Never merge, split, drop or reorder segments.',
    '- Context lines are for understanding only; do not translate them.',
    '- Keep the tone, register, humour and profanity level of the original. Do not censor or explain.',
    '- Subtitles must be short and easy to read; prefer natural spoken language over literal translation.',
    '- Keep names, numbers and line breaks ("\\n") where they make sense.',
    '- Answer ONLY with JSON: {"translations":[{"id":"<id>","text":"<translation>"}]} containing every id exactly once.',
    glossary,
  ].join('\n')

  const user = JSON.stringify({
    content_type: request.contentType,
    segments: request.items.map((item) => ({
      id: item.id,
      context_before: item.before,
      text: item.text,
      context_after: item.after,
    })),
  })
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** Extract and validate the JSON answer. Throws ProviderError (retryable) on any mismatch. */
export function parseLlmAnswer(content: string, ids: string[]): TranslationResultItem[] {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end <= start) throw new ProviderError('Model answer contained no JSON object.', true)
  let parsed: unknown
  try {
    parsed = JSON.parse(content.slice(start, end + 1))
  } catch {
    throw new ProviderError('Model answer was not valid JSON.', true)
  }
  const list = (parsed as { translations?: unknown }).translations
  if (!Array.isArray(list)) throw new ProviderError('Model answer has no "translations" array.', true)
  const out: TranslationResultItem[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    const id = String((entry as { id?: unknown }).id ?? '')
    const text = (entry as { text?: unknown }).text
    if (!ids.includes(id) || seen.has(id) || typeof text !== 'string' || !text.trim()) {
      throw new ProviderError('Model answer had unknown, duplicate or empty segments.', true)
    }
    seen.add(id)
    out.push({ id, text: text.replace(/\\n/g, '\n').trim() })
  }
  if (out.length !== ids.length) throw new ProviderError(`Model returned ${out.length} of ${ids.length} segments.`, true)
  return out
}

export class LocalLlmProvider implements TranslationProvider {
  readonly id = 'local-llm'
  readonly kind = 'local-llm' as const
  readonly isTest = false
  readonly usesContext = true
  readonly maxBatchItems = 8
  readonly maxBatchChars = 2400

  constructor(private readonly config: LocalLlmConfig, private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  get label() {
    return `Local LLM${this.config.model ? ` (${this.config.model})` : ''}`
  }

  cacheKey() {
    return `${this.id}:${this.config.model}:t${this.config.temperature}`
  }

  supports() {
    return true
  }

  private endpoint(path: string) {
    if (!isLoopbackUrl(this.config.baseUrl)) {
      throw new ProviderError('Only local servers (localhost / 127.0.0.1) are allowed. Remote endpoints are blocked for privacy.', false)
    }
    return `${this.config.baseUrl.replace(/\/+$/, '')}${path}`
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    if (!isLoopbackUrl(this.config.baseUrl)) {
      return { available: false, message: L('Blocked: the server address is not on this computer.'), details: ['Use http://127.0.0.1:<port> or http://localhost:<port>.'] }
    }
    if (!this.config.model.trim()) return { available: false, message: L('Enter the model name served by your local server.') }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 4000)
      const response = await this.fetchImpl(this.endpoint('/v1/models'), { signal: controller.signal })
      clearTimeout(timer)
      if (!response.ok) return { available: false, message: L('Server answered HTTP {status}.', { status: response.status }) }
      const data = (await response.json()) as { data?: Array<{ id: string }> }
      const models = (data.data ?? []).map((m) => m.id)
      if (models.length && !models.includes(this.config.model)) {
        return { available: false, message: L('Model "{model}" is not served.', { model: this.config.model }), details: [`Available: ${models.join(', ')}`] }
      }
      return { available: true, message: L('Connected to {baseUrl}.', { baseUrl: this.config.baseUrl }), details: models.length ? [`Models: ${models.join(', ')}`] : undefined }
    } catch (error) {
      return {
        available: false,
        message: L('No local server reachable at {baseUrl}.', { baseUrl: this.config.baseUrl }),
        details: [(error as Error).message, 'Start llama-server / Ollama / LM Studio and allow this app origin (CORS).'],
      }
    }
  }

  async translateBatch(request: TranslationRequest): Promise<TranslationResultItem[]> {
    // Markup-only segments have no text: answer them locally with an empty string and
    // never ask the model (it cannot return a valid non-empty translation for them).
    const empty = request.items.filter((i) => !i.text.trim())
    const items = request.items.filter((i) => i.text.trim())
    if (!items.length) return empty.map((i) => ({ id: i.id, text: '' }))
    const translated = await this.translateNonEmpty({ ...request, items })
    const byId = new Map(translated.map((r) => [r.id, r.text]))
    return request.items.map((i) => ({ id: i.id, text: byId.get(i.id) ?? '' }))
  }

  private async translateNonEmpty(request: TranslationRequest): Promise<TranslationResultItem[]> {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await this.fetchImpl(this.endpoint('/v1/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          temperature: this.config.temperature,
          stream: false,
          messages: buildMessages(request),
        }),
      })
      if (!response.ok) {
        throw new ProviderError(`Local server error HTTP ${response.status}`, response.status >= 500 || response.status === 429)
      }
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = data.choices?.[0]?.message?.content ?? ''
      return parseLlmAnswer(content, request.items.map((i) => i.id))
    } catch (error) {
      if (request.signal.aborted) throw error
      if (error instanceof ProviderError) throw error
      throw new ProviderError(controller.signal.aborted ? 'Local model timed out.' : `Local server unreachable: ${(error as Error).message}`, true)
    } finally {
      clearTimeout(timer)
      request.signal.removeEventListener('abort', onAbort)
    }
  }
}

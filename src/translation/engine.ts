import { getProfile, resolveYat, type ProfileId, type SourceLanguage, type Yat } from '../domain/languages'
import type { ContentType, Segment, TranslationOrigin, TranslationStatus } from '../domain/types'
import { applyMarkupShell, extractMarkupShell } from '../formats/markup'
import { latinToCyrillic } from '../localization/transliterate'
import { fnv1a64 } from './hash'
import { reflowSubtitle } from './linebreak'
import {
  CancelledError,
  ProviderError,
  type GlossaryHint,
  type TranslationCache,
  type TranslationItem,
  type TranslationProvider,
  type TranslationTarget,
} from './types'
import { t as L } from '../i18n'

/**
 * Translation job.
 *
 * - Works on a snapshot of segments and emits per-segment updates; it never edits
 *   project state directly (the editor decides whether an update may still be applied).
 * - Locked, approved and manually edited segments are skipped unless explicitly forced.
 * - Each segment is translated independently; context-aware providers receive
 *   neighbours as read-only context and must return every id exactly once,
 *   so a segment can never be merged into or erase another one.
 * - Failed batches are retried with backoff, then split into single segments so one
 *   bad segment does not fail the whole batch.
 * - Results are emitted per batch, so cancelling never loses finished work.
 */

export type JobState = 'idle' | 'running' | 'paused' | 'cancelled' | 'completed' | 'failed'

export interface SegmentUpdate {
  segmentId: string
  /** Source text the translation was produced from (editor ignores update if source changed). */
  sourceText: string
  text: string
  status: TranslationStatus
  origin: TranslationOrigin
  providerId: string
  error?: string
}

export interface JobProgress {
  state: JobState
  total: number
  done: number
  failed: number
  cached: number
  skipped: number
  currentBatch: number
  totalBatches: number
  message: string
}

export interface TranslationJobOptions {
  provider: TranslationProvider
  segments: Segment[]
  profile: ProfileId
  sourceLanguage: SourceLanguage
  neutralYat: Yat
  contentType: ContentType
  glossary: GlossaryHint[]
  cache?: TranslationCache
  /** Restrict to these segments (e.g. "translate selected"). */
  segmentIds?: string[]
  /** Re-translate machine/test output that already exists. */
  retranslateMachine?: boolean
  /** Also overwrite manually edited translations (explicit user request only). */
  overwriteManual?: boolean
  contextSize?: number
  maxCharsPerLine?: number
  maxRetries?: number
  retryBaseDelayMs?: number
  onUpdate: (updates: SegmentUpdate[]) => void
  onProgress: (progress: JobProgress) => void
}

export const buildTarget = (profile: ProfileId, neutralYat: Yat): TranslationTarget => {
  const def = getProfile(profile)
  return { profile, language: def.language, variant: def.variant, yat: resolveYat(profile, neutralYat), label: def.label }
}

/** Decide whether a segment should be (re)translated by a batch job. */
export function isEligible(segment: Segment, profile: ProfileId, options: Pick<TranslationJobOptions, 'retranslateMachine' | 'overwriteManual'>): boolean {
  if (!segment.source.trim()) return false
  const tr = segment.translations[profile]
  if (!tr) return true
  if (tr.locked || tr.status === 'approved') return false
  if (tr.origin === 'manual' || tr.origin === 'transliteration') return Boolean(options.overwriteManual)
  // TEST placeholders are never a translation: always replace them.
  if (tr.origin === 'test') return true
  if (tr.status === 'not_translated' || tr.status === 'failed' || tr.status === 'translating' || !tr.text.trim()) return true
  return Boolean(options.retranslateMachine)
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new CancelledError())
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new CancelledError())
    }, { once: true })
  })

export class TranslationJob {
  private controller = new AbortController()
  private pauseGate: { promise: Promise<void>; release: () => void } | null = null
  private progress: JobProgress
  private readonly target: TranslationTarget
  private readonly opts: Required<Omit<TranslationJobOptions, 'cache' | 'segmentIds'>> & Pick<TranslationJobOptions, 'cache' | 'segmentIds'>

  constructor(options: TranslationJobOptions) {
    this.opts = {
      retranslateMachine: false,
      overwriteManual: false,
      contextSize: 2,
      maxCharsPerLine: 42,
      maxRetries: 2,
      retryBaseDelayMs: 600,
      ...options,
    }
    this.target = buildTarget(options.profile, options.neutralYat)
    this.progress = { state: 'idle', total: 0, done: 0, failed: 0, cached: 0, skipped: 0, currentBatch: 0, totalBatches: 0, message: '' }
  }

  get state() {
    return this.progress.state
  }

  pause() {
    if (this.progress.state !== 'running' || this.pauseGate) return
    let release!: () => void
    const promise = new Promise<void>((r) => (release = r))
    this.pauseGate = { promise, release }
    this.emit({ state: 'paused', message: L('Paused — the current batch finishes first.') })
  }

  resume() {
    if (!this.pauseGate) return
    this.pauseGate.release()
    this.pauseGate = null
    this.emit({ state: 'running', message: L('Resumed.') })
  }

  cancel() {
    this.controller.abort()
    this.pauseGate?.release()
    this.pauseGate = null
  }

  private emit(patch: Partial<JobProgress>) {
    this.progress = { ...this.progress, ...patch }
    this.opts.onProgress(this.progress)
  }

  private buildItems(): { items: Array<TranslationItem & { segment: Segment; shell: ReturnType<typeof extractMarkupShell> }>; skipped: number } {
    const { segments, segmentIds, profile } = this.opts
    const wanted = segmentIds ? new Set(segmentIds) : null
    const plain = segments.map((s) => extractMarkupShell(s.source).inner)
    const items: Array<TranslationItem & { segment: Segment; shell: ReturnType<typeof extractMarkupShell> }> = []
    let skipped = 0
    segments.forEach((segment, index) => {
      if (wanted && !wanted.has(segment.id)) return
      if (!isEligible(segment, profile, this.opts)) {
        skipped += 1
        return
      }
      const shell = extractMarkupShell(segment.source)
      const k = this.opts.contextSize
      items.push({
        id: segment.id,
        text: shell.inner,
        before: plain.slice(Math.max(0, index - k), index).filter(Boolean),
        after: plain.slice(index + 1, index + 1 + k).filter(Boolean),
        segment,
        shell,
      })
    })
    return { items, skipped }
  }

  private chunk<T extends TranslationItem>(items: T[]): T[][] {
    const { maxBatchItems, maxBatchChars } = this.opts.provider
    const batches: T[][] = []
    let current: T[] = []
    let chars = 0
    for (const item of items) {
      const size = item.text.length + (this.opts.provider.usesContext ? item.before.join(' ').length + item.after.join(' ').length : 0)
      if (current.length && (current.length >= maxBatchItems || chars + size > maxBatchChars)) {
        batches.push(current)
        current = []
        chars = 0
      }
      current.push(item)
      chars += size
    }
    if (current.length) batches.push(current)
    return batches
  }

  private cacheKey(item: TranslationItem) {
    const p = this.opts.provider
    const ctx = p.usesContext ? `${item.before.join('\u0001')}\u0002${item.after.join('\u0001')}` : ''
    return fnv1a64([p.cacheKey(), this.opts.sourceLanguage, this.target.profile, this.target.yat, ctx, item.text].join('\u0000'))
  }

  /** Call provider with retries; throws the last error. */
  private async callProvider(items: TranslationItem[]): Promise<Map<string, string>> {
    const { provider, maxRetries, retryBaseDelayMs } = this.opts
    let attempt = 0
    for (;;) {
      if (this.controller.signal.aborted) throw new CancelledError()
      try {
        const results = await provider.translateBatch({
          items: items.map(({ id, text, before, after }) => ({ id, text, before, after })),
          sourceLanguage: this.opts.sourceLanguage,
          target: this.target,
          glossary: this.opts.glossary,
          contentType: this.opts.contentType,
          signal: this.controller.signal,
        })
        const map = new Map<string, string>()
        for (const r of results) map.set(r.id, r.text)
        // Markup-only segments (e.g. "<i></i>") have no text to translate; empty output is valid for them.
        const missing = items.filter((i) => i.text.trim() && !map.get(i.id)?.trim())
        const extra = results.filter((r) => !items.some((i) => i.id === r.id))
        if (missing.length || extra.length || results.length !== items.length) {
          throw new ProviderError(`Provider returned ${results.length} result(s) for ${items.length} segment(s) (missing ${missing.length}, unexpected ${extra.length}).`, true)
        }
        return map
      } catch (error) {
        if (error instanceof CancelledError || this.controller.signal.aborted) throw new CancelledError()
        const retryable = error instanceof ProviderError ? error.retryable : true
        if (!retryable || attempt >= maxRetries) throw error
        attempt += 1
        await sleep(retryBaseDelayMs * 2 ** (attempt - 1), this.controller.signal)
      }
    }
  }

  private finalize(item: { segment: Segment; shell: ReturnType<typeof extractMarkupShell> }, raw: string, cachedOrFresh: string): SegmentUpdate {
    const { provider } = this.opts
    let text = raw.trim()
    if (!text.includes('\n')) text = reflowSubtitle(text, this.opts.maxCharsPerLine)
    if (getProfile(this.target.profile).script === 'Cyrl' && !provider.isTest) text = latinToCyrillic(text)
    text = applyMarkupShell(item.shell, text)
    const needsReview = provider.isTest || item.shell.lostInlineMarkup
    return {
      segmentId: item.segment.id,
      sourceText: item.segment.source,
      text,
      status: needsReview ? 'needs_review' : 'translated',
      origin: provider.isTest ? 'test' : 'machine',
      providerId: provider.id,
      error: item.shell.lostInlineMarkup ? `Inline formatting inside the text could not be preserved (${cachedOrFresh}). Re-apply it manually.` : undefined,
    }
  }

  async run(): Promise<JobProgress> {
    const { provider, cache } = this.opts
    if (!provider.supports(this.opts.sourceLanguage, this.target)) {
      this.emit({ state: 'failed', message: L('{label} does not support {sourceLanguage} → {label2}.', { label: L(provider.label), sourceLanguage: this.opts.sourceLanguage, label2: L(this.target.label) }) })
      return this.progress
    }
    const { items, skipped } = this.buildItems()
    const batches = this.chunk(items)
    this.emit({ state: 'running', total: items.length, skipped, totalBatches: batches.length, message: items.length ? L('Translating…') : L('Nothing to translate.') })
    if (!items.length) {
      this.emit({ state: 'completed' })
      return this.progress
    }

    try {
      for (let b = 0; b < batches.length; b += 1) {
        if (this.pauseGate) await this.pauseGate.promise
        if (this.controller.signal.aborted) throw new CancelledError()
        this.emit({ currentBatch: b + 1, message: L('Batch {v} of {length}', { v: b + 1, length: batches.length }) })

        const batch = batches[b]
        const updates: SegmentUpdate[] = []
        const pending: typeof batch = []
        if (cache) {
          for (const item of batch) {
            const hit = await cache.get(this.cacheKey(item))
            if (hit !== undefined) {
              updates.push(this.finalize(item, hit, 'cache'))
              this.progress.cached += 1
            } else pending.push(item)
          }
        } else pending.push(...batch)

        if (pending.length) {
          try {
            const results = await this.callProvider(pending)
            for (const item of pending) {
              const text = results.get(item.id)!
              if (cache && !provider.isTest) await cache.set(this.cacheKey(item), text)
              updates.push(this.finalize(item, text, 'model'))
            }
          } catch (error) {
            if (error instanceof CancelledError) throw error
            // Isolate failures: retry every segment of the failed batch on its own.
            for (const item of pending) {
              if (this.controller.signal.aborted) throw new CancelledError()
              try {
                const single = await this.callProvider([item])
                const text = single.get(item.id)!
                if (cache && !provider.isTest) await cache.set(this.cacheKey(item), text)
                updates.push(this.finalize(item, text, 'model'))
              } catch (singleError) {
                if (singleError instanceof CancelledError) throw singleError
                updates.push({
                  segmentId: item.id,
                  sourceText: item.segment.source,
                  text: item.segment.translations[this.target.profile]?.text ?? '',
                  status: 'failed',
                  origin: item.segment.translations[this.target.profile]?.origin ?? 'none',
                  providerId: provider.id,
                  error: (singleError as Error).message,
                })
              }
            }
          }
        }

        const failed = updates.filter((u) => u.status === 'failed').length
        this.opts.onUpdate(updates)
        this.emit({ done: this.progress.done + updates.length - failed, failed: this.progress.failed + failed })
      }
      this.emit({
        state: 'completed',
        message: this.progress.failed ? L('Finished with {n} failed segment(s). Use "Retry failed".', { n: this.progress.failed }) : L('Finished.'),
      })
    } catch (error) {
      if (error instanceof CancelledError) this.emit({ state: 'cancelled', message: L('Cancelled. Finished segments were kept.') })
      else this.emit({ state: 'failed', message: (error as Error).message })
    }
    return this.progress
  }
}

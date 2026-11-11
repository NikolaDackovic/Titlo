import { describe, expect, it, vi } from 'vitest'
import type { Segment } from '../domain/types'
import { applyTranslationUpdates } from '../state/segmentOps'
import { TranslationJob, isEligible, type JobProgress, type SegmentUpdate } from './engine'
import { reflowSubtitle } from './linebreak'
import { buildMessages, isLoopbackUrl, LocalLlmProvider, parseLlmAnswer } from './providers/localLlm'
import { OpusMtProvider, opusTargetToken, type MarianRuntime } from './providers/opusMt'
import { TestTranslationProvider } from './providers/testProvider'
import { MemoryTranslationCache, ProviderError, type TranslationProvider, type TranslationRequest } from './types'

const segs = (texts: string[]): Segment[] => texts.map((t, i) => ({ id: `s${i + 1}`, start: i * 2000, end: i * 2000 + 1500, source: t, translations: {} }))

class FakeProvider implements TranslationProvider {
  readonly id = 'fake'
  readonly label = 'Fake'
  readonly kind = 'local-nmt' as const
  readonly isTest = false
  readonly usesContext: boolean
  readonly maxBatchItems: number
  readonly maxBatchChars = 10_000
  calls: TranslationRequest[] = []
  failIds = new Set<string>()
  failTimes = 0
  constructor(opts: { batch?: number; context?: boolean } = {}) {
    this.maxBatchItems = opts.batch ?? 3
    this.usesContext = opts.context ?? false
  }
  cacheKey() {
    return 'fake'
  }
  supports() {
    return true
  }
  async checkAvailability() {
    return { available: true, message: '' }
  }
  async translateBatch(req: TranslationRequest) {
    this.calls.push(req)
    if (this.failTimes > 0) {
      this.failTimes -= 1
      throw new ProviderError('transient', true)
    }
    if (req.items.some((i) => this.failIds.has(i.id))) throw new ProviderError('bad segment', true)
    return req.items.map((i) => ({ id: i.id, text: `ljubav ${i.text.toUpperCase()}` }))
  }
}

const run = async (provider: TranslationProvider, segments: Segment[], extra: Partial<ConstructorParameters<typeof TranslationJob>[0]> = {}) => {
  const updates: SegmentUpdate[] = []
  const progress: JobProgress[] = []
  const job = new TranslationJob({
    provider,
    segments,
    profile: 'sr-Latn',
    sourceLanguage: 'en',
    neutralYat: 'ijekavian',
    contentType: 'movie',
    glossary: [],
    retryBaseDelayMs: 1,
    onUpdate: (u) => updates.push(...u),
    onProgress: (p) => progress.push(p),
    ...extra,
  })
  const final = await job.run()
  return { updates, progress, final, job }
}

describe('translation job', () => {
  it('translates in batches, keeps ids, reports progress', async () => {
    const p = new FakeProvider({ batch: 2 })
    const { updates, final } = await run(p, segs(['one', 'two', 'three']))
    expect(p.calls.map((c) => c.items.length)).toEqual([2, 1])
    expect(updates.map((u) => [u.segmentId, u.text, u.status, u.origin])).toEqual([
      ['s1', 'ljubav ONE', 'translated', 'machine'],
      ['s2', 'ljubav TWO', 'translated', 'machine'],
      ['s3', 'ljubav THREE', 'translated', 'machine'],
    ])
    expect(final).toMatchObject({ state: 'completed', done: 3, failed: 0, total: 3 })
  })

  it('passes neighbour context only as context', async () => {
    const p = new FakeProvider({ batch: 10, context: true })
    await run(p, segs(['You know what?', 'I never trusted him.', 'Not even once.']))
    const middle = p.calls[0].items[1]
    expect(middle).toMatchObject({ text: 'I never trusted him.', before: ['You know what?'], after: ['Not even once.'] })
  })

  it('transliterates for Cyrillic and preserves wrapping markup', async () => {
    const segments = segs(['<i>love</i>'])
    const { updates } = await run(new FakeProvider(), segments, { profile: 'sr-Cyrl' })
    expect(updates[0].text).toBe('<i>љубав ЛОВЕ</i>')
  })

  it('skips locked, approved and manual segments unless explicitly forced', async () => {
    const segments = segs(['a', 'b', 'c', 'd'])
    segments[0].translations['sr-Latn'] = { text: 'x', status: 'translated', origin: 'machine', locked: true, updatedAt: '' }
    segments[1].translations['sr-Latn'] = { text: 'x', status: 'approved', origin: 'machine', locked: false, updatedAt: '' }
    segments[2].translations['sr-Latn'] = { text: 'ručno', status: 'translated', origin: 'manual', locked: false, updatedAt: '' }
    const { updates, final } = await run(new FakeProvider(), segments)
    expect(updates.map((u) => u.segmentId)).toEqual(['s4'])
    expect(final.skipped).toBe(3)
    const forced = await run(new FakeProvider(), segments, { overwriteManual: true })
    expect(forced.updates.map((u) => u.segmentId)).toEqual(['s3', 's4'])
    expect(isEligible(segments[0], 'sr-Latn', { overwriteManual: true })).toBe(false)
  })

  it('retries transient failures', async () => {
    const p = new FakeProvider()
    p.failTimes = 2
    const { final } = await run(p, segs(['a']))
    expect(final.state).toBe('completed')
    expect(p.calls).toHaveLength(3)
  })

  it('isolates a failing segment instead of failing the batch', async () => {
    const p = new FakeProvider({ batch: 3 })
    p.failIds.add('s2')
    const { updates, final } = await run(p, segs(['a', 'b', 'c']), { maxRetries: 0 })
    expect(updates.find((u) => u.segmentId === 's2')?.status).toBe('failed')
    expect(updates.filter((u) => u.status === 'translated')).toHaveLength(2)
    expect(final).toMatchObject({ state: 'completed', failed: 1, done: 2 })
  })

  it('rejects answers with missing or extra segments', async () => {
    const p = new FakeProvider()
    p.translateBatch = async (req) => req.items.slice(1).map((i) => ({ id: i.id, text: 'x' }))
    const { final } = await run(p, segs(['a', 'b']), { maxRetries: 0 })
    expect(final.failed).toBe(2)
  })

  it('uses the cache on a second run', async () => {
    const cache = new MemoryTranslationCache()
    const p1 = new FakeProvider()
    await run(p1, segs(['a', 'b']), { cache })
    const p2 = new FakeProvider()
    const { final, updates } = await run(p2, segs(['a', 'b']), { cache })
    expect(p2.calls).toHaveLength(0)
    expect(final.cached).toBe(2)
    expect(updates[0].text).toBe('ljubav A')
  })

  it('cancel keeps finished batches', async () => {
    const p = new FakeProvider({ batch: 1 })
    let job: TranslationJob | null = null
    const updates: SegmentUpdate[] = []
    job = new TranslationJob({
      provider: p, segments: segs(['a', 'b', 'c']), profile: 'hr', sourceLanguage: 'en', neutralYat: 'ijekavian', contentType: 'movie', glossary: [],
      onUpdate: (u) => {
        updates.push(...u)
        job!.cancel()
      },
      onProgress: () => {},
    })
    const final = await job.run()
    expect(final.state).toBe('cancelled')
    expect(updates).toHaveLength(1)
  })

  it('pause and resume', async () => {
    const p = new FakeProvider({ batch: 1 })
    const states: string[] = []
    let job!: TranslationJob
    let paused = false
    job = new TranslationJob({
      provider: p, segments: segs(['a', 'b']), profile: 'hr', sourceLanguage: 'en', neutralYat: 'ijekavian', contentType: 'movie', glossary: [],
      onUpdate: () => {
        if (!paused) {
          paused = true
          job.pause()
          setTimeout(() => job.resume(), 20)
        }
      },
      onProgress: (pr) => states.push(pr.state),
    })
    const final = await job.run()
    expect(states).toContain('paused')
    expect(final).toMatchObject({ state: 'completed', done: 2 })
  })

  it('TEST provider output is marked as test and needs review', async () => {
    const { updates } = await run(new TestTranslationProvider(1), segs(['Hello']))
    expect(updates[0]).toMatchObject({ origin: 'test', status: 'needs_review' })
    expect(updates[0].text).toContain('[TEST')
  })

  it('editor ignores updates for segments edited during the job', () => {
    const segments = segs(['a', 'b'])
    const started = '2026-01-01T00:00:00.000Z'
    segments[0].translations['sr-Latn'] = { text: 'moje', status: 'translated', origin: 'manual', locked: false, updatedAt: '2026-01-01T00:00:05.000Z' }
    const updates: SegmentUpdate[] = [
      { segmentId: 's1', sourceText: 'a', text: 'X', status: 'translated', origin: 'machine', providerId: 'p' },
      { segmentId: 's2', sourceText: 'CHANGED', text: 'Y', status: 'translated', origin: 'machine', providerId: 'p' },
    ]
    const r = applyTranslationUpdates(segments, 'sr-Latn', updates, started)
    expect(r.applied).toBe(0)
    expect(r.ignored).toBe(2)
    expect(r.segments[0].translations['sr-Latn']?.text).toBe('moje')
  })
})

describe('line reflow', () => {
  it('breaks long lines into two balanced lines and avoids dangling words', () => {
    const out = reflowSubtitle('Mislim da ne bi trebalo da idemo tamo i čekamo ga celu noć.', 42)
    const [a, b] = out.split('\n')
    expect(a.length).toBeLessThanOrEqual(42)
    expect(b.length).toBeLessThanOrEqual(42)
    expect(a.trim().split(' ').pop()).not.toBe('i')
    expect(reflowSubtitle('Kratko.', 42)).toBe('Kratko.')
  })
})

describe('OPUS-MT provider', () => {
  it('selects the right target token', () => {
    expect(opusTargetToken({ profile: 'hr', language: 'sh' as const, variant: 'hr', yat: 'ijekavian', label: '' })).toBe('>>hrv<<')
    expect(opusTargetToken({ profile: 'bs', language: 'sh' as const, variant: 'bs', yat: 'ijekavian', label: '' })).toBe('>>bos_Latn<<')
    expect(opusTargetToken({ profile: 'sr-Cyrl', language: 'sh' as const, variant: 'sr', yat: 'ekavian', label: '' })).toBe('>>srp_Latn<<')
    expect(opusTargetToken({ profile: 'exyu-neutral', language: 'sh' as const, variant: null, yat: 'ijekavian', label: '' })).toBe('>>bos_Latn<<')
    expect(opusTargetToken({ profile: 'exyu-neutral', language: 'sh' as const, variant: null, yat: 'ekavian', label: '' })).toBe('>>srp_Latn<<')
  })

  it('prefixes the token, joins lines and reports missing model files', async () => {
    const seen: string[][] = []
    const runtime: MarianRuntime = { translate: async (_m, texts) => (seen.push(texts), texts.map((t) => `out:${t}`)), dispose: () => {} }
    const provider = new OpusMtProvider(runtime, { exists: async (p) => !p.endsWith('tokenizer.json') }, { device: 'wasm', dtype: 'q8', numBeams: 4 })
    const availability = await provider.checkAvailability()
    expect(availability.available).toBe(false)
    expect(availability.details?.[0]).toContain('tokenizer.json')
    const out = await provider.translateBatch({
      items: [{ id: 'a', text: 'Hello\nthere', before: [], after: [] }],
      sourceLanguage: 'en', target: { profile: 'hr', language: 'sh' as const, variant: 'hr', yat: 'ijekavian', label: '' }, glossary: [], contentType: 'movie', signal: new AbortController().signal,
    })
    expect(seen[0]).toEqual(['>>hrv<< Hello there'])
    expect(out[0].text).toBe('out:>>hrv<< Hello there'.replace(/^>>\w+<<\s*/, ''))
    const hr = { profile: 'hr' as const, language: 'sh' as const, variant: 'hr' as const, yat: 'ijekavian' as const, label: '' }
    const en = { profile: 'en' as const, language: 'en' as const, variant: null, yat: 'ijekavian' as const, label: '' }
    expect(provider.supports('sr', hr)).toBe(false)
    expect(provider.supports('en', hr)).toBe(true)
    expect(provider.supports('sr', en)).toBe(true)
    expect(provider.supports('en', en)).toBe(false)
    // sr → en uses the second model and no language token
    seen.length = 0
    const back = await provider.translateBatch({ items: [{ id: 'b', text: 'Dobar dan.', before: [], after: [] }], sourceLanguage: 'sr', target: en, glossary: [], contentType: 'movie', signal: new AbortController().signal })
    expect(seen[0]).toEqual(['Dobar dan.'])
    expect(back[0].text).toBe('out:Dobar dan.')
  })
})

describe('Local LLM provider', () => {
  it('allows only loopback servers', () => {
    expect(isLoopbackUrl('http://127.0.0.1:8080')).toBe(true)
    expect(isLoopbackUrl('http://localhost:11434')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:8080')).toBe(true)
    expect(isLoopbackUrl('https://api.example.com')).toBe(false)
    expect(isLoopbackUrl('http://192.168.1.10:8080')).toBe(false)
    expect(isLoopbackUrl('http://127.0.0.1.evil.com')).toBe(false)
  })

  it('builds a context-aware prompt with glossary and variant rules', () => {
    const msgs = buildMessages({
      items: [{ id: 's2', text: 'I never trusted him.', before: ['You know what?'], after: ['Not even once.'] }],
      sourceLanguage: 'en', target: { profile: 'hr', language: 'sh' as const, variant: 'hr', yat: 'ijekavian', label: 'Croatian' },
      glossary: [{ source: 'apartment', target: 'stan' }], contentType: 'movie', signal: new AbortController().signal,
    })
    expect(msgs[0].content).toContain('standard Croatian')
    expect(msgs[0].content).toContain('"apartment" → "stan"')
    expect(JSON.parse(msgs[1].content).segments[0]).toMatchObject({ id: 's2', context_before: ['You know what?'] })
  })

  it('validates the model answer strictly', () => {
    expect(parseLlmAnswer('Sure! {"translations":[{"id":"a","text":"Zdravo"}]}', ['a'])).toEqual([{ id: 'a', text: 'Zdravo' }])
    expect(() => parseLlmAnswer('{"translations":[{"id":"a","text":"x"}]}', ['a', 'b'])).toThrow(ProviderError)
    expect(() => parseLlmAnswer('{"translations":[{"id":"zzz","text":"x"}]}', ['a'])).toThrow(ProviderError)
    expect(() => parseLlmAnswer('no json', ['a'])).toThrow(ProviderError)
  })

  it('talks to an OpenAI-compatible endpoint and blocks remote URLs', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://127.0.0.1:8080/v1/chat/completions')
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":[{"id":"a","text":"Zdravo"}]}' } }] }), { status: 200 })
    })
    const p = new LocalLlmProvider({ baseUrl: 'http://127.0.0.1:8080', model: 'm', temperature: 0.2, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch)
    const req = { items: [{ id: 'a', text: 'Hello', before: [], after: [] }], sourceLanguage: 'en' as const, target: { profile: 'sr-Latn' as const, language: 'sh' as const, variant: 'sr' as const, yat: 'ekavian' as const, label: '' }, glossary: [], contentType: 'movie' as const, signal: new AbortController().signal }
    expect(await p.translateBatch(req)).toEqual([{ id: 'a', text: 'Zdravo' }])
    const remote = new LocalLlmProvider({ baseUrl: 'https://api.example.com', model: 'm', temperature: 0.2, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch)
    await expect(remote.translateBatch(req)).rejects.toThrow(/Only local servers/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

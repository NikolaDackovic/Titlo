import type { SourceLanguage } from '../../domain/languages'
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
 * OPUS-MT (Marian NMT) provider — Helsinki-NLP/opus-mt-tc-base-en-sh.
 *
 * Verified on the model card: English → bos_Latn, hrv, srp_Latn, srp_Cyrl (and hbs),
 * licence CC-BY-4.0 (commercial use allowed with attribution), 74M parameters.
 * The target variant is selected with a sentence-initial token, e.g. ">>hrv<<".
 *
 * The model runs fully locally via Transformers.js (ONNX Runtime, WASM or WebGPU).
 * It must be converted to ONNX once and placed in the models folder; the app never
 * downloads it. Sentence-level model: no cross-segment context.
 */

export const OPUS_MODEL_ID = 'Helsinki-NLP/opus-mt-tc-base-en-sh'
/**
 * Serbian / Croatian / Bosnian → English: Helsinki-NLP/opus-mt-tc-big-sh-en (CC-BY-4.0,
 * ~236M parameters), int8 ONNX export by TigreGotico. English is the only target, so no
 * language token is needed. Installed with `npm run model:install:sh-en`.
 */
export { OPUS_SH_EN_MODEL_ID, noKvCache, patchNoKvCache } from './opusModels'
import { OPUS_SH_EN_MODEL_ID } from './opusModels'

export type OpusDirection = 'en-sh' | 'sh-en'
export const opusDirection = (source: SourceLanguage, target: TranslationTarget): OpusDirection | null =>
  source === 'en' && target.language === 'sh' ? 'en-sh' : source !== 'en' && target.language === 'en' ? 'sh-en' : null

/** The runtime abstraction lets the same provider run in a Web Worker or in Node. */
export interface MarianRuntime {
  /** Load (once) and translate. Each input string is translated independently. */
  translate(modelId: string, texts: string[], options: MarianRuntimeOptions, signal: AbortSignal): Promise<string[]>
  /** Optional warm-up: load the model without translating. */
  load?(modelId: string, options: MarianRuntimeOptions): Promise<void>
  dispose(): void
}

export interface MarianRuntimeOptions {
  device: 'wasm' | 'webgpu' | 'cpu'
  dtype: 'q8' | 'fp32' | 'fp16'
  numBeams: number
}

export interface ModelFileCheck {
  /** Resolves file existence (HEAD request in browser, fs.stat in Node). */
  exists(relativePath: string): Promise<boolean>
}

/**
 * The srp_Latn training data of this model contains Windows-1250 → Latin-1 mojibake:
 * the model writes "æ" for "ć", "è" for "č" and "ð" for "đ" (verified in benchmark).
 * None of these characters exist in Serbian, Croatian or Bosnian, so the repair is
 * deterministic and cannot damage correct text.
 */
const MOJIBAKE: Record<string, string> = { æ: 'ć', Æ: 'Ć', è: 'č', È: 'Č', ð: 'đ', Ð: 'Đ' }
export const countMojibake = (text: string) => (text.match(/[æÆèÈðÐ]/g) ?? []).length
export const repairMojibake = (text: string) => text.replace(/[æÆèÈðÐ]/g, (c) => MOJIBAKE[c])

// Case-sensitive on purpose: "No." / "no." are ordinary sentences, not abbreviations.
const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|e\.g|i\.e)\.$/

/**
 * Split text into sentences. A boundary is end punctuation followed by whitespace and an
 * uppercase letter, digit, quote or dash. Common abbreviations (Mr., Dr., …) are not boundaries.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let current = ''
  const tokens = text.split(/(?<=[.!?…])\s+(?=["“„'(\-–—\p{Lu}\p{N}])/u)
  for (const t of tokens) {
    current = current ? `${current} ${t}` : t
    if (!ABBREVIATIONS.test(current)) {
      out.push(current)
      current = ''
    }
  }
  if (current) out.push(current)
  return out.map((s) => s.trim()).filter(Boolean)
}

/**
 * Split a subtitle into model inputs. The model is sentence-level and, when given several
 * sentences at once, often translates only one of them (verified: "Get down! Now!" →
 * "Dolje!"). Therefore:
 * - dialogue subtitles ("- A\n- B") are split per speaker line and re-assembled with dashes;
 * - other multi-line text is one utterance (lines joined with a space);
 * - every line is split into sentences, each translated on its own, then joined with a space.
 */
export function splitForModel(text: string): { parts: string[]; join: (outputs: string[]) => string } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const dash = /^[-–—]\s*/
  const dialogue = lines.length > 1 && lines.every((l) => dash.test(l))
  const units = dialogue ? lines.map((l) => l.replace(dash, '')) : [lines.join(' ')]
  const groups = units.map((u) => splitSentences(u))
  const parts = groups.flat()
  return {
    parts,
    join: (outputs) => {
      let k = 0
      const rendered = groups.map((g) =>
        g
          .map((sentence) => {
            const out = (outputs[k++] ?? '').trim()
            // The model sometimes adds a dialogue dash that is not in the source.
            return dash.test(sentence) ? out : out.replace(dash, '')
          })
          .join(' '),
      )
      return dialogue ? rendered.map((r) => `- ${r}`).join('\n') : rendered[0] ?? ''
    },
  }
}

/**
 * Map a target to the OPUS-MT language token (decision record: docs/TRANSLATION_QUALITY_REPORT.md).
 *
 * - hr → >>hrv<<            consistent Croatian, ijekavian (benchmark v2 chrF 70.2)
 * - sr → >>srp_Latn<<       + mojibake repair; Cyrillic profile = deterministic transliteration
 *                            of this output (chrF 70.1 vs 68.3 for the model's own >>srp_Cyrl<<,
 *                            which also hallucinated words)
 * - bs → >>bos_Latn<<       ~5% of lines contain ekavian forms → flagged by QC/yat proposals
 * - Neutral → >>bos_Latn<< (ijekavian) / >>srp_Latn<< (ekavian): heuristic, NOT validated by
 *   human evaluation; the hrv+localization route scored within noise (69.8 vs 69.3).
 * - >>hbs<< is never used: it produces garbage such as "[4]" (also visible on the model card).
 */
export function opusTargetToken(target: TranslationTarget): string {
  switch (target.variant) {
    case 'hr':
      return '>>hrv<<'
    case 'bs':
      return '>>bos_Latn<<'
    case 'sr':
      return '>>srp_Latn<<'
    case null:
      return target.yat === 'ijekavian' ? '>>bos_Latn<<' : '>>srp_Latn<<'
  }
}

export class OpusMtProvider implements TranslationProvider {
  readonly id = 'opus-mt-en-sh'
  readonly label = 'OPUS-MT (local NMT)'
  readonly kind = 'local-nmt' as const
  readonly isTest = false
  readonly usesContext = false
  readonly maxBatchItems = 8
  readonly maxBatchChars = 1600

  constructor(
    private readonly runtime: MarianRuntime,
    private readonly files: ModelFileCheck,
    private readonly options: MarianRuntimeOptions,
    readonly modelId: string = OPUS_MODEL_ID,
    readonly shEnModelId: string = OPUS_SH_EN_MODEL_ID,
  ) {}

  private modelFor(direction: OpusDirection) {
    return direction === 'sh-en' ? this.shEnModelId : this.modelId
  }

  cacheKey() {
    return `${this.id}:${this.modelId}:${this.options.dtype}:b${this.options.numBeams}`
  }

  supports(source: SourceLanguage, target: TranslationTarget) {
    return opusDirection(source, target) !== null
  }

  async checkAvailability(pair?: { sourceLanguage: SourceLanguage; target: TranslationTarget }): Promise<ProviderAvailability> {
    const modelId = this.modelFor((pair && opusDirection(pair.sourceLanguage, pair.target)) || 'en-sh')
    const quantized = this.options.dtype === 'q8'
    const suffix = quantized ? '_quantized' : this.options.dtype === 'fp16' ? '_fp16' : ''
    const required = [
      'config.json',
      'generation_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      `onnx/encoder_model${suffix}.onnx`,
      `onnx/decoder_model_merged${suffix}.onnx`,
    ]
    const missing: string[] = []
    for (const file of required) {
      if (!(await this.files.exists(`${modelId}/${file}`))) missing.push(file)
    }
    if (missing.length) {
      return {
        available: false,
        message: L('Model files not found in the local models folder.'),
        details: [...missing.map((m) => `Missing: models/${modelId}/${m}`), modelId === this.shEnModelId ? 'npm run model:install:sh-en' : 'npm run model:install'],
      }
    }
    return { available: true, message: L('Found {modelId} ({dtype}).', { modelId, dtype: this.options.dtype }) }
  }

  /**
   * Each subtitle is split into sentences (and dialogue lines) and every part is sent to the
   * model on its own. Parts are NOT batched: with beam search, batching changed 1–3 of 24
   * outputs in the benchmark (padding effects), and determinism matters more than the ~2×
   * speed-up. Empty input returns an empty string without calling the model.
   */
  async translateBatch(request: TranslationRequest): Promise<TranslationResultItem[]> {
    const direction = opusDirection(request.sourceLanguage, request.target)
    if (!direction) throw new ProviderError('OPUS-MT translates English → Serbian/Croatian/Bosnian and Serbian/Croatian/Bosnian → English only.', false)
    const modelId = this.modelFor(direction)
    const prefix = direction === 'en-sh' ? `${opusTargetToken(request.target)} ` : ''
    const results: TranslationResultItem[] = []
    for (const item of request.items) {
      const split = splitForModel(item.text)
      const outputs: string[] = []
      for (const part of split.parts) {
        let out: string[]
        try {
          out = await this.runtime.translate(modelId, [`${prefix}${part}`], this.options, request.signal)
        } catch (error) {
          if (request.signal.aborted) throw error
          throw new ProviderError(`Local model error: ${(error as Error).message}`, true)
        }
        if (out.length !== 1) throw new ProviderError('Model returned a different number of results.', true)
        const text = out[0].replace(/^>>\w+<<\s*/, '').trim()
        outputs.push(direction === 'en-sh' ? repairMojibake(text) : text)
      }
      results.push({ id: item.id, text: split.parts.length ? split.join(outputs) : '' })
    }
    return results
  }

  /** Load the model ahead of the first translation (no-op if the runtime cannot). */
  async warmUp(): Promise<void> {
    if (this.runtime.load) await this.runtime.load(this.modelId, this.options)
    else await this.runtime.translate(this.modelId, ['>>hrv<< Hello.'], this.options, new AbortController().signal)
  }

  dispose() {
    this.runtime.dispose()
  }
}


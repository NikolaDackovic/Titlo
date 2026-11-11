/**
 * ASR accuracy metrics: WER and CER with substitution / deletion / insertion counts.
 *
 * Two views, both always reported:
 *  - strict:     exact text (Unicode NFC, whitespace collapsed). Case, punctuation, script,
 *                diacritics, ekavian/ijekavian forms and number formatting all count.
 *  - normalized: removes ONLY differences that do not change the words:
 *                case, punctuation, apostrophe/quote/dash variants, and Cyrillic vs Latin
 *                script (Serbian is digraphic; the app keeps transcripts in Latin).
 *                Diacritics (č/ć, š, ž, đ), ekavian/ijekavian, case endings and numbers
 *                ("9:30" vs "nine thirty") are NOT normalized: they stay errors.
 *
 * `diacriticOnlyErrors` is a diagnostic: how many word substitutions differ only in
 * diacritics (e.g. "kuca" for "kuća"). It explains errors; it never lowers WER.
 */
import { cyrillicToLatin } from '../../localization/transliterate'

export type EditOp = 'ok' | 'sub' | 'del' | 'ins'

export interface AlignmentStep {
  op: EditOp
  ref: string | null
  hyp: string | null
}

export interface ErrorCounts {
  /** Reference length (words for WER, characters for CER). */
  n: number
  substitutions: number
  deletions: number
  insertions: number
  hits: number
  /** (S + D + I) / N; null when the reference is empty (rate undefined). */
  rate: number | null
}

export interface SampleScore {
  strict: { wer: ErrorCounts; cer: ErrorCounts }
  normalized: { wer: ErrorCounts; cer: ErrorCounts }
  diacriticOnlyErrors: number
  /** True when reference and hypothesis use different scripts (e.g. Cyrillic vs Latin). */
  scriptDiffers: boolean
  /** Normalized word alignment, errors only (for the report). */
  errors: AlignmentStep[]
}

export function strictText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function normalizedText(text: string): string {
  return cyrillicToLatin(text.normalize('NFC'))
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐-―]/g, '-')
    // Apostrophes and hyphens inside a word are kept (don't, e-mail); all other punctuation goes.
    .replace(/(?<![\p{L}\p{N}])['-]|['-](?![\p{L}\p{N}])/gu, ' ')
    .replace(/[^\p{L}\p{N}\p{M}'\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const stripDiacritics = (word: string) =>
  word.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')

const words = (text: string) => (text ? text.split(' ') : [])
const chars = (text: string) => Array.from(text)

/** Levenshtein alignment with a deterministic backtrace (prefers ok/sub, then del, then ins). */
export function align(ref: string[], hyp: string[]): AlignmentStep[] {
  const R = ref.length
  const H = hyp.length
  const d: Uint32Array[] = Array.from({ length: R + 1 }, () => new Uint32Array(H + 1))
  for (let i = 0; i <= R; i += 1) d[i][0] = i
  for (let j = 0; j <= H; j += 1) d[0][j] = j
  for (let i = 1; i <= R; i += 1) {
    for (let j = 1; j <= H; j += 1) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j - 1] + cost, d[i - 1][j] + 1, d[i][j - 1] + 1)
    }
  }
  const steps: AlignmentStep[] = []
  let i = R
  let j = H
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      steps.push({ op: ref[i - 1] === hyp[j - 1] ? 'ok' : 'sub', ref: ref[i - 1], hyp: hyp[j - 1] })
      i -= 1
      j -= 1
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      steps.push({ op: 'del', ref: ref[i - 1], hyp: null })
      i -= 1
    } else {
      steps.push({ op: 'ins', ref: null, hyp: hyp[j - 1] })
      j -= 1
    }
  }
  return steps.reverse()
}

export function countErrors(steps: AlignmentStep[], n: number): ErrorCounts {
  const c = { substitutions: 0, deletions: 0, insertions: 0, hits: 0 }
  for (const s of steps) {
    if (s.op === 'ok') c.hits += 1
    else if (s.op === 'sub') c.substitutions += 1
    else if (s.op === 'del') c.deletions += 1
    else c.insertions += 1
  }
  return { n, ...c, rate: n ? (c.substitutions + c.deletions + c.insertions) / n : null }
}

const rates = (ref: string, hyp: string) => {
  const rw = words(ref)
  const rc = chars(ref)
  const wordSteps = align(rw, words(hyp))
  return { wordSteps, wer: countErrors(wordSteps, rw.length), cer: countErrors(align(rc, chars(hyp)), rc.length) }
}

const hasCyrillic = (t: string) => /[Ѐ-ӿ]/.test(t)
const hasLatinLetters = (t: string) => /[A-Za-zčćšžđČĆŠŽĐ]/.test(t)

export function scoreSample(reference: string, hypothesis: string): SampleScore {
  const strict = rates(strictText(reference), strictText(hypothesis))
  const norm = rates(normalizedText(reference), normalizedText(hypothesis))
  const diacriticOnlyErrors = norm.wordSteps.filter((s) => s.op === 'sub' && stripDiacritics(s.ref!) === stripDiacritics(s.hyp!)).length
  const refCyr = hasCyrillic(reference)
  const hypCyr = hasCyrillic(hypothesis)
  return {
    strict: { wer: strict.wer, cer: strict.cer },
    normalized: { wer: norm.wer, cer: norm.cer },
    diacriticOnlyErrors,
    scriptDiffers: (refCyr && !hypCyr && hasLatinLetters(hypothesis)) || (hypCyr && !refCyr && hasLatinLetters(reference)),
    errors: norm.wordSteps.filter((s) => s.op !== 'ok'),
  }
}

/** Corpus-level aggregate: total edits / total reference length (not the mean of per-sample rates). */
export function aggregate(counts: ErrorCounts[]): ErrorCounts {
  const sum = (k: keyof Omit<ErrorCounts, 'rate'>) => counts.reduce((s, c) => s + c[k], 0)
  const n = sum('n')
  const substitutions = sum('substitutions')
  const deletions = sum('deletions')
  const insertions = sum('insertions')
  return { n, substitutions, deletions, insertions, hits: sum('hits'), rate: n ? (substitutions + deletions + insertions) / n : null }
}

/** Speech benchmark dataset format (see benchmark/speech/README.md). */

/**
 * - exact-by-construction: synthetic audio generated from the text (TTS)
 * - human-verified: a person typed or checked the text against the recording (add-real-sample --confirm-reference)
 * - unconfirmed: a reference exists but nobody confirmed it yet → no WER is computed
 * - none: no reference
 */
export type ReferenceStatus = 'exact-by-construction' | 'human-verified' | 'unconfirmed' | 'none'

/** wer: has a trustworthy reference → WER/CER; demo: output only; detection-only: language/no-speech check. */
export type EvaluationKind = 'wer' | 'demo' | 'detection-only'

export interface SpeechSample {
  id: string
  /** Spoken language as stated by the user (null when there is no speech). */
  language: 'en' | 'sr' | 'hr' | 'bs' | null
  category: string
  /** Path relative to the project root, or absolute for local-only files. */
  audio: string
  /** Known when the dataset is built (WAV); null = measured by the browser during the run. */
  durationMs: number | null
  sha256: string
  reference: string | null
  referenceStatus: ReferenceStatus
  evaluation: EvaluationKind
  /** What "Detect automatically" should conclude. */
  expectedLanguage: 'en' | 'sr' | 'hr' | 'bs' | 'no-speech'
  source: string
  license: string
  /** Recording quality in the user's words (microphone, room, noise, music…). */
  qualityNote: string
  /** Real-world samples only. */
  contentType?: string
  notes?: string
  /** When and how the person confirmed the reference. */
  referenceConfirmedAt?: string
  referenceSource?: 'typed' | 'file'
  /** True for human recordings; false/absent for synthetic (TTS) material. */
  realWorld?: boolean
}

export interface SpeechDataset {
  name: string
  version: string
  createdAt: string
  description: string
  generator: Record<string, string>
  samples: SpeechSample[]
  /** Set on every change (real-world dataset). */
  updatedAt?: string
}

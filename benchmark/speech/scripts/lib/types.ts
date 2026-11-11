/** Speech benchmark dataset format (see benchmark/speech/README.md). */

export type ReferenceStatus = 'exact-by-construction' | 'human-verified' | 'none'

/** wer: has a trustworthy reference → WER/CER; demo: output only; detection-only: language/no-speech check. */
export type EvaluationKind = 'wer' | 'demo' | 'detection-only'

export interface SpeechSample {
  id: string
  /** Spoken language (null when there is no speech). */
  language: 'en' | 'sr' | 'hr' | 'bs' | null
  category: string
  /** Path relative to the project root, or absolute for local-only demo files. */
  audio: string
  durationMs: number
  sha256: string
  reference: string | null
  referenceStatus: ReferenceStatus
  evaluation: EvaluationKind
  /** What "Detect automatically" should conclude. */
  expectedLanguage: 'en' | 'sr' | 'hr' | 'bs' | 'no-speech'
  source: string
  license: string
  qualityNote: string
}

export interface SpeechDataset {
  name: string
  version: string
  createdAt: string
  description: string
  generator: Record<string, string>
  samples: SpeechSample[]
}

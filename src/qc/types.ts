import type { ProfileId, SourceLanguage, Yat } from '../domain/languages'
import type { Segment } from '../domain/types'
import type { GlossaryTerm } from '../glossary/types'
import type { LocalizationRule } from '../localization/engine'
import type { TermConcept } from '../localization/termbase'
import type { AudioActivity } from '../media/audioActivity'

export type QcSeverity = 'error' | 'warning' | 'suggestion'
export type QcCategory = 'transcription' | 'timing' | 'readability' | 'language' | 'terminology' | 'formatting'

export interface QcIssue {
  id: string
  check: string
  category: QcCategory
  severity: QcSeverity
  segmentId?: string
  /** 1-based display number of the segment. */
  segmentNumber?: number
  title: string
  message: string
  suggestion: string
  /** Time range the issue is about (e.g. sound that no subtitle covers). */
  range?: { startMs: number; endMs: number }
}

export interface QcProfile {
  id: string
  label: string
  description: string
  maxCharsPerLine: number
  maxLines: number
  minDurationMs: number
  maxDurationMs: number
  maxCps: number
  maxWpm: number
  minGapMs: number
}

export interface QcInput {
  segments: Segment[]
  profile: ProfileId
  sourceLanguage: SourceLanguage
  neutralYat: Yat
  qcProfile: QcProfile
  termbase: TermConcept[]
  terminology: GlossaryTerm[]
  localizationRules: LocalizationRule[]
  mediaDurationMs?: number | null
  /** Audio activity of the attached media (only while it is decoded in this session). */
  audio?: AudioActivity | null
}

/** Text that QC evaluates for readability/language: the active profile translation. */
export const targetText = (segment: Segment, profile: ProfileId) => segment.translations[profile]?.text ?? ''

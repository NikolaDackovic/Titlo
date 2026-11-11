import type { ProfileId, SourceLanguage } from '../domain/languages'

/**
 * - `terminology`: a source-language term must be rendered as the target term
 *   (e.g. EN "Apartment" → "stan"). Checked by QC and passed to context-aware providers.
 * - `localization`: a target-side replacement rule (e.g. "voz" → "vlak" for Croatian).
 *   Produces reviewable localization proposals; never applied silently.
 */
export type GlossaryTermKind = 'terminology' | 'localization'

export type ProfileScope = ProfileId | 'all'

export interface Glossary {
  id: string
  name: string
  description: string
  profile: ProfileScope
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface GlossaryTerm {
  id: string
  glossaryId: string
  kind: GlossaryTermKind
  sourceTerm: string
  targetTerm: string
  sourceLanguage: SourceLanguage
  targetProfile: ProfileScope
  notes: string
  context: string
  caseSensitive: boolean
  wholeWord: boolean
  priority: number
  enabled: boolean
  /**
   * Other renderings that are acceptable but not preferred (e.g. "auto" next to "automobil").
   * QC reports them as a suggestion, a rendering that is neither as a warning.
   */
  alternatives?: string[]
  /** Free grouping label (e.g. "Names", "Tech", "Legal"). */
  category?: string
}

/** Alternatives are stored as one "|"-separated text column. */
export const splitAlternatives = (text: string): string[] =>
  text
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
export const joinAlternatives = (list: string[]) => list.map((s) => s.trim()).filter(Boolean).join(' | ')

export type GlossaryTermInput = Omit<GlossaryTerm, 'id' | 'glossaryId'>

export const emptyTerm = (): GlossaryTermInput => ({
  kind: 'terminology',
  sourceTerm: '',
  targetTerm: '',
  sourceLanguage: 'en',
  targetProfile: 'all',
  notes: '',
  context: '',
  caseSensitive: false,
  wholeWord: true,
  priority: 0,
  enabled: true,
  alternatives: [],
  category: '',
})

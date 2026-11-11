/**
 * Language and profile definitions.
 *
 * A *source language* is what the subtitles are written in.
 * A *profile* is the target regional variant a translation is produced for.
 * Each profile maps to a base language, a script and a yat reflex (ekavian/ijekavian),
 * because those three properties drive both translation and localization rules.
 */

export type SourceLanguage = 'en' | 'sr' | 'hr' | 'bs'

export type ProfileId = 'exyu-neutral' | 'sr-Latn' | 'sr-Cyrl' | 'hr' | 'bs' | 'en'

/** Target language family: Serbo-Croatian variants (sh) or English. */
export type TargetLanguage = 'sh' | 'en'

/** Base lexical variant used by the termbase. */
export type Variant = 'sr' | 'hr' | 'bs'

export type Script = 'Latn' | 'Cyrl'
export type Yat = 'ekavian' | 'ijekavian'

export interface ProfileDefinition {
  id: ProfileId
  /** 'en' profiles skip yat, script and regional rules. */
  language: TargetLanguage
  label: string
  shortLabel: string
  /** Lexical variant used for terminology rules. `null` = neutral (no forced variant). */
  variant: Variant | null
  script: Script
  /** Expected yat reflex. For ExYu Neutral this is configurable per project. */
  yat: Yat | 'project'
  description: string
}

export const PROFILES: ProfileDefinition[] = [
  {
    id: 'exyu-neutral',
    language: 'sh',
    label: 'ExYu Neutral',
    shortLabel: 'Neutral',
    variant: null,
    script: 'Latn',
    yat: 'project',
    description:
      'Widely understood across Serbia, Croatia, Bosnia and Herzegovina and Montenegro. Avoids strongly regional vocabulary where a common alternative exists, but never invents artificial forms.',
  },
  {
    id: 'sr-Latn',
    language: 'sh',
    label: 'Serbian (Latin)',
    shortLabel: 'SR Lat',
    variant: 'sr',
    script: 'Latn',
    yat: 'ekavian',
    description: 'Standard Serbian, ekavian, Latin script.',
  },
  {
    id: 'sr-Cyrl',
    language: 'sh',
    label: 'Serbian (Cyrillic)',
    shortLabel: 'SR Ćir',
    variant: 'sr',
    script: 'Cyrl',
    yat: 'ekavian',
    description: 'Standard Serbian, ekavian, Cyrillic script (deterministic transliteration from Latin).',
  },
  {
    id: 'hr',
    language: 'sh',
    label: 'Croatian',
    shortLabel: 'HR',
    variant: 'hr',
    script: 'Latn',
    yat: 'ijekavian',
    description: 'Standard Croatian, ijekavian.',
  },
  {
    id: 'bs',
    language: 'sh',
    label: 'Bosnian',
    shortLabel: 'BS',
    variant: 'bs',
    script: 'Latn',
    yat: 'ijekavian',
    description: 'Standard Bosnian, ijekavian, Latin script.',
  },
  {
    id: 'en',
    language: 'en',
    label: 'English',
    shortLabel: 'EN',
    variant: null,
    script: 'Latn',
    yat: 'project',
    description: 'English subtitles translated from Serbian, Croatian or Bosnian.',
  },
]

export const isEnglishProfile = (id: ProfileId) => getProfile(id).language === 'en'

/**
 * Serbian/Croatian/Bosnian source into a Serbian/Croatian/Bosnian profile is an *adaptation*
 * (copy + regional suggestions); every other pair is a translation.
 */
export const isAdaptation = (source: SourceLanguage, profile: ProfileId) => source !== 'en' && !isEnglishProfile(profile)

export const PROFILE_IDS = PROFILES.map((p) => p.id)

export const getProfile = (id: ProfileId): ProfileDefinition => {
  const profile = PROFILES.find((p) => p.id === id)
  if (!profile) throw new Error(`Unknown language profile: ${id}`)
  return profile
}

export const isProfileId = (value: unknown): value is ProfileId =>
  typeof value === 'string' && (PROFILE_IDS as string[]).includes(value)

export const SOURCE_LANGUAGES: Array<{ id: SourceLanguage; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'sr', label: 'Serbian' },
  { id: 'hr', label: 'Croatian' },
  { id: 'bs', label: 'Bosnian' },
]

export const isSourceLanguage = (value: unknown): value is SourceLanguage =>
  value === 'en' || value === 'sr' || value === 'hr' || value === 'bs'

export const sourceLanguageLabel = (id: SourceLanguage) =>
  SOURCE_LANGUAGES.find((l) => l.id === id)?.label ?? id

/** Resolve the yat reflex that applies to a profile within a project. */
export const resolveYat = (profile: ProfileId, neutralYat: Yat): Yat => {
  const def = getProfile(profile)
  return def.yat === 'project' ? neutralYat : def.yat
}

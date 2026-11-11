import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTENT_TYPES, SOURCE_STATUS_LABEL, TRANSLATION_STATUS_LABEL } from '../domain/types'
import { PROFILES, SOURCE_LANGUAGES } from '../domain/languages'
import { SEED_TERMBASE } from '../localization/termbase'
import { WHISPER_MODELS } from '../media/types'
import { QC_PROFILES } from '../qc'
import { MODEL_PHASE_LABEL } from '../services/modelStatus'
import { KEYBOARD_SHORTCUTS } from '../services/settings'
import { PROVIDER_OPTIONS } from '../translation/registry'
import { getLocale, setLocale, t } from './index'
import { SR } from './sr'

/** Keys passed to t() through variables in UI files (navigation, local label maps, error codes). */
const DYNAMIC_KEYS = [
  'Home', 'Studio', 'Terminology', 'Models', 'Settings',
  'All categories', 'Transcription', 'Timing',
  'silence', 'steady sound (noise or hum)', 'sound without a speech pattern (e.g. music)', 'speech-like sound', 'Readability', 'Language', 'Terminology', 'Formatting',
  'Regional', 'Syntax', 'Yat',
  'Video or podcast', 'Speech → subtitles', 'Subtitle file', 'SRT · VTT · ASS', 'Empty project', 'Write by hand',
  'ekavian', 'ijekavian',
  'Segment not found.', 'Unlock the segment before splitting it.', 'Segment is too short to split.',
  'There is no next segment to merge with.', 'Unlock both segments before merging.',
]

function sourceKeys(): string[] {
  const keys = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') && !path.includes(join('i18n', 'sr.ts'))) {
        const text = readFileSync(path, 'utf8')
        for (const m of text.matchAll(/\b(?:t|L|tt)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
          keys.add(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
        }
      }
    }
  }
  walk(join(__dirname, '..'))
  return [...keys]
}

function dataKeys(): string[] {
  return [
    ...PROFILES.flatMap((p) => [p.label, p.description]),
    ...SOURCE_LANGUAGES.map((l) => l.label),
    ...CONTENT_TYPES.map((c) => c.label),
    ...Object.values(TRANSLATION_STATUS_LABEL),
    ...Object.values(SOURCE_STATUS_LABEL),
    ...QC_PROFILES.flatMap((p) => [p.label, p.description]),
    ...KEYBOARD_SHORTCUTS.map((s) => s.action),
    ...PROVIDER_OPTIONS.flatMap((p) => [p.label, p.description]),
    ...Object.values(MODEL_PHASE_LABEL),
    ...WHISPER_MODELS.map((m) => m.note),
    ...SEED_TERMBASE.flatMap((c) => [c.note ?? '', c.ambiguous ?? '']),
    ...DYNAMIC_KEYS,
  ]
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('Serbian UI translations', () => {
  const keys = [...new Set([...sourceKeys(), ...dataKeys()])].filter((k) => k.trim() && /[a-z]/i.test(k))

  it('covers every UI string', () => {
    const missing = keys.filter((k) => SR[k] === undefined)
    expect(missing, `Missing Serbian translations:\n${missing.map((m) => JSON.stringify(m)).join(',\n')}`).toEqual([])
  })

  it('keeps the same {placeholders} as the English key', () => {
    const wrong = Object.entries(SR).filter(([k, v]) => placeholders(k).join() !== placeholders(v).join())
    expect(wrong).toEqual([])
  })

  it('translates and interpolates at runtime', () => {
    const before = getLocale()
    setLocale('sr')
    expect(t('Cancel')).toBe(SR['Cancel'])
    expect(t('{n} subtitles', { n: 3 })).toBe(SR['{n} subtitles'].replace('{n}', '3'))
    setLocale('en')
    expect(t('{n} subtitles', { n: 3 })).toBe('3 subtitles')
    setLocale(before)
  })
})

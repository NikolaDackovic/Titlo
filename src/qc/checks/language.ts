import { getProfile, resolveYat } from '../../domain/languages'
import { stripMarkup } from '../../formats/markup'
import { findLocalizationProposals, findMixedVariantConcepts } from '../../localization/engine'
import { cyrillicToLatin, findMixedScriptWords, stripProtected } from '../../localization/transliterate'
import { detectYat } from '../../localization/yat'
import { targetText, type QcInput, type QcIssue } from '../types'
import { t as L } from '../../i18n'

const TERMINAL = /[.!?…:;"'»”“)\]♪-]$/
const startsUpper = (t: string) => /^\P{L}*\p{Lu}/u.test(t)
const startsLower = (t: string) => /^\P{L}*\p{Ll}/u.test(t)

export function checkLanguage(input: QcInput): QcIssue[] {
  const { segments, profile, sourceLanguage } = input
  const def = getProfile(profile)
  const expectedYat = resolveYat(profile, input.neutralYat)
  // English subtitles: no yat, script or regional-vocabulary rules.
  const regionalRules = def.language === 'sh'
  const issues: QcIssue[] = []

  segments.forEach((s, i) => {
    const n = i + 1
    const base = { segmentId: s.id, segmentNumber: n, category: 'language' as const }
    const tr = s.translations[profile]
    const text = targetText(s, profile)
    const plain = stripMarkup(text).trim()
    const next = segments[i + 1]
    const nextText = next ? stripMarkup(targetText(next, profile)).trim() : ''
    const prevText = i > 0 ? stripMarkup(targetText(segments[i - 1], profile)).trim() : ''

    if (!stripMarkup(s.source).trim()) {
      issues.push({ ...base, id: `empty-src:${s.id}`, check: 'empty-source', severity: 'error', title: L('Empty segment'), message: L('Segment {n} has no source text.', { n }), suggestion: L('Add text or delete the segment.') })
    }
    if (!plain) {
      if (stripMarkup(s.source).trim()) {
        issues.push({ ...base, id: `untr:${s.id}`, check: 'untranslated', severity: 'warning', title: L('Not translated'), message: L('Segment {n} has no {label} translation.', { n, label: L(def.label) }), suggestion: L('Translate it with a provider or type the translation.') })
      }
      return
    }
    if (tr?.origin === 'test') {
      issues.push({ ...base, id: `test:${s.id}`, check: 'test-output', severity: 'error', title: L('Test provider output'), message: L('Segment {n} contains output of the TEST provider — it is not a translation.', { n }), suggestion: L('Translate with a real model or manually before export.') })
    }
    if (tr?.status === 'failed') {
      issues.push({ ...base, id: `failed:${s.id}`, check: 'failed', severity: 'error', title: L('Translation failed'), message: tr.error ? `Segment ${n}: ${tr.error}` : `Segment ${n}: translation failed.`, suggestion: L('Retry the segment or translate manually.') })
    }
    if (sourceLanguage === 'en' && plain === stripMarkup(s.source).trim() && /[a-z]{3,}/i.test(plain) && plain.split(/\s+/).length > 2) {
      issues.push({ ...base, id: `same:${s.id}`, check: 'identical-to-source', severity: 'suggestion', title: L('Same as source'), message: L('Segment {n} is identical to the source.', { n }), suggestion: L('Check whether it still needs translation.') })
    }
    if (prevText && prevText === plain) {
      issues.push({ ...base, id: `dup:${s.id}`, check: 'duplicate', severity: 'warning', title: L('Duplicate segment'), message: L('Segment {n} repeats segment {v}.', { n, v: n - 1 }), suggestion: L('Merge the two segments or delete the duplicate.') })
    }

    // Punctuation & sentence continuity.
    if (nextText && !TERMINAL.test(plain) && startsUpper(nextText) && !/,$/.test(plain)) {
      issues.push({ ...base, id: `punct:${s.id}`, check: 'missing-punctuation', severity: 'suggestion', title: L('Missing end punctuation'), message: L('Segment {n} has no closing punctuation but the next one starts with a capital letter.', { n }), suggestion: L('Add ".", "?" or "!" — or "..." if the sentence continues.') })
    } else if (!next && !TERMINAL.test(plain)) {
      issues.push({ ...base, id: `punct:${s.id}`, check: 'missing-punctuation', severity: 'suggestion', title: L('Missing end punctuation'), message: L('The last segment has no closing punctuation.'), suggestion: L('Add closing punctuation.') })
    }
    if (/,$/.test(plain) && nextText && startsUpper(nextText)) {
      issues.push({ ...base, id: `unfin:${s.id}`, check: 'unfinished-sentence', severity: 'suggestion', title: L('Unfinished sentence'), message: L('Segment {n} ends with a comma but segment {v} starts a new sentence.', { n, v: n + 1 }), suggestion: L('Check punctuation or capitalisation.') })
    }
    if (prevText && /[.!?]$/.test(prevText) && !/\.\.\.$|…$/.test(prevText) && startsLower(plain)) {
      issues.push({ ...base, id: `case:${s.id}`, check: 'capitalisation', severity: 'suggestion', title: L('Lowercase sentence start'), message: L('Segment {n} starts with a lowercase letter after a finished sentence.', { n }), suggestion: L('Capitalise the first letter.') })
    }

    // Script.
    const visible = stripProtected(stripMarkup(text))
    const mixed = findMixedScriptWords(text)
    if (mixed.length) {
      issues.push({ ...base, id: `mixed:${s.id}`, check: 'mixed-script', severity: 'error', title: L('Mixed-script word'), message: L('Segment {n} contains words mixing Latin and Cyrillic letters: {slice}.', { n, slice: mixed.slice(0, 3).join(', ') }), suggestion: L('Retype the word in one script (often caused by look-alike letters such as a/а, e/е, o/о).') })
    }
    if (def.script === 'Cyrl') {
      const latinWords = (visible.match(/\p{L}+/gu) ?? []).filter((w) => /^[A-Za-zČĆŠŽĐčćšžđ]+$/.test(w))
      if (latinWords.length) {
        issues.push({ ...base, id: `script:${s.id}`, check: 'wrong-script', severity: 'warning', title: L('Latin text in Cyrillic profile'), message: L('Segment {n}: {slice}.', { n, slice: latinWords.slice(0, 4).join(', ') }), suggestion: L('Transliterate, unless these are intentionally Latin (brand names, foreign words).') })
      }
    } else if (/[Ѐ-ӿ]/.test(visible) && !mixed.length) {
      issues.push({ ...base, id: `script:${s.id}`, check: 'wrong-script', severity: 'warning', title: L('Cyrillic text in Latin profile'), message: L('Segment {n} contains Cyrillic letters.', { n }), suggestion: L('Transliterate to Latin script.') })
    }

    if (!regionalRules) return
    // Yat reflex.
    const latinView = def.script === 'Cyrl' ? cyrillicToLatin(text) : text
    const yat = detectYat(stripProtected(stripMarkup(latinView)))
    const wrong = expectedYat === 'ekavian' ? yat.ijekavian : yat.ekavian
    if (wrong.length) {
      issues.push({ ...base, id: `yat:${s.id}`, check: 'yat', severity: def.variant === 'sr' ? 'suggestion' : 'warning', title: expectedYat === 'ekavian' ? L('Not ekavian') : L('Not ijekavian'), message: L('Segment {n}: {slice} — {label} expects the {expectedYat} reflex.', { n, slice: wrong.slice(0, 4).join(', '), label: L(def.label), expectedYat: L(expectedYat) }), suggestion: L('Open the Localization panel for proposed replacements.') })
    }

    // Regional vocabulary (termbase + syntax), advisory only.
    const { proposals } = findLocalizationProposals(latinView, {
      profile,
      neutralYat: input.neutralYat,
      termbase: input.termbase,
      rules: input.localizationRules,
    })
    const regional = proposals.filter((p) => p.source !== 'yat')
    if (regional.length) {
      issues.push({ ...base, id: `regional:${s.id}`, check: 'regional-term', severity: 'suggestion', category: 'terminology', title: L('Regional wording'), message: L('Segment {n}: {list}.', { n, list: regional.map((p) => `"${p.original}"${p.replacement ? ` → "${p.replacement}"` : ''}`).slice(0, 3).join(', ') }), suggestion: L('Review in the Localization panel; nothing is changed automatically.') })
    }
  })

  // Project-level: the same concept rendered in more than one variant.
  const mixed = regionalRules ? findMixedVariantConcepts(segments.map((s) => targetText(s, profile)), input.termbase) : []
  for (const { concept, found } of mixed) {
    const list = Object.entries(found).map(([v, forms]) => `${v.toUpperCase()}: ${forms!.join('/')}`).join('; ')
    issues.push({ id: `consistency:${concept.id}`, check: 'inconsistent-variant', category: 'terminology', severity: 'warning', title: L('Inconsistent regional terminology'), message: L('"{gloss}" appears in more than one variant ({list}).', { gloss: concept.gloss, list }), suggestion: L('Use one form consistently throughout the project.') })
  }
  return issues
}

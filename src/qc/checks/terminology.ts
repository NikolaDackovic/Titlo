import { stripMarkup } from '../../formats/markup'
import { latinToCyrillic } from '../../localization/transliterate'
import { findTerm } from '../../localization/matching'
import { getProfile } from '../../domain/languages'
import { targetText, type QcInput, type QcIssue } from '../types'
import { t as L } from '../../i18n'
import type { GlossaryHint } from '../../translation/types'

/**
 * Crude stem for inflected South Slavic targets: "automobil" should also accept
 * "automobila", "automobilom"; "kuća" → "kuć". We drop one final vowel for words
 * longer than 4 letters and then require a word starting with the stem.
 */
export function stemOf(term: string): string {
  const t = term.trim().toLowerCase()
  if (t.includes(' ')) return t
  return t.length > 4 && /[aeiouаеиоу]$/.test(t) ? t.slice(0, -1) : t
}

const containsStem = (text: string, term: string) => {
  const stem = stemOf(term)
  if (stem.includes(' ')) return text.toLowerCase().includes(stem)
  return (text.toLowerCase().match(/\p{L}+/gu) ?? []).some((w) => w.startsWith(stem))
}

/**
 * Terms whose preferred rendering a machine translation did not use (the source contains the
 * term, the output has neither the preferred term nor an accepted alternative). Used to mark
 * such machine output "Needs review" — the text itself is never changed.
 */
export function missedTerms(source: string, translation: string, hints: GlossaryHint[], cyrillic: boolean): GlossaryHint[] {
  const src = stripMarkup(source)
  const text = stripMarkup(translation)
  if (!text.trim()) return []
  const script = (w: string) => (cyrillic ? latinToCyrillic(w) : w)
  return hints.filter((h) => {
    if (!findTerm(src, h.source, { wholeWord: h.wholeWord ?? true, caseSensitive: h.caseSensitive ?? false }).length) return false
    return ![h.target, ...(h.alternatives ?? [])].some((w) => containsStem(text, script(w)))
  })
}

export function checkTerminology(input: QcInput): QcIssue[] {
  const { segments, profile } = input
  const issues: QcIssue[] = []
  const terms = input.terminology.filter((t) => t.kind === 'terminology' && t.sourceLanguage === input.sourceLanguage)
  if (!terms.length) return issues
  const cyr = getProfile(profile).script === 'Cyrl'

  const script = (w: string) => (cyr ? latinToCyrillic(w) : w)
  // First pass: which rendering each segment uses, per term.
  type Use = { index: number; segmentId: string; kind: 'preferred' | 'alternative' | 'none'; alternative?: string }
  const uses = new Map<string, Use[]>()
  segments.forEach((s, i) => {
    const text = stripMarkup(targetText(s, profile))
    if (!text.trim()) return
    const source = stripMarkup(s.source)
    for (const term of terms) {
      if (!findTerm(source, term.sourceTerm, { wholeWord: term.wholeWord, caseSensitive: term.caseSensitive }).length) continue
      const alternative = containsStem(text, script(term.targetTerm)) ? undefined : (term.alternatives ?? []).map(script).find((a) => containsStem(text, a))
      const kind: Use['kind'] = containsStem(text, script(term.targetTerm)) ? 'preferred' : alternative ? 'alternative' : 'none'
      uses.set(term.id, [...(uses.get(term.id) ?? []), { index: i, segmentId: s.id, kind, alternative }])
    }
  })

  for (const term of terms) {
    const list = uses.get(term.id) ?? []
    const target = script(term.targetTerm)
    const preferredElsewhere = list.some((u) => u.kind === 'preferred')
    for (const u of list) {
      const base = { id: `term:${u.segmentId}:${term.id}`, category: 'terminology' as const, segmentId: u.segmentId, segmentNumber: u.index + 1 }
      if (u.kind === 'none') {
        issues.push({
          ...base,
          check: 'glossary-term',
          severity: 'warning',
          title: L('Terminology not followed'),
          message: L('Source contains "{sourceTerm}" but the translation does not use "{target}".', { sourceTerm: term.sourceTerm, target }),
          suggestion: term.notes ? `${term.notes}` : L('Use "{target}" (in the correct grammatical form).', { target }),
        })
      } else if (u.kind === 'alternative') {
        issues.push({
          ...base,
          check: preferredElsewhere ? 'term-inconsistent' : 'term-alternative',
          // Mixing renderings in one project is a consistency problem; an accepted alternative alone is only a hint.
          severity: preferredElsewhere ? 'warning' : 'suggestion',
          title: preferredElsewhere ? L('Inconsistent terminology') : L('Alternative term used'),
          message: preferredElsewhere
            ? L('"{alternative}" is used for "{sourceTerm}" here, but "{target}" elsewhere in this project.', { alternative: u.alternative ?? '', sourceTerm: term.sourceTerm, target })
            : L('"{alternative}" is an accepted alternative for "{sourceTerm}"; the preferred term is "{target}".', { alternative: u.alternative ?? '', sourceTerm: term.sourceTerm, target }),
          suggestion: L('Use "{target}" for consistency, or keep the alternative if it fits better here.', { target }),
        })
      }
    }
  }
  return issues.sort((a, b) => (a.segmentNumber ?? 0) - (b.segmentNumber ?? 0))
}

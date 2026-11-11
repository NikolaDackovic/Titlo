/**
 * Unicode-aware term matching.
 *
 * JavaScript's `\b` is ASCII-only, so "\bvoz\b" would match inside "vožnja"-like
 * words with diacritics. We use explicit letter/number lookarounds instead.
 */

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface TermMatch {
  start: number
  end: number
  text: string
}

export interface MatchOptions {
  wholeWord: boolean
  caseSensitive: boolean
}

export function buildTermRegExp(term: string, options: MatchOptions): RegExp {
  // Allow flexible whitespace inside multi-word terms.
  const body = term
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s+')
  const pattern = options.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body
  return new RegExp(pattern, options.caseSensitive ? 'gu' : 'giu')
}

export function findTerm(text: string, term: string, options: MatchOptions): TermMatch[] {
  if (!term.trim()) return []
  const re = buildTermRegExp(term, options)
  const matches: TermMatch[] = []
  for (const m of text.matchAll(re)) {
    matches.push({ start: m.index!, end: m.index! + m[0].length, text: m[0] })
  }
  return matches
}

/** Re-apply the casing pattern of `original` to `replacement` (VOZ→VLAK, Voz→Vlak, voz→vlak). */
export function matchCase(original: string, replacement: string): string {
  const letters = original.replace(/[^\p{L}]/gu, '')
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    return replacement.toUpperCase()
  }
  const first = original.match(/\p{L}/u)?.[0]
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  }
  return replacement
}

/** Is the match at the start of a sentence (so capitalisation does not imply a proper noun)? */
export function isSentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/(<[^>]+>|\{\\[^}]*\})/g, '').trimEnd()
  if (!before) return true
  return /[.!?…:"„“»«\-–—]$/.test(before) || before.endsWith('\n')
}

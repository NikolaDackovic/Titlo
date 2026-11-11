import { stripMarkup } from '../../formats/markup'
import { targetText, type QcInput, type QcIssue } from '../types'
import { t as L } from '../../i18n'

/** Short function words that should not end a line (they belong with the next word). */
const DANGLING = new Set([
  'i', 'a', 'u', 'na', 'za', 'od', 'do', 'sa', 's', 'iz', 'po', 'o', 'k', 'ka', 'kod', 'pred', 'da', 'ali', 'ili', 'ni', 'pa', 'te',
  'the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'at',
  'и', 'а', 'у', 'на', 'за', 'од', 'до', 'са', 'с', 'из', 'по', 'о', 'к', 'да', 'али', 'или',
])

export const visibleLength = (text: string) => stripMarkup(text).replace(/\n/g, '').length

export function checkReadability(input: QcInput): QcIssue[] {
  const { segments, profile, qcProfile: p } = input
  const issues: QcIssue[] = []

  segments.forEach((s, i) => {
    const text = targetText(s, profile)
    if (!text.trim()) return
    const n = i + 1
    const base = { segmentId: s.id, segmentNumber: n, category: 'readability' as const }
    const lines = stripMarkup(text).split('\n')

    lines.forEach((line, k) => {
      if (line.length > p.maxCharsPerLine) {
        issues.push({ ...base, id: `cpl:${s.id}:${k}`, check: 'chars-per-line', severity: 'warning', title: L('Line too long'), message: L('Line {v} of segment {n} has {length} characters (max {maxCharsPerLine}).', { v: k + 1, n, length: line.length, maxCharsPerLine: p.maxCharsPerLine }), suggestion: L('Break the line or shorten the wording.') })
      }
    })
    if (lines.length > p.maxLines) {
      issues.push({ ...base, id: `lines:${s.id}`, check: 'max-lines', severity: 'error', title: L('Too many lines'), message: L('Segment {n} has {length} lines (max {maxLines}).', { n, length: lines.length, maxLines: p.maxLines }), suggestion: L('Split the segment into two subtitles.') })
    }

    const chars = visibleLength(text)
    const seconds = (s.end - s.start) / 1000
    if (seconds > 0) {
      const cps = chars / seconds
      if (cps > p.maxCps * 1.25) {
        issues.push({ ...base, id: `cps:${s.id}`, check: 'cps', severity: 'error', title: L('Reading speed far too high'), message: L('Segment {n}: {toFixed} characters per second (max {maxCps}).', { n, toFixed: cps.toFixed(1), maxCps: p.maxCps }), suggestion: L('Condense the text or extend the duration.') })
      } else if (cps > p.maxCps) {
        issues.push({ ...base, id: `cps:${s.id}`, check: 'cps', severity: 'warning', title: L('Reading speed too high'), message: L('Segment {n}: {toFixed} characters per second (max {maxCps}).', { n, toFixed: cps.toFixed(1), maxCps: p.maxCps }), suggestion: L('Condense the text or extend the duration.') })
      }
      const words = stripMarkup(text).split(/\s+/).filter(Boolean).length
      const wpm = (words / seconds) * 60
      if (words >= 4 && wpm > p.maxWpm) {
        issues.push({ ...base, id: `wpm:${s.id}`, check: 'wpm', severity: 'suggestion', title: L('High words per minute'), message: L('Segment {n}: {wpm} words per minute (guideline {maxWpm}).', { n, wpm: Math.round(wpm), maxWpm: p.maxWpm }), suggestion: L('Consider condensing the dialogue.') })
      }
    }

    if (lines.length === 2) {
      const [a, b] = lines
      const lastWord = a.trim().split(/\s+/).pop()?.toLowerCase() ?? ''
      if (DANGLING.has(lastWord)) {
        issues.push({ ...base, id: `brk:${s.id}`, check: 'line-break', severity: 'suggestion', title: L('Awkward line break'), message: L('Line 1 of segment {n} ends with "{lastWord}".', { n, lastWord }), suggestion: L('Move the short word to the next line so it stays with the phrase it belongs to.') })
      } else if (Math.min(a.length, b.length) > 0 && Math.max(a.length, b.length) > 3 * Math.min(a.length, b.length) && a.length + b.length > p.maxCharsPerLine) {
        issues.push({ ...base, id: `bal:${s.id}`, check: 'line-balance', severity: 'suggestion', title: L('Unbalanced lines'), message: L('Segment {n} has very uneven line lengths ({length} / {length2}).', { n, length: a.length, length2: b.length }), suggestion: L('Re-break the text so the lines have similar length.') })
      }
    }
  })
  return issues
}

import { targetText, type QcInput, type QcIssue } from '../types'
import { t as L } from '../../i18n'

const countMatches = (text: string, re: RegExp) => (text.match(re) ?? []).length

export function checkFormatting(input: QcInput): QcIssue[] {
  const issues: QcIssue[] = []
  input.segments.forEach((s, i) => {
    const text = targetText(s, input.profile)
    if (!text) return
    const n = i + 1
    const base = { segmentId: s.id, segmentNumber: n, category: 'formatting' as const }

    for (const tag of ['i', 'b', 'u']) {
      const open = countMatches(text, new RegExp(`<${tag}>`, 'gi'))
      const close = countMatches(text, new RegExp(`</${tag}>`, 'gi'))
      if (open !== close) {
        issues.push({ ...base, id: `tag:${s.id}:${tag}`, check: 'unbalanced-tag', severity: 'warning', title: L('Unbalanced formatting tag'), message: L('Segment {n} has {open} <{tag}> and {close} </{tag}>.', { n, open, tag, close }), suggestion: L('Close every <{tag}> tag in the same segment.', { tag }) })
      }
    }
    if (countMatches(text, /\{/g) !== countMatches(text, /\}/g)) {
      issues.push({ ...base, id: `brace:${s.id}`, check: 'unbalanced-override', severity: 'warning', title: L('Broken ASS override block'), message: L('Segment {n} has unmatched "{" or "}".', { n }), suggestion: L('Fix the override block, e.g. {\\i1}.') })
    }
    if (/ {2,}/.test(text)) {
      issues.push({ ...base, id: `space:${s.id}`, check: 'double-space', severity: 'suggestion', title: L('Double space'), message: L('Segment {n} contains repeated spaces.', { n }), suggestion: L('Replace with a single space.') })
    }
    if (/^\s|\s$/m.test(text)) {
      issues.push({ ...base, id: `trim:${s.id}`, check: 'whitespace', severity: 'suggestion', title: L('Leading/trailing spaces'), message: L('A line in segment {n} starts or ends with a space.', { n }), suggestion: L('Trim the line.') })
    }
    if (/\s[,.!?;:]/.test(text.replace(/\s\.\.\./g, ''))) {
      issues.push({ ...base, id: `pspace:${s.id}`, check: 'space-before-punctuation', severity: 'suggestion', title: L('Space before punctuation'), message: L('Segment {n} has a space before a punctuation mark.', { n }), suggestion: L('Remove the space.') })
    }
    if (/^-[^\s-]/m.test(text) && text.includes('\n')) {
      issues.push({ ...base, id: `dash:${s.id}`, check: 'dialogue-dash', severity: 'suggestion', title: L('Dialogue dash spacing'), message: L('Segment {n} uses dialogue dashes without a space.', { n }), suggestion: L('Use "- " consistently at the start of each speaker line.') })
    }
  })
  return issues
}

/**
 * chrF (Popović 2015): character n-gram F-score, n = 1..6, β = 2, whitespace ignored.
 * Same definition as sacreBLEU's default chrF; values are on a 0–100 scale.
 * This is an automatic metric only — it does not measure naturalness or regional fit.
 */
const ORDER = 6
const BETA = 2

const ngrams = (text: string, n: number) => {
  const chars = [...text.replace(/\s+/g, '')]
  const counts = new Map<string, number>()
  for (let i = 0; i + n <= chars.length; i += 1) {
    const g = chars.slice(i, i + n).join('')
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  return counts
}

interface Stats {
  match: number[]
  hyp: number[]
  ref: number[]
}

function stats(hypothesis: string, reference: string): Stats {
  const s: Stats = { match: [], hyp: [], ref: [] }
  for (let n = 1; n <= ORDER; n += 1) {
    const h = ngrams(hypothesis, n)
    const r = ngrams(reference, n)
    let match = 0
    for (const [g, c] of h) match += Math.min(c, r.get(g) ?? 0)
    s.match.push(match)
    s.hyp.push([...h.values()].reduce((a, b) => a + b, 0))
    s.ref.push([...r.values()].reduce((a, b) => a + b, 0))
  }
  return s
}

function fromStats(s: Stats): number {
  let precision = 0
  let recall = 0
  let effective = 0
  for (let n = 0; n < ORDER; n += 1) {
    if (s.hyp[n] === 0 && s.ref[n] === 0) continue
    effective += 1
    precision += s.hyp[n] ? s.match[n] / s.hyp[n] : 0
    recall += s.ref[n] ? s.match[n] / s.ref[n] : 0
  }
  if (!effective) return 0
  precision /= effective
  recall /= effective
  if (precision + recall === 0) return 0
  const b2 = BETA * BETA
  return (100 * ((1 + b2) * precision * recall)) / (b2 * precision + recall)
}

export const sentenceChrf = (hypothesis: string, reference: string) => fromStats(stats(hypothesis, reference))

/** Corpus-level chrF: statistics are summed over all sentences before computing F. */
export function corpusChrf(pairs: Array<{ hypothesis: string; reference: string }>): number {
  const total: Stats = { match: Array(ORDER).fill(0), hyp: Array(ORDER).fill(0), ref: Array(ORDER).fill(0) }
  for (const p of pairs) {
    const s = stats(p.hypothesis, p.reference)
    for (let n = 0; n < ORDER; n += 1) {
      total.match[n] += s.match[n]
      total.hyp[n] += s.hyp[n]
      total.ref[n] += s.ref[n]
    }
  }
  return fromStats(total)
}

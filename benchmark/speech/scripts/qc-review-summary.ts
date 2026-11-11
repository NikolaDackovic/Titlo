/**
 * Summarize the manual QC review of one benchmark run.
 *
 *   npm run benchmark:speech:qc-summary -- <run-id>
 *
 * Reads results/<run-id>/qc-review.csv (filled in by a person: rating = correct / false / missed / n/a,
 * plus own rows with kind=missed) and writes a NEW file qc-review-summary-<time>.json/.md next to it.
 * Results and earlier summaries are never overwritten. QC thresholds are NOT changed by this.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseReview, summarizeReview } from './lib/realWorld'

const runId = process.argv[2]
const dir = path.resolve(process.argv.includes('--results-dir') ? process.argv[process.argv.indexOf('--results-dir') + 1] : 'benchmark/speech/results', runId ?? '')
const file = path.join(dir, 'qc-review.csv')
if (!runId || !existsSync(file)) {
  console.error(`✗ ${runId ? `${file} not found (run the benchmark with --qc first)` : 'usage: npm run benchmark:speech:qc-summary -- <run-id>'}`)
  process.exit(1)
}
const { rows, errors } = parseReview(readFileSync(file, 'utf8'))
if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'))
  process.exit(1)
}
const summary = summarizeReview(rows)
const pct = (x: number | null) => (x === null ? '–' : `${(100 * x).toFixed(0)} %`)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const md = [
  `# Ručna ocena QC upozorenja — ${runId}`,
  '',
  `Ocenjeno: ${new Date().toISOString()}. Ovo je ocena jedne osobe na malom broju snimaka; pragovi QC-a se na osnovu toga ne menjaju.`,
  '',
  `| Upozorenja | Tačna | Lažna | Ne može se proceniti | Neocenjena | Udeo tačnih (od ocenjenih) | Propušteni problemi | Odbačeni kandidati |`,
  '|---|---|---|---|---|---|---|---|',
  `| ${summary.warnings} | ${summary.correct} | ${summary.falseAlarms} | ${summary.notAssessable} | ${summary.unrated} | ${pct(summary.precision)} | ${summary.missedProblems} | ${summary.candidatesRejected} |`,
  '',
  '| Provera | Tačna | Lažna | n/a | Neocenjena | Udeo tačnih |',
  '|---|---|---|---|---|---|',
  ...Object.entries(summary.byCheck).map(([k, c]) => `| \`${k}\` | ${c.correct} | ${c.false} | ${c.na} | ${c.unrated} | ${pct(c.precision)} |`),
  '',
].join('\n')
writeFileSync(path.join(dir, `qc-review-summary-${stamp}.json`), JSON.stringify({ runId, reviewedFile: 'qc-review.csv', createdAt: new Date().toISOString(), ...summary }, null, 2))
writeFileSync(path.join(dir, `qc-review-summary-${stamp}.md`), md)
console.log(md)

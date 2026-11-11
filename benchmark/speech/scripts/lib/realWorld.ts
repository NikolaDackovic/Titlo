/**
 * Real-world speech benchmark: pure helpers (validation, QC review, summaries, Markdown report).
 * No I/O here, so everything is unit-tested (src/benchmark/speech/realWorld.test.ts).
 */
import { aggregate, normalizedText, renderDiff, scoreSample, wordAlignment, type AlignmentStep, type ErrorCounts, type SampleScore } from '../../../../src/benchmark/speech/metrics'

export const REAL_LANGUAGES = ['sr', 'hr', 'bs'] as const
export type RealLanguage = (typeof REAL_LANGUAGES)[number]
export const LANGUAGE_NAME: Record<string, string> = { sr: 'srpski', hr: 'hrvatski', bs: 'bosanski', en: 'engleski' }
/** Formats the app's browser decoder handles (src/media/types.ts MEDIA_EXTENSIONS). */
export const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.webm', '.mp4', '.mov', '.mkv']

// ---------------------------------------------------------------- adding samples

export interface RealSampleInput {
  id: string
  language: string
  audio: string
  reference: string
  qualityNote: string
  contentType: string
  notes: string
  source: string
  license: string
  confirmReference: boolean
}

export function validateRealSample(input: RealSampleInput, existingIds: string[], replace: boolean): string[] {
  const errors: string[] = []
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(input.id)) errors.push('--id: 2–64 characters, letters, digits, ".", "_" or "-".')
  if (existingIds.includes(input.id) && !replace) errors.push(`--id "${input.id}" already exists (use --replace to update it; the previous dataset version is kept in datasets/history/).`)
  if (!(REAL_LANGUAGES as readonly string[]).includes(input.language)) errors.push('--language must be sr, hr or bs (Serbian, Croatian, Bosnian).')
  const ext = input.audio.slice(input.audio.lastIndexOf('.')).toLowerCase()
  if (!AUDIO_EXTENSIONS.includes(ext)) errors.push(`Unsupported audio format "${ext}". Supported: ${AUDIO_EXTENSIONS.join(', ')}.`)
  if (!input.reference.trim()) errors.push('The reference text is empty (--reference-file or --reference-text).')
  else if (input.reference.trim().split(/\s+/).length < 5) errors.push('The reference has fewer than 5 words; WER on so little text is meaningless.')
  if (!input.qualityNote.trim()) errors.push('--quality is required (e.g. "phone, quiet room" or "podcast mic, music in background").')
  if (!input.contentType.trim()) errors.push('--content-type is required (e.g. podcast, interview, vlog, film, news, own-recording).')
  if (!input.license.trim()) errors.push('--license is required: state why you may use this recording for testing (e.g. "own recording").')
  return errors
}

export interface PreviousHypothesis {
  runId: string
  model: string
  hypothesis: string
}

/**
 * Guard: a reference must never be Whisper output. Compares the reference with every earlier
 * hypothesis for the same audio file. Returns the closest one if it is (nearly) identical.
 */
export function findWhisperLikeReference(reference: string, previous: PreviousHypothesis[]): (PreviousHypothesis & { wer: number }) | null {
  let best: (PreviousHypothesis & { wer: number }) | null = null
  for (const p of previous) {
    if (!p.hypothesis?.trim()) continue
    const wer = normalizedText(reference) === normalizedText(p.hypothesis) ? 0 : (scoreSample(reference, p.hypothesis).normalized.wer.rate ?? 1)
    if (!best || wer < best.wer) best = { ...p, wer }
  }
  return best && best.wer <= 0.02 ? best : null
}

export function bumpVersion(version: string): string {
  const [major, minor] = version.split('.').map((x) => Number(x) || 0)
  return `${major}.${minor + 1}.0`
}

// ---------------------------------------------------------------- results

export interface SegmentRecord {
  start: number
  end: number
  text: string
}

export interface QcIssueRecord {
  id: string
  check: string
  severity: string
  /** 0-based index in segmentList, null for issues about a gap. */
  segmentIndex: number | null
  startMs: number | null
  endMs: number | null
  title: string
  message: string
}

export interface MissedCandidate {
  segmentIndex: number
  startMs: number
  endMs: number
  text: string
  errors: number
  referenceWords: number
  diff: string
}

/** Minimal shape of a per-sample result (written by run-asr-benchmark.ts). */
export interface BenchResult {
  model: string
  modelRevision?: string | null
  id: string
  language: string | null
  realWorld?: boolean
  audioMs: number | null
  transcribeMs: number | null
  rtf: number | null
  hypothesis: string | null
  reference?: string | null
  score: SampleScore | null
  error: string | null
  detection: { status: string; language: string | null; probability: number; groups?: { en: number; sh: number; other: number } } | null
  diff?: string | null
  strictDiff?: string | null
  qcIssues?: QcIssueRecord[] | null
  qcMissedCandidates?: MissedCandidate[] | null
  segmentList?: SegmentRecord[] | null
  contentType?: string
  qualityNote?: string
}

/**
 * Which segment produced each normalized hypothesis word. Null when the per-segment
 * normalization does not add up to the whole text (then no segment attribution is made).
 */
export function hypothesisWordSegments(segments: SegmentRecord[]): number[] | null {
  const map: number[] = []
  segments.forEach((s, i) => {
    const words = normalizedText(s.text).split(' ').filter(Boolean)
    for (let k = 0; k < words.length; k += 1) map.push(i)
  })
  const whole = normalizedText(segments.map((s) => s.text).join(' ')).split(' ').filter(Boolean)
  return whole.length === map.length ? map : null
}

/**
 * Segments with many recognition errors that QC did NOT warn about: candidates for
 * "QC missed a problem". A person still decides (qc-review.csv); this is only a list to check.
 * Threshold: ≥ 3 word errors and ≥ 30 % of the reference words aligned to that segment.
 */
export function missedCandidates(segments: SegmentRecord[], reference: string, issues: QcIssueRecord[]): MissedCandidate[] | null {
  const map = hypothesisWordSegments(segments)
  if (!map || !segments.length) return null
  const steps = wordAlignment(reference, segments.map((s) => s.text).join(' '))
  const perSeg = segments.map(() => ({ errors: 0, ref: 0, steps: [] as AlignmentStep[] }))
  let h = 0
  let current = 0
  for (const st of steps) {
    if (st.op !== 'del') {
      current = map[h] ?? current
      h += 1
    }
    const bucket = perSeg[current]
    bucket.steps.push(st)
    if (st.op !== 'ins') bucket.ref += 1
    if (st.op !== 'ok') bucket.errors += 1
  }
  const warned = new Set(issues.filter((i) => i.segmentIndex !== null && i.severity !== 'suggestion').map((i) => i.segmentIndex))
  return perSeg
    .map((b, i) => ({ b, i }))
    .filter(({ b, i }) => b.errors >= 3 && b.errors / Math.max(1, b.ref) >= 0.3 && !warned.has(i))
    .map(({ b, i }) => ({ segmentIndex: i, startMs: segments[i].start, endMs: segments[i].end, text: segments[i].text, errors: b.errors, referenceWords: b.ref, diff: renderDiff(b.steps) }))
}

// ---------------------------------------------------------------- QC review (manual)

export const REVIEW_HEADER = ['run_id', 'model', 'sample_id', 'kind', 'issue_id', 'check', 'segment', 'start_s', 'end_s', 'text', 'message', 'rating', 'comment']
/** correct = justified warning; false = false alarm; missed = a real problem QC did not flag; n/a = cannot assess. */
export const RATINGS = ['correct', 'false', 'missed', 'n/a'] as const
export type Rating = (typeof RATINGS)[number]
const RATING_ALIASES: Record<string, Rating> = {
  correct: 'correct', tacno: 'correct', 'tačno': 'correct', true: 'correct',
  false: 'false', lazno: 'false', 'lažno': 'false',
  missed: 'missed', propusteno: 'missed', 'propušteno': 'missed', propusten: 'missed', 'propušten': 'missed',
  'n/a': 'n/a', na: 'n/a', 'ne-moze': 'n/a', 'ne može': 'n/a', nepoznato: 'n/a',
}

const sec = (ms: number | null | undefined) => (ms === null || ms === undefined ? '' : (ms / 1000).toFixed(2))

export function reviewTemplateRows(runId: string, results: BenchResult[]): string[][] {
  const rows: string[][] = [REVIEW_HEADER]
  for (const r of results) {
    for (const i of r.qcIssues ?? []) {
      const seg = i.segmentIndex !== null ? r.segmentList?.[i.segmentIndex] : null
      rows.push([runId, r.model, r.id, 'warning', i.id, i.check, i.segmentIndex === null ? '' : String(i.segmentIndex + 1), sec(i.startMs), sec(i.endMs), seg?.text ?? '', i.message, '', ''])
    }
    for (const c of r.qcMissedCandidates ?? []) {
      rows.push([runId, r.model, r.id, 'missed-candidate', '', '', String(c.segmentIndex + 1), sec(c.startMs), sec(c.endMs), c.text, `${c.errors} word errors / ${c.referenceWords} reference words: ${c.diff}`, '', ''])
    }
  }
  return rows
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : /[",\n\r;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\r\n') + '\r\n'
}

/** RFC 4180 CSV (comma or semicolon, as Excel saves it in Serbian locale). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const first = text.split('\n')[0] ?? ''
  const delimiter = (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

export interface ReviewRow {
  model: string
  sampleId: string
  kind: string
  check: string
  rating: Rating | null
  raw: string
}

export function parseReview(csv: string): { rows: ReviewRow[]; errors: string[] } {
  const table = parseCsv(csv)
  const errors: string[] = []
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  for (const name of ['model', 'sample_id', 'kind', 'rating']) if (col(name) < 0) errors.push(`Missing column "${name}".`)
  if (errors.length) return { rows: [], errors }
  const rows = table.slice(1).map((r, k) => {
    const raw = (r[col('rating')] ?? '').trim()
    const rating = raw ? (RATING_ALIASES[raw.toLowerCase()] ?? null) : null
    if (raw && !rating) errors.push(`Row ${k + 2}: unknown rating "${raw}" (use correct, false, missed or n/a).`)
    const kind = (r[col('kind')] ?? '').trim()
    if (rating === 'missed' && kind === 'warning') errors.push(`Row ${k + 2}: "missed" is for problems QC did not flag; rate a warning as correct, false or n/a.`)
    return { model: r[col('model')] ?? '', sampleId: r[col('sample_id')] ?? '', kind, check: col('check') >= 0 ? (r[col('check')] ?? '') : '', rating, raw }
  })
  return { rows, errors }
}

export function summarizeReview(rows: ReviewRow[]) {
  const warnings = rows.filter((r) => r.kind === 'warning')
  const byCheck: Record<string, { correct: number; false: number; na: number; unrated: number; precision: number | null }> = {}
  for (const w of warnings) {
    const c = (byCheck[w.check || '?'] ??= { correct: 0, false: 0, na: 0, unrated: 0, precision: null })
    if (w.rating === 'correct') c.correct += 1
    else if (w.rating === 'false') c.false += 1
    else if (w.rating === 'n/a') c.na += 1
    else c.unrated += 1
  }
  for (const c of Object.values(byCheck)) c.precision = c.correct + c.false ? c.correct / (c.correct + c.false) : null
  const correct = warnings.filter((w) => w.rating === 'correct').length
  const falseAlarms = warnings.filter((w) => w.rating === 'false').length
  return {
    warnings: warnings.length,
    correct,
    falseAlarms,
    notAssessable: warnings.filter((w) => w.rating === 'n/a').length,
    unrated: warnings.filter((w) => w.rating === null).length,
    /** Share of rated warnings that were justified. Null until something is rated. */
    precision: correct + falseAlarms ? correct / (correct + falseAlarms) : null,
    missedProblems: rows.filter((r) => r.rating === 'missed').length,
    candidatesRejected: rows.filter((r) => r.kind === 'missed-candidate' && r.rating === 'false').length,
    byCheck,
  }
}

// ---------------------------------------------------------------- summaries and report

export interface GroupSummary {
  samples: number
  scored: number
  failed: number
  audioSeconds: number
  strict: { wer: ErrorCounts; cer: ErrorCounts }
  normalized: { wer: ErrorCounts; cer: ErrorCounts }
  transcribeSeconds: number
  rtf: number | null
}

export function summarizeGroup(rows: BenchResult[]): GroupSummary {
  const scored = rows.filter((r) => r.score)
  const pick = (view: 'strict' | 'normalized', kind: 'wer' | 'cer') => aggregate(scored.map((r) => r.score![view][kind]))
  const timed = rows.filter((r) => r.transcribeMs !== null && !r.error && r.audioMs)
  const audio = timed.reduce((s, r) => s + (r.audioMs ?? 0), 0)
  const time = timed.reduce((s, r) => s + (r.transcribeMs ?? 0), 0)
  return {
    samples: rows.length,
    scored: scored.length,
    failed: rows.filter((r) => r.error).length,
    audioSeconds: Math.round(scored.reduce((s, r) => s + (r.audioMs ?? 0), 0) / 100) / 10,
    strict: { wer: pick('strict', 'wer'), cer: pick('strict', 'cer') },
    normalized: { wer: pick('normalized', 'wer'), cer: pick('normalized', 'cer') },
    transcribeSeconds: Math.round(time / 100) / 10,
    rtf: audio ? Math.round((time / audio) * 1000) / 1000 : null,
  }
}

const pct = (c: ErrorCounts) => (c.rate === null ? '–' : `${(100 * c.rate).toFixed(1)} %`)
const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const shortModel = (m: string) => m.replace(/^.*whisper-/, 'whisper-')
const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export interface ReportContext {
  runId: string
  date: string
  command: string
  datasets: Array<{ name: string; version: string; sha256: string; samples: number }>
  models: Array<{ modelId: string; revision: string | null; skipped?: string; memoryPressure?: string }>
  config: Record<string, unknown>
  hardware: Record<string, unknown>
}

/** Markdown report. Every aggregate shows how many samples and how much audio it is based on. */
export function renderReport(ctx: ReportContext, results: BenchResult[]): string {
  const real = results.filter((r) => r.realWorld)
  const synthetic = results.filter((r) => !r.realWorld)
  const L: string[] = []
  L.push(`# Speech benchmark ${ctx.runId}`, '')
  L.push(`Datum: ${ctx.date}  `, `Komanda: \`${ctx.command}\`  `)
  L.push(`Dataseti: ${ctx.datasets.map((d) => `${d.name}@${d.version} (${d.samples} uzoraka, sha256 ${d.sha256.slice(0, 12)}…)`).join('; ')}  `)
  L.push(`Modeli: ${ctx.models.map((m) => `${m.modelId}@${m.revision?.slice(0, 8) ?? '?'}${m.skipped ? ` — PRESKOČEN: ${m.skipped}` : ''}${m.memoryPressure && m.memoryPressure !== 'no' ? ` — ${m.memoryPressure}` : ''}`).join('; ')}  `)
  L.push(`Hardver: ${cell(ctx.hardware.cpu)}, ${cell(ctx.hardware.totalPhysicalMb)} MB RAM  `, '')
  L.push(`Uzorci: ${real.length ? `**${new Set(real.map((r) => r.id)).size} stvarnih ljudskih snimaka**` : '**nijedan stvaran ljudski snimak**'}${synthetic.length ? `, ${new Set(synthetic.map((r) => r.id)).size} sintetičkih/ostalih (prikazani odvojeno)` : ''}.`, '')
  if (!results.some((r) => r.score)) L.push('> Nijedan uzorak nema potvrđenu referencu: WER/CER nije izračunat. Prikazan je samo izlaz.', '')

  const table = (title: string, rows: BenchResult[], key: (r: BenchResult) => string) => {
    if (!rows.length) return
    const groups = new Map<string, BenchResult[]>()
    for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r])
    L.push(`## ${title}`, '')
    L.push('| Grupa | Model | Uzoraka (sa WER) | Audio | WER strogo | WER norm. | CER strogo | CER norm. | S / D / I (norm.) | N reči | RTF |')
    L.push('|---|---|---|---|---|---|---|---|---|---|---|')
    for (const [k, list] of [...groups].sort()) {
      const byModel = new Map<string, BenchResult[]>()
      for (const r of list) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r])
      for (const [m, mr] of byModel) {
        const s = summarizeGroup(mr)
        const w = s.normalized.wer
        L.push(`| ${cell(k)} | ${shortModel(m)} | ${s.samples} (${s.scored}) | ${dur(s.audioSeconds)} | ${pct(s.strict.wer)} | ${pct(w)} | ${pct(s.strict.cer)} | ${pct(s.normalized.cer)} | ${w.substitutions} / ${w.deletions} / ${w.insertions} | ${w.n} | ${s.rtf ?? '–'} |`)
      }
    }
    L.push('', 'WER/CER su korpusni: zbir grešaka / zbir referentnih reči (znakova) u grupi, ne prosek procenata.', '')
  }
  table('Stvarni snimci po jeziku', real, (r) => LANGUAGE_NAME[r.language ?? ''] ?? String(r.language))
  table('Stvarni snimci ukupno', real, () => 'svi stvarni')
  table('Sintetički / ostali uzorci (nisu ljudski govor)', synthetic, (r) => LANGUAGE_NAME[r.language ?? ''] ?? String(r.language))

  if (results.length) {
    L.push('## Po snimku', '')
    L.push('| Snimak | Model | Naveden jezik | Whisper prepoznao | Audio | Vreme | RTF | WER strogo / norm. | CER strogo / norm. | S/D/I | Pismo se razlikuje | QC upozorenja | Kandidati za propušteno |')
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (const r of results) {
      const d = r.detection
      const det = d ? `${d.status === 'detected' ? (d.language ?? '?') : d.status} ${(100 * d.probability).toFixed(0)} %${d.groups ? ` (sr/hr/bs ${(100 * d.groups.sh).toFixed(0)} %)` : ''}` : '–'
      const s = r.score
      L.push(
        `| ${cell(r.id)}${r.realWorld ? '' : ' (sint.)'} | ${shortModel(r.model)} | ${r.language ?? '–'} | ${det} | ${r.audioMs ? dur(r.audioMs / 1000) : '–'} | ${r.transcribeMs !== null ? `${(r.transcribeMs / 1000).toFixed(1)} s` : '–'} | ${r.rtf ?? '–'} | ${s ? `${pct(s.strict.wer)} / ${pct(s.normalized.wer)}` : '–'} | ${s ? `${pct(s.strict.cer)} / ${pct(s.normalized.cer)}` : '–'} | ${s ? `${s.normalized.wer.substitutions}/${s.normalized.wer.deletions}/${s.normalized.wer.insertions}` : '–'} | ${s ? (s.scriptDiffers ? '**da**' : 'ne') : '–'} | ${r.qcIssues ? r.qcIssues.length : '–'} | ${r.qcMissedCandidates ? r.qcMissedCandidates.length : '–'} |${r.error ? ` greška: ${cell(r.error)}` : ''}`,
      )
    }
    L.push('')
  }

  const withText = results.filter((r) => r.hypothesis !== null)
  if (withText.length) {
    L.push('## Razlike (referenca → Whisper)', '', 'Normalizovan prikaz: `[ref→hyp]` zamena, `[-ref-]` izostavljeno, `[+hyp+]` dodato. Strogi prikaz (velika slova, interpunkcija, pismo) je u `samples.json` (`strictDiff`).', '')
    for (const r of withText) {
      L.push(`### ${r.id} · ${shortModel(r.model)}`, '')
      if (r.diff) L.push('```text', r.diff, '```', '')
      else L.push('Izlaz (bez reference):', '', '```text', r.hypothesis ?? '', '```', '')
      if (r.qcIssues?.length) {
        L.push('QC upozorenja:', '')
        for (const i of r.qcIssues) L.push(`- \`${i.check}\` ${i.segmentIndex !== null ? `#${i.segmentIndex + 1}` : 'praznina'} ${i.startMs !== null ? `(${sec(i.startMs)}–${sec(i.endMs)} s)` : ''}: ${cell(i.message)}`)
        L.push('')
      }
      if (r.qcMissedCandidates?.length) {
        L.push('Mnogo grešaka bez QC upozorenja (kandidati; oceniti u `qc-review.csv`):', '')
        for (const c of r.qcMissedCandidates) L.push(`- #${c.segmentIndex + 1} (${sec(c.startMs)}–${sec(c.endMs)} s), ${c.errors} grešaka: ${cell(c.diff)}`)
        L.push('')
      }
    }
  }
  L.push('## Ručna ocena QC upozorenja', '', 'Popunite kolonu `rating` u `qc-review.csv` (correct / false / missed / n/a), dodajte redove `kind=missed` za probleme koje QC nije označio, pa pokrenite:', '', '```powershell', `npm run benchmark:speech:qc-summary -- ${ctx.runId}`, '```', '')
  return L.join('\n')
}

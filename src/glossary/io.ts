import { isProfileId, isSourceLanguage } from '../domain/languages'
import { joinAlternatives, splitAlternatives, type GlossaryTermInput, type ProfileScope } from './types'

/** RFC 4180 CSV parsing with auto-detected delimiter (`,` `;` or tab). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const firstLine = text.split('\n')[0] ?? ''
  const counts = { ',': 0, ';': 0, '\t': 0 } as Record<string, number>
  let quoted = false
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch in counts) counts[ch] += 1
  }
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ','

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') inQuotes = true
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
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const csvEscape = (value: string) => (/[",;\n\r\t]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export const CSV_COLUMNS = [
  'source_term',
  'target_term',
  'kind',
  'source_language',
  'target_profile',
  'notes',
  'context',
  'case_sensitive',
  'whole_word',
  'priority',
  'enabled',
  'alternatives',
  'category',
] as const

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value.trim() === '') return fallback
  return ['1', 'true', 'yes', 'da', 'y'].includes(value.trim().toLowerCase())
}

export interface TermImportResult {
  terms: GlossaryTermInput[]
  errors: string[]
}

function normalizeTerm(raw: Record<string, unknown>, rowLabel: string, errors: string[]): GlossaryTermInput | null {
  const str = (k: string) => (raw[k] === undefined || raw[k] === null ? '' : String(raw[k]))
  const sourceTerm = str('source_term') || str('sourceTerm') || str('source')
  const targetTerm = str('target_term') || str('targetTerm') || str('target')
  if (!sourceTerm.trim() || !targetTerm.trim()) {
    errors.push(`${rowLabel}: source and target term are required.`)
    return null
  }
  const kindRaw = (str('kind') || 'terminology').trim()
  const kind = kindRaw === 'localization' ? 'localization' : 'terminology'
  const langRaw = (str('source_language') || str('sourceLanguage') || (kind === 'localization' ? 'sr' : 'en')).trim()
  if (!isSourceLanguage(langRaw)) {
    errors.push(`${rowLabel}: unknown source language "${langRaw}" (use en, sr, hr or bs).`)
    return null
  }
  const profileRaw = (str('target_profile') || str('targetProfile') || 'all').trim()
  if (profileRaw !== 'all' && !isProfileId(profileRaw)) {
    errors.push(`${rowLabel}: unknown profile "${profileRaw}" (use all, exyu-neutral, sr-Latn, sr-Cyrl, hr, bs or en).`)
    return null
  }
  const priority = Number(str('priority') || 0)
  const asBool = (k: string, alt: string, fallback: boolean) =>
    typeof raw[k] === 'boolean' ? (raw[k] as boolean) : typeof raw[alt] === 'boolean' ? (raw[alt] as boolean) : toBool(str(k) || str(alt), fallback)
  return {
    kind,
    sourceTerm: sourceTerm.trim(),
    targetTerm: targetTerm.trim(),
    sourceLanguage: langRaw,
    targetProfile: profileRaw as ProfileScope,
    notes: str('notes'),
    context: str('context'),
    caseSensitive: asBool('case_sensitive', 'caseSensitive', false),
    wholeWord: asBool('whole_word', 'wholeWord', true),
    priority: Number.isFinite(priority) ? priority : 0,
    enabled: asBool('enabled', 'enabled', true),
    alternatives: Array.isArray(raw.alternatives) ? (raw.alternatives as unknown[]).map(String).map((a) => a.trim()).filter(Boolean) : splitAlternatives(str('alternatives')),
    category: str('category').trim(),
  }
}

export function importTermsCsv(input: string): TermImportResult {
  const rows = parseCsv(input)
  const errors: string[] = []
  if (!rows.length) return { terms: [], errors: ['The CSV file is empty.'] }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const hasHeader = header.includes('source_term') || header.includes('source')
  const columns = hasHeader ? header : ['source_term', 'target_term', 'notes']
  const terms: GlossaryTermInput[] = []
  rows.slice(hasHeader ? 1 : 0).forEach((row, index) => {
    const record: Record<string, unknown> = {}
    columns.forEach((c, k) => (record[c] = row[k]))
    const term = normalizeTerm(record, `Row ${index + (hasHeader ? 2 : 1)}`, errors)
    if (term) terms.push(term)
  })
  return { terms, errors }
}

export function importTermsJson(input: string): TermImportResult {
  const errors: string[] = []
  let data: unknown
  try {
    data = JSON.parse(input.replace(/^﻿/, ''))
  } catch (e) {
    return { terms: [], errors: [`Invalid JSON: ${(e as Error).message}`] }
  }
  const list = Array.isArray(data) ? data : (data as { terms?: unknown })?.terms
  if (!Array.isArray(list)) return { terms: [], errors: ['Expected an array of terms or an object with a "terms" array.'] }
  const terms: GlossaryTermInput[] = []
  list.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) {
      errors.push(`Item ${index + 1}: not an object.`)
      return
    }
    const term = normalizeTerm(item as Record<string, unknown>, `Item ${index + 1}`, errors)
    if (term) terms.push(term)
  })
  return { terms, errors }
}

export function exportTermsCsv(terms: GlossaryTermInput[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const t of terms) {
    lines.push(
      [
        t.sourceTerm,
        t.targetTerm,
        t.kind,
        t.sourceLanguage,
        t.targetProfile,
        t.notes,
        t.context,
        String(t.caseSensitive),
        String(t.wholeWord),
        String(t.priority),
        String(t.enabled),
        joinAlternatives(t.alternatives ?? []),
        t.category ?? '',
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}

export function exportTermsJson(name: string, terms: GlossaryTermInput[]): string {
  // Import accepts any "format" value, so files exported by older versions still load.
  return JSON.stringify({ format: 'titlo-terminology', version: 2, name, terms }, null, 2)
}

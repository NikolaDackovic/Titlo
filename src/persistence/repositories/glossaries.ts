import { isProfileId, isSourceLanguage } from '../../domain/languages'
import { newId, nowIso } from '../../domain/types'
import { joinAlternatives, splitAlternatives, type Glossary, type GlossaryTerm, type GlossaryTermInput, type ProfileScope } from '../../glossary/types'
import type { AppDatabase, Row } from '../database'

const scope = (v: unknown): ProfileScope => (v === 'all' || !isProfileId(v) ? 'all' : v)

const rowToGlossary = (r: Row): Glossary & { isGlobal: boolean } => ({
  id: String(r.id),
  name: String(r.name),
  description: String(r.description ?? ''),
  profile: scope(r.language_profile),
  enabled: Number(r.enabled) === 1,
  isGlobal: Number(r.is_global) === 1,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
})

const rowToTerm = (r: Row): GlossaryTerm => ({
  id: String(r.id),
  glossaryId: String(r.glossary_id),
  kind: r.kind === 'localization' ? 'localization' : 'terminology',
  sourceTerm: String(r.source_term),
  targetTerm: String(r.target_term),
  sourceLanguage: isSourceLanguage(r.source_language) ? r.source_language : 'en',
  targetProfile: scope(r.target_profile),
  notes: String(r.notes ?? ''),
  context: String(r.context ?? ''),
  caseSensitive: Number(r.case_sensitive) === 1,
  wholeWord: Number(r.whole_word) === 1,
  priority: Number(r.priority ?? 0),
  enabled: Number(r.enabled) === 1,
  alternatives: splitAlternatives(String(r.alternatives ?? '')),
  category: String(r.category ?? ''),
})

export type GlossaryRecord = ReturnType<typeof rowToGlossary>

export class GlossaryRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): GlossaryRecord[] {
    return this.db.all('SELECT * FROM glossaries ORDER BY name COLLATE NOCASE').map(rowToGlossary)
  }

  create(input: { name: string; description?: string; profile?: ProfileScope; isGlobal?: boolean }): GlossaryRecord {
    const now = nowIso()
    const id = newId()
    this.db.run('INSERT INTO glossaries (id, name, description, language_profile, enabled, is_global, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)', [
      id, input.name.trim() || 'Untitled glossary', input.description ?? '', input.profile ?? 'all', input.isGlobal === false ? 0 : 1, now, now,
    ])
    return this.list().find((g) => g.id === id)!
  }

  update(id: string, patch: Partial<Pick<GlossaryRecord, 'name' | 'description' | 'profile' | 'enabled' | 'isGlobal'>>) {
    const current = this.list().find((g) => g.id === id)
    if (!current) throw new Error('Glossary not found')
    const next = { ...current, ...patch }
    this.db.run('UPDATE glossaries SET name=?, description=?, language_profile=?, enabled=?, is_global=?, updated_at=? WHERE id=?', [
      next.name, next.description, next.profile, next.enabled ? 1 : 0, next.isGlobal ? 1 : 0, nowIso(), id,
    ])
  }

  delete(id: string) {
    this.db.run('DELETE FROM glossaries WHERE id = ?', [id])
  }

  terms(glossaryId?: string): GlossaryTerm[] {
    return (glossaryId
      ? this.db.all('SELECT * FROM glossary_terms WHERE glossary_id = ? ORDER BY source_term COLLATE NOCASE', [glossaryId])
      : this.db.all('SELECT * FROM glossary_terms')
    ).map(rowToTerm)
  }

  addTerms(glossaryId: string, terms: GlossaryTermInput[]): number {
    this.db.transaction(() => {
      this.db.runMany(
        `INSERT INTO glossary_terms (id, glossary_id, kind, source_term, target_term, source_language, target_profile, notes, context, case_sensitive, whole_word, priority, enabled, alternatives, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        terms.map((t) => [newId(), glossaryId, t.kind, t.sourceTerm, t.targetTerm, t.sourceLanguage, t.targetProfile, t.notes, t.context, t.caseSensitive ? 1 : 0, t.wholeWord ? 1 : 0, t.priority, t.enabled ? 1 : 0, joinAlternatives(t.alternatives ?? []), t.category ?? '']),
      )
      this.db.run('UPDATE glossaries SET updated_at = ? WHERE id = ?', [nowIso(), glossaryId])
    })
    return terms.length
  }

  updateTerm(term: GlossaryTerm) {
    this.db.run(
      `UPDATE glossary_terms SET kind=?, source_term=?, target_term=?, source_language=?, target_profile=?, notes=?, context=?, case_sensitive=?, whole_word=?, priority=?, enabled=?, alternatives=?, category=? WHERE id=?`,
      [term.kind, term.sourceTerm, term.targetTerm, term.sourceLanguage, term.targetProfile, term.notes, term.context, term.caseSensitive ? 1 : 0, term.wholeWord ? 1 : 0, term.priority, term.enabled ? 1 : 0, joinAlternatives(term.alternatives ?? []), term.category ?? '', term.id],
    )
  }

  deleteTerm(id: string) {
    this.db.run('DELETE FROM glossary_terms WHERE id = ?', [id])
  }

  // --- project assignment ----------------------------------------------------
  assignedTo(projectId: string): string[] {
    return this.db.all('SELECT glossary_id FROM project_glossaries WHERE project_id = ?', [projectId]).map((r) => String(r.glossary_id))
  }

  setAssigned(projectId: string, glossaryId: string, assigned: boolean) {
    if (assigned) this.db.run('INSERT OR IGNORE INTO project_glossaries (project_id, glossary_id) VALUES (?, ?)', [projectId, glossaryId])
    else this.db.run('DELETE FROM project_glossaries WHERE project_id = ? AND glossary_id = ?', [projectId, glossaryId])
  }

  /** Glossaries that apply to a project: enabled AND (global OR assigned). */
  forProject(projectId: string): { glossaries: GlossaryRecord[]; terms: GlossaryTerm[] } {
    const assigned = new Set(this.assignedTo(projectId))
    const glossaries = this.list().filter((g) => g.enabled && (g.isGlobal || assigned.has(g.id)))
    const ids = new Set(glossaries.map((g) => g.id))
    return { glossaries, terms: this.terms().filter((t) => ids.has(t.glossaryId)) }
  }
}

import { AlertTriangle, BookText, Download, Info, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useServices } from '../../app/services'
import { getProfile, SOURCE_LANGUAGES } from '../../domain/languages'
import { exportTermsCsv, exportTermsJson, importTermsCsv, importTermsJson } from '../../glossary/io'
import { findGlossaryConflicts } from '../../glossary/rules'
import { emptyTerm, joinAlternatives, splitAlternatives, type GlossaryTerm, type GlossaryTermInput, type ProfileScope } from '../../glossary/types'
import { SEED_TERMBASE } from '../../localization/termbase'
import { pickFile, readFileText, saveFile } from '../../platform/files'
import { reportError } from '../../services/errors'
import { notify } from '../../services/notifications'
import { Field, ProfileSelect } from '../components/Field'
import { ConfirmDialog, Modal } from '../components/Modal'
import { t as L, useT } from '../../i18n'

const scopeLabel = (s: ProfileScope) => (s === 'all' ? L('All profiles') : L(getProfile(s).label))

function TermDialog({ initial, onSave, onClose }: { initial: GlossaryTermInput; onSave: (t: GlossaryTermInput) => void; onClose: () => void }) {
  useT()
  const [t, setT] = useState(initial)
  const set = <K extends keyof GlossaryTermInput>(k: K, v: GlossaryTermInput[K]) => setT((x) => ({ ...x, [k]: v }))
  const [alternatives, setAlternatives] = useState(joinAlternatives(initial.alternatives ?? []))
  const valid = t.sourceTerm.trim() && t.targetTerm.trim()
  return (
    <Modal
      title={initial.sourceTerm ? L('Edit term') : L('Add term')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{L('Cancel')}</button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave({ ...t, sourceTerm: t.sourceTerm.trim(), targetTerm: t.targetTerm.trim(), alternatives: t.kind === 'terminology' ? splitAlternatives(alternatives) : [], category: (t.category ?? '').trim() })}>{L('Save')}</button>
        </>
      }
    >
      <div className="grid-2">
        <Field label={L('Rule type')} hint={t.kind === 'terminology' ? L('The source term must be translated as the target term (checked by quality control).') : L('A replacement suggested in the subtitle text (e.g. voz → vlak for Croatian).')}>
          <select className="select" value={t.kind} onChange={(e) => set('kind', e.target.value as GlossaryTermInput['kind'])}>
            <option value="terminology">{L('Terminology (source → target)')}</option>
            <option value="localization">{L('Regional replacement (in the subtitle)')}</option>
          </select>
        </Field>
        <Field label={t.kind === 'terminology' ? L('Source language') : L('Language of the term')}>
          <select className="select" value={t.sourceLanguage} onChange={(e) => set('sourceLanguage', e.target.value as GlossaryTermInput['sourceLanguage'])}>
            {SOURCE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{L(l.label)}</option>)}
          </select>
        </Field>
        <Field label={L('Source term')}>
          <input className="input" value={t.sourceTerm} onChange={(e) => set('sourceTerm', e.target.value)} autoFocus />
        </Field>
        <Field label={t.kind === 'terminology' ? L('Preferred translation') : L('Target term')}>
          <input className="input" value={t.targetTerm} onChange={(e) => set('targetTerm', e.target.value)} />
        </Field>
        {t.kind === 'terminology' && (
          <Field label={L('Alternative translations')} hint={L('Accepted but not preferred, separated by |. Example: auto | kola')}>
            <input className="input" value={alternatives} onChange={(e) => setAlternatives(e.target.value)} />
          </Field>
        )}
        <Field label={L('Category')} hint={L('Optional grouping, e.g. Names, Technology, Medicine.')}>
          <input className="input" value={t.category ?? ''} onChange={(e) => set('category', e.target.value)} />
        </Field>
        <Field label={L('Language profile')}>
          <ProfileSelect value={t.targetProfile} includeAll onChange={(v) => set('targetProfile', v)} />
        </Field>
        <Field label={L('Priority')} hint={L('Higher wins when rules overlap.')}>
          <input className="input" type="number" value={t.priority} onChange={(e) => set('priority', Number(e.target.value) || 0)} />
        </Field>
        <Field label={L('Context')} hint={t.kind === 'localization' ? L('Exceptions: phrases where the rule must not apply, as "!Phrase", separated by |. Example: !Voz Express|!Vozdovac') : L('When to use this term (free text).')}>
          <input className="input" value={t.context} onChange={(e) => set('context', e.target.value)} />
        </Field>
        <Field label={L('Notes')}>
          <input className="input" value={t.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      <div className="row wrap">
        <label className="check"><input type="checkbox" checked={t.wholeWord} onChange={(e) => set('wholeWord', e.target.checked)} /> {L('Whole word')}</label>
        <label className="check"><input type="checkbox" checked={t.caseSensitive} onChange={(e) => set('caseSensitive', e.target.checked)} /> {L('Match case')}</label>
        <label className="check"><input type="checkbox" checked={t.enabled} onChange={(e) => set('enabled', e.target.checked)} /> {L('Enabled')}</label>
      </div>
    </Modal>
  )
}

export function GlossaryManager({ projectId }: { projectId: string | null }) {
  useT()
  const { glossaries: repo, projects } = useServices()
  const [version, setVersion] = useState(0)
  const refresh = () => setVersion((v) => v + 1)
  const glossaries = useMemo(() => repo.list(), [repo, version])
  const allTerms = useMemo(() => repo.terms(), [repo, version])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const current = glossaries.find((g) => g.id === selectedId) ?? glossaries[0] ?? null
  const terms = allTerms.filter((t) => t.glossaryId === current?.id).sort((a, b) => a.sourceTerm.localeCompare(b.sourceTerm))
  const [editing, setEditing] = useState<{ term: GlossaryTerm | null } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [query, setQuery] = useState('')
  const project = projectId ? projects.getDoc(projectId)?.project ?? null : null
  const assigned = useMemo(() => new Set(projectId ? repo.assignedTo(projectId) : []), [repo, projectId, version])
  const conflicts = useMemo(() => findGlossaryConflicts(glossaries, allTerms, SEED_TERMBASE), [glossaries, allTerms])
  const conflictIds = new Set(conflicts.filter((c) => c.severity === 'warning').flatMap((c) => c.termIds))
  const visibleTerms = terms.filter((t) => !query || `${t.sourceTerm} ${t.targetTerm} ${t.notes}`.toLowerCase().includes(query.toLowerCase()))

  const act = (label: string, fn: () => void) => {
    try {
      fn()
      refresh()
    } catch (error) {
      reportError(label, error)
    }
  }

  const importFile = async () => {
    if (!current) return
    const file = await pickFile(['.csv', '.json', '.tsv', '.txt'])
    if (!file) return
    try {
      const text = await readFileText(file.file)
      const result = file.name.toLowerCase().endsWith('.json') ? importTermsJson(text) : importTermsCsv(text)
      if (result.terms.length) repo.addTerms(current.id, result.terms)
      refresh()
      notify(result.errors.length ? 'warning' : 'success', L('Imported {n} term(s) into "{name}"', { n: result.terms.length, name: current.name }), result.errors.length ? L('{n} row(s) were rejected:', { n: result.errors.length }) : undefined, result.errors)
    } catch (error) {
      reportError(L('Import failed'), error)
    }
  }

  const exportAs = async (kind: 'csv' | 'json') => {
    if (!current) return
    const base = current.name.replace(/[<>:"/\\|?*]/g, '_')
    const data = terms.map(({ id: _id, glossaryId: _g, ...rest }) => rest)
    if (kind === 'csv') await saveFile(`${base}.csv`, '﻿' + exportTermsCsv(data), 'text/csv;charset=utf-8')
    else await saveFile(`${base}.json`, exportTermsJson(current.name, data), 'application/json')
  }

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>{L('Terminology')}</h1>
            <div className="muted">{L('Preferred translations of terms and regional replacement rules, in term lists. They take priority over the built-in regional dictionary, and quality control checks that they are used consistently.')}</div>
          </div>
          <span className="spacer" />
          <button className="btn primary" onClick={() => act(L('Could not create the term list'), () => setSelectedId(repo.create({ name: `${L('Term list')} ${glossaries.length + 1}` }).id))}>
            <Plus size={14} /> {L('New term list')}
          </button>
        </div>

        <div className="two-col">
          <div className="panel">
            <div className="panel-head"><span className="panel-title">{L('Term lists')}</span></div>
            <div className="panel-body col" style={{ gap: 2 }}>
              {glossaries.length === 0 && <p className="small muted">{L('No term lists yet.')}</p>}
              {glossaries.map((g) => (
                <div key={g.id} className={`list-item${g.id === current?.id ? ' active' : ''}`} onClick={() => setSelectedId(g.id)}>
                  <BookText size={14} className={g.enabled ? '' : 'subtle'} />
                  <div className="grow">
                    <div className={`small ellipsis${g.enabled ? '' : ' subtle'}`}>{g.name}</div>
                    <div className="tiny subtle">
                      {L('{n} terms', { n: allTerms.filter((t) => t.glossaryId === g.id).length })} · {g.isGlobal ? L('all projects') : L('assigned projects')}
                      {!g.enabled && ` · ${L('disabled')}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {current ? (
            <div className="col" style={{ gap: 12, minWidth: 0 }}>
              <div className="card col">
                <div className="grid-3">
                  <Field label={L('Name')}>
                    <input className="input" defaultValue={current.name} key={`n-${current.id}`} onBlur={(e) => e.target.value.trim() && act(L('Rename failed'), () => repo.update(current.id, { name: e.target.value.trim() }))} />
                  </Field>
                  <Field label={L('Profile')}>
                    <ProfileSelect value={current.profile} includeAll onChange={(v) => act(L('Update failed'), () => repo.update(current.id, { profile: v }))} />
                  </Field>
                  <Field label={L('Description')}>
                    <input className="input" defaultValue={current.description} key={`d-${current.id}`} onBlur={(e) => act(L('Update failed'), () => repo.update(current.id, { description: e.target.value }))} />
                  </Field>
                </div>
                <div className="row wrap">
                  <label className="check"><input type="checkbox" checked={current.enabled} onChange={(e) => act(L('Update failed'), () => repo.update(current.id, { enabled: e.target.checked }))} /> {L('Enabled')}</label>
                  <label className="check"><input type="checkbox" checked={current.isGlobal} onChange={(e) => act(L('Update failed'), () => repo.update(current.id, { isGlobal: e.target.checked }))} /> {L('Use in all projects')}</label>
                  {project && !current.isGlobal && (
                    <label className="check">
                      <input type="checkbox" checked={assigned.has(current.id)} onChange={(e) => act(L('Update failed'), () => repo.setAssigned(project.id, current.id, e.target.checked))} /> {L('Assigned to "{name}"', { name: project.name })}
                    </label>
                  )}
                  {!project && !current.isGlobal && <span className="tiny muted">{L('Open a project to assign this term list to it.')}</span>}
                  <span className="spacer" />
                  <button className="btn sm" onClick={() => void importFile()}><Upload size={13} /> {L('Import CSV/JSON')}</button>
                  <button className="btn sm" onClick={() => void exportAs('csv')} disabled={!terms.length}><Download size={13} /> CSV</button>
                  <button className="btn sm" onClick={() => void exportAs('json')} disabled={!terms.length}><Download size={13} /> JSON</button>
                  <button className="btn sm danger" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> {L('Delete')}</button>
                </div>
              </div>

              {conflicts.length > 0 && (
                <div className={`callout ${conflicts.some((c) => c.severity === 'warning') ? 'warn' : 'info'}`}>
                  {conflicts.some((c) => c.severity === 'warning') ? <AlertTriangle size={16} /> : <Info size={16} />}
                  <div className="small">
                    <strong>{L('{n} rule interaction(s) across enabled term lists', { n: conflicts.length })}</strong>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16, maxHeight: 120, overflow: 'auto' }}>
                      {conflicts.slice(0, 20).map((c, i) => <li key={i}>{c.message}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              <div className="panel">
                <div className="panel-head">
                  <span className="panel-title">{L('Terms ({n})', { n: terms.length })}</span>
                  <input className="input" style={{ width: 220, height: 30 }} placeholder={L('Filter…')} aria-label={L('Filter…')} value={query} onChange={(e) => setQuery(e.target.value)} />
                  <span className="spacer" />
                  <button className="btn sm primary" onClick={() => setEditing({ term: null })}><Plus size={13} /> {L('Add term')}</button>
                </div>
                {terms.length === 0 ? (
                  <div className="empty small">
                    <p>{L('No terms. Add one or import a CSV with the columns')} <span className="mono">source_term, target_term, kind, source_language, target_profile, notes, context, case_sensitive, whole_word, priority, enabled, alternatives, category</span> {L('(comma or semicolon separated).')}</p>
                  </div>
                ) : (
                  <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr><th>{L('Source')}</th><th>{L('Preferred')}</th><th>{L('Type')}</th><th>{L('Profile')}</th><th>{L('Options')}</th><th>{L('Notes')}</th><th /></tr>
                      </thead>
                      <tbody>
                        {visibleTerms.map((t) => (
                          <tr key={t.id} style={{ opacity: t.enabled ? 1 : 0.5 }}>
                            <td>
                              <strong>{t.sourceTerm}</strong> <span className="tiny subtle">{t.sourceLanguage}</span>
                              {conflictIds.has(t.id) && <AlertTriangle size={12} color="var(--warn)" style={{ marginLeft: 4 }} />}
                            </td>
                            <td>
                              {t.targetTerm}
                              {(t.alternatives ?? []).length > 0 && <div className="tiny subtle">{L('also')}: {(t.alternatives ?? []).join(', ')}</div>}
                            </td>
                            <td><span className={`badge ${t.kind === 'localization' ? 'blue' : 'accent'}`}>{t.kind === 'localization' ? L('regional') : L('terminology')}</span></td>
                            <td className="small">{scopeLabel(t.targetProfile)}</td>
                            <td className="tiny muted">{[t.wholeWord && L('whole word'), t.caseSensitive && L('case'), t.priority && `${L('priority')} ${t.priority}`].filter(Boolean).join(' · ')}</td>
                            <td className="small muted">{t.category && <span className="badge" style={{ marginRight: 4 }}>{t.category}</span>}{t.notes}{t.context && <div className="tiny subtle">{t.context}</div>}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button className="btn ghost icon sm" onClick={() => setEditing({ term: t })} aria-label={L('Edit')}><Pencil size={13} /></button>
                              <button className="btn ghost icon sm danger" onClick={() => act(L('Delete failed'), () => repo.deleteTerm(t.id))} aria-label={L('Delete')}><Trash2 size={13} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card empty">
              <h3>{L('No term list selected')}</h3>
              <p className="small">{L('Create a term list to add terms.')}</p>
            </div>
          )}
        </div>
      </div>

      {editing && current && (
        <TermDialog
          initial={editing.term ? { ...editing.term } : { ...emptyTerm(), targetProfile: current.profile }}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            act(L('Could not save the term'), () => {
              if (editing.term) repo.updateTerm({ ...editing.term, ...input })
              else repo.addTerms(current.id, [input])
              setEditing(null)
            })
          }
        />
      )}
      {confirmDelete && current && (
        <ConfirmDialog
          title={L('Delete term list?')}
          message={L('"{name}" and its {n} term(s) will be deleted.', { name: current.name, n: terms.length })}
          confirmLabel={L('Delete')}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => act(L('Delete failed'), () => (repo.delete(current.id), setSelectedId(null), setConfirmDelete(false)))}
        />
      )}
    </div>
  )
}

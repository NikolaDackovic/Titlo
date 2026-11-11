import { AlertCircle, ArrowLeft, Check, CheckCircle2, CircleDot, Download, Globe2, Languages, LoaderCircle, Mic, PanelRight, Redo2, Save, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSaveState } from '../../app/useSaveState'
import { isAdaptation, type ProfileId } from '../../domain/languages'
import { CONTENT_TYPES, type Project } from '../../domain/types'
import { useT } from '../../i18n'
import { summarize, type QcIssue } from '../../qc'
import { CONTENT_ICON } from '../components/contentIcons'
import { ProfileSelect } from '../components/Field'

interface Props {
  project: Project
  canUndo: boolean
  canRedo: boolean
  jobRunning: boolean
  transcribing: boolean
  issues: QcIssue[]
  onBack: () => void
  onRename: (name: string) => void
  onProfile: (p: ProfileId) => void
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onTranscribe: () => void
  onTranslate: () => void
  onExport: () => void
  onShowQc: () => void
  inspectorOpen?: boolean
  onToggleInspector?: () => void
}

export function StudioToolbar(p: Props) {
  const t = useT()
  const save = useSaveState()
  const [name, setName] = useState(p.project.name)
  useEffect(() => setName(p.project.name), [p.project.name])
  const qc = summarize(p.issues)
  const Icon = CONTENT_ICON[p.project.contentType]
  const sameLanguage = isAdaptation(p.project.sourceLanguage, p.project.activeProfile)

  return (
    <header className="topbar">
      <div className="tb-group">
        <button className="tbtn" onClick={p.onBack} title={t('Back to home')} aria-label={t('Back to home')}><ArrowLeft size={17} /></button>
        <Icon size={15} className="tb-ctype" aria-hidden />
        <input className="tb-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== p.project.name && p.onRename(name.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={t('Project name')} title={t(CONTENT_TYPES.find((c) => c.id === p.project.contentType)?.label ?? '')} />
        <span className={`tb-save ${save.status}`} title={save.error ?? undefined} aria-live="polite">
          {save.status === 'saved' && <><CheckCircle2 size={13} /> <span>{t('Saved')}</span></>}
          {save.status === 'unsaved' && <><CircleDot size={13} /> <span>{t('Unsaved')}</span></>}
          {save.status === 'saving' && <><LoaderCircle size={13} className="spin" /> <span>{t('Saving…')}</span></>}
          {save.status === 'error' && <><AlertCircle size={13} /> <span>{t('Save failed')}</span></>}
        </span>
      </div>
      <div className="tb-group tb-history">
        <button className="tbtn" onClick={p.onUndo} disabled={!p.canUndo} title={t('Undo (Ctrl+Z)')} aria-label={t('Undo (Ctrl+Z)')}><Undo2 size={16} /></button>
        <button className="tbtn" onClick={p.onRedo} disabled={!p.canRedo} title={t('Redo (Ctrl+Y)')} aria-label={t('Redo (Ctrl+Y)')}><Redo2 size={16} /></button>
        <button className="tbtn" onClick={p.onSave} title={t('Save now (Ctrl+S)')} aria-label={t('Save now (Ctrl+S)')}><Save size={15} /></button>
      </div>
      <span className="spacer" />
      <label className="tb-profile" title={t('Subtitles in')}>
        <Globe2 size={14} aria-hidden />
        <ProfileSelect value={p.project.activeProfile} onChange={(v) => p.onProfile(v as ProfileId)} />
      </label>
      <button className="tb-qc" onClick={p.onShowQc} title={t('Quality control')} aria-label={t('Quality control')}>
        {qc.error > 0 && <span className="pill err">{qc.error}</span>}
        {qc.warning > 0 && <span className="pill warn">{qc.warning}</span>}
        {qc.error + qc.warning === 0 && <span className="pill ok"><Check size={12} /></span>}
      </button>
      <div className="tb-group tb-actions">
        <button className="btn sm" onClick={p.onTranscribe} disabled={p.transcribing} title={t('Speech → subtitles')}>
          {p.transcribing ? <LoaderCircle size={14} className="spin" /> : <Mic size={14} />} <span className="tb-label">{t('Transcribe')}</span>
        </button>
        <button className="btn sm" onClick={p.onTranslate} disabled={p.jobRunning}>
          {p.jobRunning ? <LoaderCircle size={14} className="spin" /> : <Languages size={14} />} <span className="tb-label">{sameLanguage ? t('Adapt') : t('Translate')}</span>
        </button>
        {p.onToggleInspector && (
          <button className={`tbtn tb-inspector${p.inspectorOpen ? ' on' : ''}`} onClick={p.onToggleInspector} title={t('Inspector')} aria-label={t('Inspector')} aria-pressed={p.inspectorOpen}><PanelRight size={16} /></button>
        )}
        <button className="btn sm primary" onClick={p.onExport} title={t('Export (Ctrl+E)')}>
          <Download size={14} /> <span>{t('Export')}</span>
        </button>
      </div>
    </header>
  )
}

import { BookText, CheckCircle2, Cpu, FilePlus2, FileText, FolderOpen, LoaderCircle, Mic, Trash2, XCircle } from 'lucide-react'
import { CONTENT_ICON } from '../components/contentIcons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Navigation } from '../../app/App'
import { useServices } from '../../app/services'
import { useSettings } from '../../app/settingsContext'
import { getProfile, sourceLanguageLabel } from '../../domain/languages'
import { CONTENT_TYPES, type ProjectSummary } from '../../domain/types'
import { useT } from '../../i18n'
import { WHISPER_MODELS } from '../../media/types'
import { reportError } from '../../services/errors'
import { notify } from '../../services/notifications'
import { createProvider, PROVIDER_OPTIONS } from '../../translation/registry'
import type { ProviderAvailability } from '../../translation/types'
import { ConfirmDialog } from '../components/Modal'
import { NewProjectDialog, type Workflow } from './NewProjectDialog'


const relative = (iso: string | null, locale: string) => {
  if (!iso) return '—'
  const diff = (Date.now() - Date.parse(iso)) / 1000
  const rtf = new Intl.RelativeTimeFormat(locale === 'sr' ? 'sr-Latn' : 'en', { numeric: 'auto' })
  if (diff < 60) return rtf.format(-Math.round(diff), 'second')
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute')
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour')
  return rtf.format(-Math.round(diff / 86400), 'day')
}

function EngineRow({ label, state }: { label: string; state: ProviderAvailability | 'checking' | null }) {
  const t = useT()
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      {state === 'checking' ? <LoaderCircle size={16} className="spin" /> : state?.available ? <CheckCircle2 size={16} color="var(--ok)" /> : <XCircle size={16} color="var(--warn)" />}
      <div className="grow">
        <div className="small" style={{ fontWeight: 600 }}>{label}</div>
        <div className="tiny muted">{state === 'checking' ? t('Checking…') : state?.available ? t('Installed and ready to load') : t('Not installed — see Models')}</div>
      </div>
    </div>
  )
}

export function Dashboard({ nav }: { nav: Navigation }) {
  const t = useT()
  const { projects, db, providerDeps, transcription } = useServices()
  const { settings } = useSettings()
  const [version, setVersion] = useState(0)
  const [dialog, setDialog] = useState<Workflow | null>(null)
  const [toDelete, setToDelete] = useState<ProjectSummary | null>(null)
  const [translationState, setTranslationState] = useState<ProviderAvailability | 'checking' | null>(null)
  const [speechState, setSpeechState] = useState<ProviderAvailability | 'checking' | null>(null)

  const list = useMemo(() => projects.list(), [projects, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const translatedTotal = useMemo(() => projects.translatedSegmentTotal(), [projects, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const runtimeMinutes = list.reduce((sum, p) => sum + p.runtimeMs, 0) / 60000
  const lastUsed = list.find((p) => p.lastOpenedAt)

  const checkEngines = useCallback(async () => {
    setTranslationState('checking')
    setSpeechState('checking')
    try {
      setTranslationState(await createProvider(settings.translation, providerDeps).checkAvailability())
    } catch (error) {
      setTranslationState({ available: false, message: (error as Error).message })
    }
    try {
      setSpeechState(await transcription.checkModel(settings.transcription.modelId))
    } catch (error) {
      setSpeechState({ available: false, message: (error as Error).message })
    }
  }, [providerDeps, settings.transcription.modelId, settings.translation, transcription])

  useEffect(() => {
    void checkEngines()
  }, [checkEngines])

  const remove = async (p: ProjectSummary) => {
    try {
      await db.backup(`before deleting project "${p.name}"`)
      projects.delete(p.id)
      await db.flush()
      notify('success', t('Project deleted'), t('"{name}" was deleted. A backup taken just before deletion is available in Settings.', { name: p.name }))
      setVersion((v) => v + 1)
    } catch (error) {
      reportError(t('Could not delete the project'), error)
    } finally {
      setToDelete(null)
    }
  }

  const providerLabel = PROVIDER_OPTIONS.find((p) => p.id === settings.translation.providerId)?.label ?? ''
  const whisperLabel = WHISPER_MODELS.find((m) => m.id === settings.transcription.modelId)?.label ?? settings.transcription.modelId

  return (
    <div className="page">
      <div className="page-inner">
        <section className="hero">
          <h1>
            {t('Subtitles for films, series and podcasts —')} <span className="gradient-text">{t('in the language of the region.')}</span>
          </h1>
          <p>{t('Turn speech into subtitles, translate English to Serbian, Croatian or Bosnian, adapt to ExYu Neutral and check quality. Everything runs on this computer.')}</p>
        </section>

        <section>
          <div className="section-title">{t('What do you want to do?')}</div>
          <div className="workflows">
            <button className="workflow" onClick={() => setDialog('media')}>
              <div className="wf-icon alt"><Mic size={22} /></div>
              <h3>{t('Video or podcast → subtitles')}</h3>
              <p>{t('Upload a video or audio file. Speech is transcribed locally (Whisper) and timed automatically, then translated or adapted.')}</p>
              <div className="wf-tags"><span className="badge">MP4</span><span className="badge">MOV</span><span className="badge">MP3</span><span className="badge">WAV</span><span className="badge">M4A</span></div>
            </button>
            <button className="workflow" onClick={() => setDialog('subtitles')}>
              <div className="wf-icon"><FileText size={22} /></div>
              <h3>{t('I have a subtitle file')}</h3>
              <p>{t('Import SRT, VTT or ASS and translate it from English, or adapt a Serbian/Croatian/Bosnian subtitle to another variant.')}</p>
              <div className="wf-tags"><span className="badge">SRT</span><span className="badge">VTT</span><span className="badge">ASS</span></div>
            </button>
            <button className="workflow" onClick={() => setDialog('empty')}>
              <div className="wf-icon plain"><FilePlus2 size={22} /></div>
              <h3>{t('Empty project')}</h3>
              <p>{t('Write subtitles by hand while watching the video.')}</p>
            </button>
          </div>
        </section>

        <div className="stats">
          <div className="stat"><div className="label">{t('Projects')}</div><div className="value">{list.length}</div></div>
          <div className="stat"><div className="label">{t('Subtitle minutes')}</div><div className="value">{list.length ? runtimeMinutes.toFixed(1) : 0}</div></div>
          <div className="stat"><div className="label">{t('Translated subtitles')}</div><div className="value">{translatedTotal}</div></div>
          <div className="stat"><div className="label">{t('Last used project')}</div><div className="value small ellipsis">{lastUsed ? lastUsed.name : '—'}</div></div>
        </div>

        <div className="dash-grid">
          <div className="panel">
            <div className="panel-head"><span className="panel-title">{t('Recent projects')}</span></div>
            {list.length === 0 ? (
              <div className="empty">
                <div className="empty-icon"><FolderOpen size={24} /></div>
                <h3>{t('No projects yet')}</h3>
                <p className="small">{t('Choose one of the options above to start.')}</p>
              </div>
            ) : (
              <div className="project-cards">
                {list.map((p) => {
                  const Icon = CONTENT_ICON[p.contentType]
                  const pct = p.segmentCount ? Math.round((100 * p.translatedCount) / p.segmentCount) : 0
                  return (
                    <div key={p.id} className="project-card" role="button" tabIndex={0} onClick={() => nav.openProject(p.id)} onKeyDown={(e) => e.key === 'Enter' && nav.openProject(p.id)}>
                      <div className="pc-head">
                        <div className="pc-icon"><Icon size={17} /></div>
                        <div className="grow">
                          <div className="ellipsis" style={{ fontWeight: 650 }}>{p.name}</div>
                          <div className="tiny muted ellipsis">{t(CONTENT_TYPES.find((c) => c.id === p.contentType)?.label ?? '')} · {relative(p.updatedAt, settings.uiLanguage)}</div>
                        </div>
                        <button className="btn ghost icon sm danger" title={t('Delete project')} aria-label={t('Delete project')} onClick={(e) => (e.stopPropagation(), setToDelete(p))}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="tiny muted">{t(sourceLanguageLabel(p.sourceLanguage))} → {t(getProfile(p.activeProfile).label)}</div>
                      <div>
                        <div className="row tiny muted" style={{ justifyContent: 'space-between' }}>
                          <span>{p.segmentCount ? t('{done} of {total} translated', { done: p.translatedCount, total: p.segmentCount }) : t('No subtitles yet')}</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="progress" style={{ marginTop: 5 }}><span style={{ width: `${pct}%` }} /></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="col" style={{ gap: 16 }}>
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">{t('Local AI models')}</span>
                <span className="spacer" />
                <button className="btn sm" onClick={() => nav.go('models')}><Cpu size={13} /> {t('Manage')}</button>
              </div>
              <div className="panel-body col" style={{ gap: 12 }}>
                <EngineRow label={`${t('Speech → text')}: ${whisperLabel}`} state={speechState} />
                <EngineRow label={`${t('Translation')}: ${t(providerLabel)}`} state={translationState} />
                <p className="tiny muted">{t('Models are never downloaded automatically. Nothing is sent to the internet.')}</p>
              </div>
            </div>
            <div className="panel">
              <div className="panel-head"><span className="panel-title">{t('Shortcuts')}</span></div>
              <div className="panel-body col" style={{ gap: 4 }}>
                <button className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => nav.go('glossary')}><BookText size={15} /> {t('Terminology')}</button>
                <button className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => nav.go('settings')}><FolderOpen size={15} /> {t('Backups and data')}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {dialog && <NewProjectDialog workflow={dialog} onClose={() => setDialog(null)} onCreated={(id) => (setDialog(null), nav.openProject(id))} />}
      {toDelete && (
        <ConfirmDialog
          title={t('Delete project?')}
          message={
            <>
              <p>{t('"{name}" and all its translations will be deleted.', { name: toDelete.name })}</p>
              <p className="tiny muted" style={{ marginTop: 6 }}>{t('A database backup is created automatically before deleting, so it can be restored from Settings.')}</p>
            </>
          }
          confirmLabel={t('Delete')}
          danger
          onCancel={() => setToDelete(null)}
          onConfirm={() => void remove(toDelete)}
        />
      )}
    </div>
  )
}

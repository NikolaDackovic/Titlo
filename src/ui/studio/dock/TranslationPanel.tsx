import { History, Info, Languages, LoaderCircle, Mic, Pause, Play, RotateCcw, ShieldCheck, Square, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { getProfile, isAdaptation, sourceLanguageLabel, type ProfileId, type SourceLanguage } from '../../../domain/languages'
import type { Segment, TranslationStatus } from '../../../domain/types'
import { useT } from '../../../i18n'
import { MODEL_PHASE_LABEL, useModelStatus } from '../../../services/modelStatus'
import type { StartOptions } from '../../../state/useTranslationJob'
import type { JobProgress } from '../../../translation/engine'
import { PROVIDER_OPTIONS, type ProviderId } from '../../../translation/registry'

interface Props {
  segments: Segment[]
  profile: ProfileId
  sourceLanguage: SourceLanguage
  providerId: ProviderId
  selected: string[]
  progress: JobProgress | null
  running: boolean
  /** Translations made from an original that changed afterwards. */
  staleIds: string[]
  onRetranslateStale: () => void
  onStart: (o: StartOptions) => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onOpenModels: () => void
  onTranscribe: () => void
}

const STATUSES: TranslationStatus[] = ['not_translated', 'translated', 'needs_review', 'approved', 'failed']

export function TranslationPanel(p: Props) {
  const t = useT()
  const [retranslateMachine, setRetranslateMachine] = useState(false)
  const [overwriteManual, setOverwriteManual] = useState(false)
  const modelStatus = useModelStatus()
  const def = getProfile(p.profile)
  const provider = PROVIDER_OPTIONS.find((x) => x.id === p.providerId)
  const sameLanguage = isAdaptation(p.sourceLanguage, p.profile)

  if (p.segments.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon"><Languages size={24} /></div>
        <h3>{t('There is nothing to translate yet')}</h3>
        <p className="small" style={{ maxWidth: 480 }}>{t('Translation works on subtitles. This project has none — first turn the speech into subtitles (Transcription tab) or import a subtitle file.')}</p>
        <button className="btn primary" onClick={p.onTranscribe}><Mic size={15} /> {t('Go to transcription')}</button>
      </div>
    )
  }

  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TranslationStatus, number>
  let locked = 0
  let test = 0
  for (const s of p.segments) {
    const tr = s.translations[p.profile]
    if (tr?.locked) locked += 1
    if (tr?.origin === 'test') test += 1
    counts[tr?.text.trim() ? tr.status : 'not_translated'] += 1
  }
  const failedIds = p.segments.filter((s) => s.translations[p.profile]?.status === 'failed').map((s) => s.id)
  const pr = p.progress
  const pct = pr && pr.total ? Math.round((100 * (pr.done + pr.failed)) / pr.total) : 0
  const stateLabel: Record<string, string> = { idle: t('Waiting'), running: t('Running'), paused: t('Paused'), cancelled: t('Cancelled'), completed: t('Finished'), failed: t('Failed') }

  return (
    <div className="job">
      <div className="col" style={{ gap: 12 }}>
        <div className="row wrap">
          <strong style={{ fontSize: 15 }}>{t(sourceLanguageLabel(p.sourceLanguage))} → {t(def.label)}</strong>
          <span className="spacer" />
          {!sameLanguage && <button className="btn sm ghost" onClick={p.onOpenModels}>{provider ? t(provider.label) : ''}</button>}
        </div>
        <div className="row wrap small" style={{ gap: 8 }}>
          <ShieldCheck size={14} color="var(--ok)" />
          <span className="muted">{t('Runs locally on this computer.')}</span>
          {!sameLanguage && p.providerId === 'opus-mt-en-sh' && (
            <>
              <span className={`dot ${modelStatus.phase === 'ready' ? 'ok' : modelStatus.phase === 'loading' ? 'warn' : modelStatus.phase === 'error' || modelStatus.phase === 'not-installed' ? 'err' : ''}`} />
              <span>{t(MODEL_PHASE_LABEL[modelStatus.phase])}</span>
            </>
          )}
          {!sameLanguage && p.providerId === 'test' && <span className="badge err">{t('TEST provider — not a real translation')}</span>}
        </div>

        {sameLanguage && (
          <div className="callout info">
            <Info size={16} />
            <div className="small">
              {t('The source is {lang}. The local model translates only from English, so the text is copied as a starting point and the Regional suggestions tab proposes changes for {profile} (e.g. ekavian ↔ ijekavian, voz ↔ vlak). You approve every change.', { lang: t(sourceLanguageLabel(p.sourceLanguage)), profile: t(def.label) })}
            </div>
          </div>
        )}

        <div className="row wrap">
          <button className="btn primary lg" disabled={p.running} onClick={() => p.onStart({ retranslateMachine, overwriteManual })}>
            {sameLanguage ? <Wand2 size={16} /> : <Languages size={16} />} {sameLanguage ? t('Adapt all subtitles') : t('Translate all subtitles')}
          </button>
          <button className="btn" disabled={p.running || p.selected.length === 0} onClick={() => p.onStart({ segmentIds: p.selected, retranslateMachine: true, overwriteManual })}>
            {t('Only selected ({n})', { n: p.selected.length })}
          </button>
          {p.staleIds.length > 0 && (
            <button className="btn" disabled={p.running} onClick={p.onRetranslateStale} title={t('The original changed after these were translated')}>
              <History size={14} /> {sameLanguage ? t('Adapt out-of-date again ({n})', { n: p.staleIds.length }) : t('Translate out-of-date again ({n})', { n: p.staleIds.length })}
            </button>
          )}
          {failedIds.length > 0 && (
            <button className="btn" disabled={p.running} onClick={() => p.onStart({ segmentIds: failedIds })}>
              <RotateCcw size={14} /> {t('Retry failed ({n})', { n: failedIds.length })}
            </button>
          )}
        </div>
        {!sameLanguage && (
          <label className="check small">
            <input type="checkbox" checked={retranslateMachine} onChange={(e) => setRetranslateMachine(e.target.checked)} /> {t('Re-translate existing machine/test output')}
          </label>
        )}
        <label className="check small">
          <input type="checkbox" checked={overwriteManual} onChange={(e) => setOverwriteManual(e.target.checked)} /> {t('Also overwrite my manual edits')}
          {overwriteManual && <span className="badge warn">{t('Manual work will be replaced')}</span>}
        </label>
        <p className="tiny subtle">{t('Locked and approved subtitles are never changed. Every subtitle keeps its own timing.')} {t('If the original has not been reviewed yet, you are asked first.')}</p>
      </div>

      <div className="col" style={{ gap: 10 }}>
        {pr ? (
          <>
            <div className="row">
              {pr.state === 'running' && <LoaderCircle size={15} className="spin" />}
              <strong className="small">{stateLabel[pr.state] ?? pr.state}</strong>
              <span className="small muted">{pr.message}</span>
            </div>
            <div className={`progress${pr.state === 'running' && !pr.total ? ' indeterminate' : ''}`}><span style={{ width: `${pct}%` }} /></div>
            <div className="small muted">
              {t('{done} done · {failed} failed · {remaining} remaining of {total}', { done: pr.done, failed: pr.failed, remaining: Math.max(0, pr.total - pr.done - pr.failed), total: pr.total })}
              {pr.cached ? ` · ${t('{n} from cache', { n: pr.cached })}` : ''} · {t('{n} skipped', { n: pr.skipped })}
            </div>
            {p.running && (
              <div className="row">
                {pr.state === 'paused' ? (
                  <button className="btn sm" onClick={p.onResume}><Play size={13} /> {t('Resume')}</button>
                ) : (
                  <button className="btn sm" onClick={p.onPause}><Pause size={13} /> {t('Pause')}</button>
                )}
                <button className="btn sm danger" onClick={p.onCancel}><Square size={13} /> {t('Cancel')}</button>
                <span className="tiny subtle">{t('Finished subtitles are kept.')}</span>
              </div>
            )}
          </>
        ) : (
          <p className="small muted">{sameLanguage ? t('Adaptation has not been run yet.') : t('No translation is running.')}</p>
        )}
        <div className="row wrap" style={{ marginTop: 4 }}>
          <span className="badge">{t('Not translated')} {counts.not_translated}</span>
          <span className="badge accent">{t('Translated')} {counts.translated}</span>
          <span className="badge warn">{t('Needs review')} {counts.needs_review}</span>
          <span className="badge ok">{t('Approved')} {counts.approved}</span>
          {counts.failed > 0 && <span className="badge err">{t('Failed')} {counts.failed}</span>}
          {locked > 0 && <span className="badge blue">{t('Locked')} {locked}</span>}
          {test > 0 && <span className="badge err">{t('TEST output')} {test}</span>}
          {p.staleIds.length > 0 && <span className="badge warn" title={t('The original changed after these were translated')}><History size={11} /> {t('Out of date')} {p.staleIds.length}</span>}
        </div>
      </div>
    </div>
  )
}

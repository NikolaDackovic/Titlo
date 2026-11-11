import { AlertTriangle, ArrowRight, CheckCircle2, Circle, LoaderCircle, Mic, ShieldAlert, Square, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useServices } from '../../../app/services'
import { useSettings } from '../../../app/settingsContext'
import { SOURCE_LANGUAGES, type SourceLanguage } from '../../../domain/languages'
import { useT } from '../../../i18n'
import type { TranscriptionLanguage } from '../../../media/transcription'
import { WHISPER_MODELS } from '../../../media/types'
import { transcriptionModelStatus } from '../../../services/modelStatus'
import type { TranscriptionStartOptions, TranscriptionState } from '../../../state/useTranscription'
import type { ProviderAvailability } from '../../../translation/types'
import { ConfirmDialog, Modal } from '../../components/Modal'
import type { SessionMedia } from '../mediaStore'

interface Props {
  media: SessionMedia | null
  sourceLanguage: SourceLanguage
  segmentCount: number
  /** Subtitles whose original is verified, manually edited or approved. */
  protectedCount: number
  state: TranscriptionState
  onStart: (language: TranscriptionLanguage, mode: 'replace' | 'append', options?: TranscriptionStartOptions) => void
  onReview: () => void
  onCancel: () => void
  onAttach: () => void
  onNext: () => void
}

const fmt = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function TranscriptionPanel({ media, sourceLanguage, segmentCount, protectedCount, state, onStart, onCancel, onAttach, onNext, onReview }: Props) {
  const t = useT()
  const { transcription } = useServices()
  const { settings, update } = useSettings()
  const [language, setLanguage] = useState<TranscriptionLanguage>(sourceLanguage)
  const [check, setCheck] = useState<ProviderAvailability | null>(null)
  const [confirm, setConfirm] = useState(false)
  const modelStatus = transcriptionModelStatus.useStatus()

  useEffect(() => {
    let cancelled = false
    void transcription.checkModel(settings.transcription.modelId).then((r) => !cancelled && setCheck(r))
    return () => {
      cancelled = true
    }
  }, [settings.transcription.modelId, transcription])

  const p = state.progress
  const running = state.phase === 'running'
  const stages: Array<[string, boolean, boolean]> = [
    [t('Decoding audio'), state.phase === 'done' || Boolean(p && p.stage !== 'decoding'), p?.stage === 'decoding'],
    [t('Loading the model'), state.phase === 'done' || Boolean(p && (p.stage === 'transcribing' || p.stage === 'detecting')), p?.stage === 'loading'],
    ...(language === 'auto' ? [[t('Detecting the language'), state.phase === 'done' || p?.stage === 'transcribing', p?.stage === 'detecting'] as [string, boolean, boolean]] : []),
    [t('Recognising speech'), state.phase === 'done', p?.stage === 'transcribing'],
  ]
  const languageName = (code: string) => {
    const known = SOURCE_LANGUAGES.find((l) => l.id === code)
    return known ? t(known.label) : code.toUpperCase()
  }
  const percent = (x: number) => `${Math.round(x * 100)} %`
  const detection = state.detection
  const reasonText: Record<string, string> = {
    silence: t('No speech was found in the recording (silence or very quiet audio).'),
    'model-no-speech': t('The model did not hear speech (it may be music, noise or silence).'),
    'too-short': t('There is too little speech to decide reliably.'),
    'unsupported-language': t('The recording sounds like a language this app does not support.'),
    'low-probability': t('The model is not sure which language it is.'),
  }
  const pct = p && p.stage === 'transcribing' && p.audioTotalMs ? Math.round((100 * p.audioDoneMs) / p.audioTotalMs) : null

  const begin = () => (segmentCount > 0 ? setConfirm(true) : onStart(language, 'replace'))

  if (!media) {
    return (
      <div className="empty">
        <div className="empty-icon"><Mic size={24} /></div>
        <h3>{t('Attach the video or audio to transcribe it')}</h3>
        <p className="small" style={{ maxWidth: 460 }}>{t('Speech is turned into timed subtitles locally with Whisper. The file stays on this computer.')}</p>
        <button className="btn primary" onClick={onAttach}><Upload size={15} /> {t('Choose video or audio')}</button>
      </div>
    )
  }

  return (
    <div className="job">
      <div className="col" style={{ gap: 12 }}>
        <div className="row"><Mic size={16} color="var(--accent-strong)" /><strong>{t('Speech → subtitles')}</strong><span className="muted small ellipsis">· {media.name}</span></div>
        <div className="grid-2">
          <label className="field">
            <span className="label">{t('Language spoken in the recording')}</span>
            <select className="select" value={language} disabled={running} onChange={(e) => setLanguage(e.target.value as TranscriptionLanguage)}>
              {SOURCE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{t(l.label)}</option>)}
              <option value="auto">{t('Detect automatically')}</option>
            </select>
          </label>
          <label className="field">
            <span className="label">{t('Model')}</span>
            <select className="select" value={settings.transcription.modelId} disabled={running} onChange={(e) => update({ transcription: { modelId: e.target.value } })}>
              {WHISPER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} (~{m.sizeMb} MB)</option>)}
            </select>
          </label>
        </div>
        {check && !check.available && (
          <div className="callout warn">
            <AlertTriangle size={16} />
            <div className="small">
              <strong>{t('Speech model is not installed yet.')}</strong> {t('Run this once in the project folder:')}
              <pre className="mono" style={{ margin: '6px 0 0' }}>npm run model:install:whisper</pre>
            </div>
          </div>
        )}
        <div className="row wrap">
          {!running ? (
            <button className="btn primary lg" onClick={begin} disabled={!check?.available}>
              <Mic size={16} /> {segmentCount ? t('Transcribe again') : t('Transcribe')}
            </button>
          ) : (
            <button className="btn danger" onClick={onCancel}><Square size={14} /> {t('Cancel')}</button>
          )}
          <span className="tiny muted">{t('Runs locally. On a typical laptop 1 minute of audio takes about 2–4 minutes.')}</span>
        </div>
      </div>

      <div className="col" style={{ gap: 12 }}>
        <div className="steps">
          {stages.map(([label, done, current]) => (
            <span key={label} className={`step${done ? ' done' : ''}${current && running ? ' current' : ''}`}>
              {done ? <CheckCircle2 size={14} /> : current && running ? <LoaderCircle size={14} className="spin" /> : <Circle size={14} />} {label}
            </span>
          ))}
        </div>
        {running && (
          <>
            <div className={`progress${pct === null ? ' indeterminate' : ''}`}><span style={{ width: `${pct ?? 0}%` }} /></div>
            <div className="small muted">
              {p?.stage === 'transcribing' && p.total ? t('Block {done} of {total} · {audio} of {length} processed', { done: Math.min(p.done + 1, p.total), total: p.total, audio: fmt(p.audioDoneMs), length: fmt(p.audioTotalMs) }) : p?.stage === 'detecting' ? t('Detecting the language…') : p?.stage === 'loading' ? `${t('Loading the model')}… ${modelStatus.phase === 'ready' ? '' : t('(first time takes longer)')}` : t('Decoding audio…')}
            </div>
          </>
        )}
        {state.phase === 'done' && (
          <div className="callout ok">
            <CheckCircle2 size={16} />
            <div className="small grow">
              <strong>{t('{n} subtitles created in {s} s.', { n: state.segments, s: Math.round(state.elapsedMs / 1000) })}</strong> {t('Check names and unclear words, then continue.')}
              {state.kept > 0 && <div className="tiny" style={{ marginTop: 4 }}>{t('{n} subtitle(s) you verified, edited or approved were kept unchanged.', { n: state.kept })}</div>}
              <div className="tiny muted" style={{ marginTop: 4 }}>
                {WHISPER_MODELS.find((m) => m.id === state.modelId)?.label ?? state.modelId} · {state.language ? languageName(state.language) : ''}
                {detection && (detection.variantIsHint
                  ? ` · ${t('detected automatically: Serbian/Croatian/Bosnian {p} (the exact variant cannot be told from audio)', { p: percent(detection.probability) })}`
                  : ` · ${t('detected automatically ({p})', { p: percent(detection.probability) })}`)}
              </div>
              {state.flagged > 0 && (
                <div className="callout warn" style={{ marginTop: 8 }}>
                  <ShieldAlert size={15} />
                  <div className="small grow">
                    {t('{n} subtitle(s) look suspicious (text on silence, repetition, little sound…) and are marked "Check original". Nothing was deleted.', { n: state.flagged })}
                    <div style={{ marginTop: 6 }}><button className="btn sm" onClick={onReview}>{t('Review warnings')}</button></div>
                  </div>
                </div>
              )}
              <div style={{ marginTop: 8 }}><button className="btn sm primary" onClick={onNext}>{t('Next: translate / adapt')} <ArrowRight size={13} /></button></div>
            </div>
          </div>
        )}
        {state.phase === 'needs-language' && detection && (
          <div className="callout warn">
            <AlertTriangle size={16} />
            <div className="small grow">
              <strong>{t('The language was not determined reliably.')}</strong> {reasonText[detection.reason] ?? ''} {t('Choose the spoken language above and start again.')}
              {detection.candidates.length > 0 && (
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {t('Model probabilities:')} {detection.candidates.slice(0, 3).map((c) => `${languageName(c.code)} ${percent(c.probability)}`).join(', ')}
                </div>
              )}
              {detection.language && (
                <div style={{ marginTop: 8 }}>
                  <button className="btn sm" onClick={() => { const l = detection.language!; setLanguage(l); if (segmentCount > 0) setConfirm(true); else onStart(l, 'replace') }}>
                    <Mic size={13} /> {t('Transcribe as {language}', { language: languageName(detection.language) })}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {(state.phase === 'cancelled' || state.phase === 'error') && (
          <div className={`callout ${state.phase === 'error' ? 'err' : 'warn'}`}><AlertTriangle size={16} /><div className="small">{state.message}</div></div>
        )}
        {state.phase === 'idle' && <p className="small muted">{t('Whisper recognises speech and timing. Afterwards the subtitles are split to a readable length (max 2 lines, 42 characters per line).')}</p>}
      </div>

      {confirm && protectedCount > 0 && (
        <Modal
          title={t('Replace existing subtitles?')}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(false)}>{t('Cancel')}</button>
              <button className="btn danger" onClick={() => (setConfirm(false), onStart(language, 'replace', { keepProtected: false }))}>{t('Replace everything')}</button>
              <button className="btn primary" autoFocus onClick={() => (setConfirm(false), onStart(language, 'replace', { keepProtected: true }))}>{t('Keep my work and transcribe')}</button>
            </>
          }
        >
          <div className="small" style={{ color: 'var(--text-1)' }}>
            <p>{t('The project already has {n} subtitles. {k} of them you verified, edited or approved.', { n: segmentCount, k: protectedCount })}</p>
            <p style={{ marginTop: 8 }}>{t('"Keep my work" leaves those subtitles exactly as they are and adds new text only where they are not. "Replace everything" overwrites your work too (Ctrl+Z still undoes it).')}</p>
          </div>
        </Modal>
      )}
      {confirm && protectedCount === 0 && (
        <ConfirmDialog
          title={t('Replace existing subtitles?')}
          message={t('The project already has {n} subtitles. Transcription replaces them (you can undo with Ctrl+Z).', { n: segmentCount })}
          confirmLabel={t('Replace and transcribe')}
          onCancel={() => setConfirm(false)}
          onConfirm={() => (setConfirm(false), onStart(language, 'replace'))}
        />
      )}
    </div>
  )
}

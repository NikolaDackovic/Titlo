import { AlertTriangle, CheckCircle2, FilePlus2, FileText, Mic, Upload } from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'
import { useServices } from '../../app/services'
import { useSettings } from '../../app/settingsContext'
import { getProfile, SOURCE_LANGUAGES, type ProfileId, type SourceLanguage, type Yat } from '../../domain/languages'
import { CONTENT_TYPES, type ContentType } from '../../domain/types'
import { IMPORT_EXTENSIONS, parseSubtitleFile, type ImportResult } from '../../formats'
import { t as tr, useT } from '../../i18n'
import { MAX_BROWSER_MEDIA_BYTES } from '../../media/audio'
import { MEDIA_EXTENSIONS, WHISPER_MODELS, type MediaInfo } from '../../media/types'
import { pickFile, readFileBytes, type PickedFile } from '../../platform/files'
import { errorMessage, reportError } from '../../services/errors'
import { notify } from '../../services/notifications'
import type { ProviderAvailability } from '../../translation/types'
import { segmentsFromCues } from '../../state/segmentOps'
import { CONTENT_ICON } from '../components/contentIcons'
import { Field, ProfileSelect } from '../components/Field'
import { Modal } from '../components/Modal'
import { requestAutoTranscription, setSessionMedia } from '../studio/mediaStore'

export type Workflow = 'media' | 'subtitles' | 'empty'

interface Props {
  workflow: Workflow
  onClose: () => void
  onCreated: (projectId: string) => void
}

const fmtDuration = (ms: number | null) => {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const isMedia = (name: string) => MEDIA_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e))

export function NewProjectDialog({ workflow: initialWorkflow, onClose, onCreated }: Props) {
  const t = useT()
  const { projects, media: mediaProcessor, transcription } = useServices()
  const { settings, update } = useSettings()
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow)
  const [name, setName] = useState('')
  const [contentType, setContentType] = useState<ContentType>(initialWorkflow === 'media' ? 'youtube' : 'movie')
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>(initialWorkflow === 'media' ? 'sr' : 'en')
  const [profile, setProfile] = useState<ProfileId>(settings.defaultProfile)
  const [neutralYat, setNeutralYat] = useState<Yat>('ijekavian')
  const [subtitle, setSubtitle] = useState<{ name: string; result: ImportResult } | null>(null)
  const [media, setMedia] = useState<{ file: File; info: MediaInfo } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [whisperCheck, setWhisperCheck] = useState<ProviderAvailability | null>(null)

  useEffect(() => {
    if (workflow !== 'media') return
    let cancelled = false
    void transcription.checkModel(settings.transcription.modelId).then((r) => !cancelled && setWhisperCheck(r))
    return () => {
      cancelled = true
    }
  }, [workflow, settings.transcription.modelId, transcription])

  const loadFile = async (picked: PickedFile | File) => {
    const file = picked instanceof File ? picked : picked.file
    setFileError(null)
    if (workflow === 'media' || (workflow === 'empty' && isMedia(file.name))) {
      if (!isMedia(file.name) && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
        setFileError(t('This is not a video or audio file. Supported: {list}.', { list: MEDIA_EXTENSIONS.join(', ') }))
        return
      }
      if (workflow === 'empty') setWorkflow('media')
      const info = await mediaProcessor.probe(file)
      setMedia({ file, info })
      setName((n) => n || file.name.replace(/\.[^.]+$/, ''))
      return
    }
    try {
      const result = parseSubtitleFile(file.name, await readFileBytes(file))
      setSubtitle({ name: file.name, result })
      setName((n) => n || file.name.replace(/\.[^.]+$/, ''))
    } catch (error) {
      setSubtitle(null)
      setFileError(errorMessage(error))
    }
  }

  const choose = async () => {
    const picked = await pickFile(workflow === 'media' ? [...MEDIA_EXTENSIONS, 'video/*', 'audio/*'] : IMPORT_EXTENSIONS)
    if (picked) await loadFile(picked)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (isMedia(file.name)) setWorkflow('media')
    else if (IMPORT_EXTENSIONS.some((x) => file.name.toLowerCase().endsWith(x))) setWorkflow('subtitles')
    void loadFile(file)
  }

  const canCreate = workflow === 'empty' || (workflow === 'subtitles' && subtitle) || (workflow === 'media' && media)

  const create = async () => {
    try {
      const doc = projects.create(
        {
          name: name.trim() || tr('Untitled project'),
          contentType,
          sourceLanguage,
          activeProfile: profile,
          neutralYat,
          sourceFormat: workflow === 'subtitles' && subtitle ? subtitle.result.format : null,
          sourceFileName: workflow === 'subtitles' && subtitle ? subtitle.name : media?.file.name ?? null,
          formatHeader: workflow === 'subtitles' && subtitle ? subtitle.result.header : null,
        },
        workflow === 'subtitles' && subtitle ? segmentsFromCues(subtitle.result.cues) : [],
      )
      if (workflow === 'media' && media) {
        setSessionMedia(doc.project.id, media.file)
        projects.setMedia({ projectId: doc.project.id, fileName: media.file.name, fileType: media.file.type || 'unknown', durationMs: media.info.durationMs, fileSize: media.file.size, filePath: null })
        requestAutoTranscription(doc.project.id)
        notify('success', t('Project created'), t('Speech recognition starts in the Studio. You can keep working while it runs.'))
      } else {
        notify('success', t('Project created'), subtitle ? t('{n} subtitles imported from {file}.', { n: subtitle.result.cues.length, file: subtitle.name }) : t('Empty project — add subtitles in the Studio.'))
      }
      onCreated(doc.project.id)
    } catch (error) {
      reportError(t('Could not create the project'), error)
    }
  }

  const warnings = subtitle?.result.warnings ?? []
  const tooBig = media && media.file.size > MAX_BROWSER_MEDIA_BYTES

  return (
    <Modal
      title={t('New project')}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" onClick={() => void create()} disabled={!canCreate || Boolean(tooBig)}>
            {workflow === 'media' ? t('Create and transcribe') : t('Create project')}
          </button>
        </>
      }
    >
      <div className="grid-3">
        {([
          ['media', Mic, 'Video or podcast', 'Speech → subtitles'],
          ['subtitles', FileText, 'Subtitle file', 'SRT · VTT · ASS'],
          ['empty', FilePlus2, 'Empty project', 'Write by hand'],
        ] as const).map(([id, Icon, title, sub]) => (
          <button key={id} className={`choice${workflow === id ? ' active' : ''}`} onClick={() => (setWorkflow(id), setFileError(null))}>
            <span className="wf-icon"><Icon size={18} /></span>
            <span><strong>{t(title)}</strong><span>{t(sub)}</span></span>
          </button>
        ))}
      </div>

      {workflow !== 'empty' && (
        <div className={`dropzone${drag ? ' drag' : ''}`} onDragOver={(e) => (e.preventDefault(), setDrag(true))} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
          <button className="btn primary" onClick={() => void choose()}>
            <Upload size={15} /> {workflow === 'media' ? t('Choose video or audio') : t('Choose subtitle file')}
          </button>
          <div className="grow small muted">
            {workflow === 'media' && media && (
              <span style={{ color: 'var(--text-0)' }}>
                <strong>{media.file.name}</strong> · {(media.file.size / 2 ** 20).toFixed(1)} MB · {fmtDuration(media.info.durationMs)} {media.info.hasVideo ? t('(video)') : t('(audio)')}
              </span>
            )}
            {workflow === 'subtitles' && subtitle && <strong style={{ color: 'var(--text-0)' }}>{subtitle.name}</strong>}
            {!media && !subtitle && t('…or drag a file here. The file stays on this computer.')}
          </div>
        </div>
      )}

      {fileError && (
        <div className="callout err"><AlertTriangle size={16} /><div className="small">{fileError}</div></div>
      )}
      {tooBig && (
        <div className="callout warn"><AlertTriangle size={16} /><div className="small">{t('This file is larger than {mb} MB. The browser version cannot decode it in memory; long films need the desktop version (FFmpeg).', { mb: MAX_BROWSER_MEDIA_BYTES / 2 ** 20 })}</div></div>
      )}

      {workflow === 'subtitles' && subtitle && (
        <div className="col" style={{ gap: 6 }}>
          <div className="row small">
            <span className="badge accent">{subtitle.result.format.toUpperCase()}</span>
            <span>{t('{n} subtitles', { n: subtitle.result.cues.length })}</span>
            <span className="muted">· {t('encoding')} {subtitle.result.encoding}{subtitle.result.encodingGuessed ? ` (${t('detected')})` : ''}</span>
          </div>
          {warnings.length > 0 && (
            <div className="callout warn">
              <AlertTriangle size={16} />
              <div className="small">
                <strong>{t('{n} import note(s) — nothing was removed silently:', { n: warnings.length })}</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 16, maxHeight: 120, overflow: 'auto' }}>
                  {warnings.slice(0, 30).map((w, i) => <li key={i}>{w.line ? `${t('Line')} ${w.line}: ` : ''}{w.message}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      <Field label={t('Content type')}>
        <div className="chips">
          {CONTENT_TYPES.map((c) => {
            const Icon = CONTENT_ICON[c.id]
            return (
              <button key={c.id} className={`chip${contentType === c.id ? ' active' : ''}`} onClick={() => setContentType(c.id)}>
                <Icon size={14} /> {t(c.label)}
              </button>
            )
          })}
        </div>
      </Field>

      <div className="grid-2">
        <Field label={t('Project name')}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Season 1 · Episode 3')} />
        </Field>
        <Field label={workflow === 'media' ? t('Language spoken in the recording') : t('Source language')} hint={sourceLanguage !== 'en' ? t('Serbian/Croatian/Bosnian source: the text is adapted to the target variant (the local model translates from English only).') : undefined}>
          <select className="select" value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value as SourceLanguage)}>
            {SOURCE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{t(l.label)}</option>)}
          </select>
        </Field>
        <Field label={t('Subtitles in')} hint={t(getProfile(profile).description)}>
          <ProfileSelect value={profile} onChange={(v) => setProfile(v as ProfileId)} />
        </Field>
        {profile === 'exyu-neutral' && (
          <Field label={t('ExYu Neutral: yat')} hint={t('Ijekavian reads naturally in Croatia, Bosnia and Herzegovina and Montenegro and is fully understood in Serbia; choose ekavian for a Serbia-first audience.')}>
            <select className="select" value={neutralYat} onChange={(e) => setNeutralYat(e.target.value as Yat)}>
              <option value="ijekavian">{t('Ijekavian (mlijeko, vrijeme)')}</option>
              <option value="ekavian">{t('Ekavian (mleko, vreme)')}</option>
            </select>
          </Field>
        )}
        {workflow === 'media' && (
          <Field label={t('Speech recognition model')} hint={WHISPER_MODELS.find((m) => m.id === settings.transcription.modelId) ? t(WHISPER_MODELS.find((m) => m.id === settings.transcription.modelId)!.note) : undefined}>
            <select className="select" value={settings.transcription.modelId} onChange={(e) => update({ transcription: { modelId: e.target.value } })}>
              {WHISPER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} (~{m.sizeMb} MB)</option>)}
            </select>
          </Field>
        )}
      </div>

      {workflow === 'media' && whisperCheck && (
        whisperCheck.available ? (
          <div className="callout ok"><CheckCircle2 size={16} /><div className="small">{t('Speech model is installed. Transcription runs locally; on a typical laptop 1 minute of audio takes about 2–4 minutes.')}</div></div>
        ) : (
          <div className="callout warn">
            <AlertTriangle size={16} />
            <div className="small">
              <strong>{t('Speech model is not installed yet.')}</strong> {t('Run this once in the project folder, then create the project:')}
              <pre className="mono" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>npm run model:install:whisper</pre>
            </div>
          </div>
        )
      )}
    </Modal>
  )
}

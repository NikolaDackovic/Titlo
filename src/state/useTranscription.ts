import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '../app/services'
import { useSettings } from '../app/settingsContext'
import type { SourceLanguage } from '../domain/languages'
import { newId, type Segment } from '../domain/types'
import { t } from '../i18n'
import { LanguageNotDetected, TranscriptionCancelled } from '../media/browserWhisper'
import type { AudioActivity } from '../media/audioActivity'
import type { LanguageDetection } from '../media/languageDetection'
import type { TranscriptionLanguage } from '../media/transcription'
import type { TranscriptionProgress } from '../media/types'
import { log, reportError } from '../services/errors'
import { notify } from '../services/notifications'
import { checkTranscript, flaggedSegmentIds } from '../qc/checks/transcript'
import { flagForReview, mergeTranscription, sortByStart } from './segmentOps'
import type { ProjectEditor } from './useProjectEditor'

export type TranscriptionPhase = 'idle' | 'running' | 'done' | 'cancelled' | 'error' | 'needs-language'

export interface TranscriptionState {
  phase: TranscriptionPhase
  progress: TranscriptionProgress | null
  message: string
  segments: number
  elapsedMs: number
  /** Model and language actually used (after a finished run). */
  modelId: string | null
  language: SourceLanguage | null
  /** Result of "Detect automatically" (also kept when it could not decide). */
  detection: LanguageDetection | null
  /** New subtitles that got a quality-control warning (marked "needs-review"). */
  flagged: number
  /** Verified / edited / approved subtitles kept instead of being replaced. */
  kept: number
}

export interface TranscriptionStartOptions {
  /** Replace mode only: keep verified, manually edited and approved originals. */
  keepProtected?: boolean
}

const IDLE: TranscriptionState = { phase: 'idle', progress: null, message: '', segments: 0, elapsedMs: 0, modelId: null, language: null, detection: null, flagged: 0, kept: 0 }

/**
 * Speech → timed subtitles for the current project (local Whisper). The result replaces or
 * extends the segment list in one undoable step; the job is recorded in processing_jobs.
 */
export function useTranscription(editor: ProjectEditor, onPeaks: (peaks: Float32Array, durationMs: number, activity: AudioActivity) => void) {
  const { transcription, jobs } = useServices()
  const { settings } = useSettings()
  const [state, setState] = useState<TranscriptionState>(IDLE)
  const controller = useRef<AbortController | null>(null)
  const editorRef = useRef(editor)
  editorRef.current = editor

  useEffect(() => () => controller.current?.abort(), [])

  const start = useCallback(
    async (file: File, language: TranscriptionLanguage, mode: 'replace' | 'append', startOptions: TranscriptionStartOptions = {}) => {
      if (controller.current) return
      const modelId = settings.transcription.modelId
      const availability = await transcription.checkModel(modelId)
      if (!availability.available) {
        notify('error', t('Speech model is not installed'), t('Run "npm run model:install:whisper" in the project folder once (≈250 MB download), then try again.'), availability.details)
        return
      }
      const abort = new AbortController()
      controller.current = abort
      const project = editorRef.current.project
      const jobId = jobs.start(project.id, 'transcription', { modelId, language, file: file.name })
      setState({ ...IDLE, phase: 'running', message: t('Preparing…') })
      try {
        const result = await transcription.transcribe(file, { modelId, language, shVariant: project.sourceLanguage }, abort.signal, (progress) => {
          setState((s) => ({ ...s, progress }))
          if (progress.total) jobs.update(jobId, { status: 'running', progress: progress.done / progress.total })
        })
        onPeaks(result.peaks, result.durationMs, result.activity)
        // New Whisper text is "unreviewed"; text it never removes, so suspicious lines are flagged instead.
        const segments: Segment[] = result.segments.map((s) => ({ id: newId(), start: s.start, end: s.end, source: s.text, translations: {}, sourceStatus: 'unreviewed', sourceOrigin: 'whisper' }))
        const fresh = new Set(segments.map((s) => s.id))
        // Pure: runs inside the reducer on the latest segments.
        const place = (current: Segment[]) => {
          const merged = mode === 'replace' ? mergeTranscription(current, segments, Boolean(startOptions.keepProtected)) : { segments: sortByStart([...current, ...segments]), kept: 0 }
          const ids = [...flaggedSegmentIds(checkTranscript({ segments: merged.segments, audio: result.activity }))].filter((id) => fresh.has(id))
          return { segments: flagForReview(merged.segments, ids), kept: merged.kept, flagged: ids.length }
        }
        // Counts for the message, from the state at this moment.
        const { kept, flagged } = place(editorRef.current.segments)
        editorRef.current.mapSegments((current) => place(current).segments, 'transcription')
        if (result.language !== project.sourceLanguage) editorRef.current.updateProject({ sourceLanguage: result.language })
        jobs.update(jobId, { status: 'completed', progress: 1, completed: true })
        log('info', 'Transcription finished', { segments: segments.length, elapsedMs: result.elapsedMs, modelId, language: result.language, detection: result.detection?.status ?? null })
        setState({ phase: 'done', progress: null, message: '', segments: segments.length, elapsedMs: result.elapsedMs, modelId, language: result.language, detection: result.detection, flagged, kept })
        notify(
          segments.length ? 'success' : 'warning',
          segments.length ? t('Transcription finished') : t('No speech recognised'),
          segments.length
            ? t('{n} subtitles created in {s} s. Review the text, then translate or adapt it.', { n: segments.length, s: Math.round(result.elapsedMs / 1000) })
            : t('The model did not find any speech. Check the selected language and that the file has an audio track.'),
        )
      } catch (error) {
        if (error instanceof LanguageNotDetected) {
          jobs.update(jobId, { status: 'cancelled', completed: true, errorMessage: error.message })
          setState({ ...IDLE, phase: 'needs-language', detection: error.detection, message: error.message })
          notify('warning', t('Language not determined'), t('Choose the spoken language and start again. Nothing was changed.'))
        } else if (error instanceof TranscriptionCancelled || abort.signal.aborted) {
          jobs.update(jobId, { status: 'cancelled', completed: true })
          setState({ ...IDLE, phase: 'cancelled', message: t('Cancelled. Nothing was changed.') })
        } else {
          jobs.update(jobId, { status: 'failed', completed: true, errorMessage: (error as Error).message })
          setState({ ...IDLE, phase: 'error', message: (error as Error).message })
          reportError(t('Transcription failed'), error)
        }
      } finally {
        controller.current = null
      }
    },
    [jobs, onPeaks, settings.transcription.modelId, transcription],
  )

  const cancel = useCallback(() => controller.current?.abort(), [])
  return { state, start, cancel, running: state.phase === 'running' }
}

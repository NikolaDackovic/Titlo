import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '../app/services'
import { useSettings } from '../app/settingsContext'
import { getProfile, sourceLanguageLabel } from '../domain/languages'
import { nowIso } from '../domain/types'
import { t } from '../i18n'
import { log, reportError } from '../services/errors'
import { reportAvailability } from '../services/modelStatus'
import { notify } from '../services/notifications'
import { buildTarget, TranslationJob, type JobProgress } from '../translation/engine'
import { createProvider } from '../translation/registry'
import type { GlossaryHint } from '../translation/types'
import { missedTerms } from '../qc/checks/terminology'
import { adaptSourceToProfile, applyTranslationUpdates } from './segmentOps'
import type { ProjectEditor } from './useProjectEditor'

export interface StartOptions {
  segmentIds?: string[]
  retranslateMachine?: boolean
  overwriteManual?: boolean
}

export interface TranslationJobHooks {
  /** Called after a same-language adaptation so the UI can open the Localization panel. */
  onAdapted?: () => void
}

export function useTranslationJob(editor: ProjectEditor, glossary: GlossaryHint[], maxCharsPerLine: number, hooks: TranslationJobHooks = {}) {
  const { providerDeps, cache, jobs } = useServices()
  const { settings } = useSettings()
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [providerLabel, setProviderLabel] = useState('')
  const jobRef = useRef<TranslationJob | null>(null)
  // Set synchronously on click: availability checks are async, so a second click
  // (e.g. "Translate" in the editor and in the panel) must not start a second job.
  const startingRef = useRef(false)
  const editorRef = useRef(editor)
  editorRef.current = editor
  const hooksRef = useRef(hooks)
  hooksRef.current = hooks

  // Cancel a running job when leaving the Studio; finished batches are already saved.
  useEffect(() => () => jobRef.current?.cancel(), [])

  const adapt = useCallback((options: StartOptions) => {
    const { project, segments } = editorRef.current
    const cyrillic = getProfile(project.activeProfile).script === 'Cyrl'
    const preview = adaptSourceToProfile(segments, project.activeProfile, cyrillic, options.overwriteManual, options.segmentIds)
    if (!segments.length) {
      notify('info', t('Nothing to translate'), t('This project has no subtitles yet. Import a subtitle file or transcribe the video/audio first.'))
      return
    }
    editorRef.current.mapSegments((cur) => adaptSourceToProfile(cur, project.activeProfile, cyrillic, options.overwriteManual, options.segmentIds).segments)
    notify(
      'success',
      t('Source prepared for {profile}', { profile: t(getProfile(project.activeProfile).label) }),
      t('{n} segment(s) copied from the {lang} source and marked "Needs review". Open the Localization tab for regional suggestions — machine translation between Serbian, Croatian and Bosnian is not available in this model.', {
        n: preview.adapted,
        lang: t(sourceLanguageLabel(project.sourceLanguage)),
      }),
    )
    hooksRef.current.onAdapted?.()
  }, [])

  const run = useCallback(
    async (options: StartOptions) => {
      const { project, segments } = editorRef.current
      if (!segments.length) {
        notify('info', t('Nothing to translate'), t('This project has no subtitles yet. Import a subtitle file or transcribe the video/audio first.'))
        return
      }
      const provider = createProvider(settings.translation, providerDeps)
      setProviderLabel(provider.label)
      const target = buildTarget(project.activeProfile, project.neutralYat)

      if (!provider.supports(project.sourceLanguage, target)) {
        // OPUS-MT translates from English only: a Serbian/Croatian/Bosnian source is adapted instead.
        if (project.sourceLanguage !== 'en') return adapt(options)
        notify('warning', t('{provider} cannot translate this project', { provider: provider.label }), t('This provider does not support the selected language pair.'))
        return
      }
      setProgress({ state: 'running', total: 0, done: 0, failed: 0, cached: 0, skipped: 0, currentBatch: 0, totalBatches: 0, message: t('Checking the model…') })
      const availability = await provider.checkAvailability()
      if (settings.translation.providerId === 'opus-mt-en-sh') reportAvailability(settings.translation.opusModelId, availability.available, availability.message)
      if (!availability.available) {
        setProgress(null)
        notify('error', t('{provider} is not available', { provider: provider.label }), availability.message, [...(availability.details ?? []), t('See Models & Providers for setup instructions.')])
        return
      }
      if (provider.isTest) notify('warning', t('TEST provider selected'), t('Output is marked [TEST] and is not a translation. Choose OPUS-MT in Models & Providers for a real translation.'))

      const startedAt = nowIso()
      const jobId = jobs.start(project.id, 'translation', { provider: provider.id, profile: project.activeProfile, ...options })
      const job = new TranslationJob({
        provider,
        segments,
        profile: project.activeProfile,
        sourceLanguage: project.sourceLanguage,
        neutralYat: project.neutralYat,
        contentType: project.contentType,
        glossary,
        cache,
        contextSize: settings.translation.contextSize,
        maxCharsPerLine,
        ...options,
        onUpdate: (raw) => {
          // Terminology: machine output that ignores a preferred term is marked "Needs review"
          // (OPUS-MT cannot be told which term to use; the text is not changed).
          const cyrillic = getProfile(project.activeProfile).script === 'Cyrl'
          const updates = glossary.length
            ? raw.map((u) => (u.status === 'translated' && missedTerms(u.sourceText, u.text, glossary, cyrillic).length ? { ...u, status: 'needs_review' as const } : u))
            : raw
          editorRef.current.mapSegments((current) => applyTranslationUpdates(current, project.activeProfile, updates, startedAt).segments, `job:${jobId}`)
        },
        onProgress: (p) => {
          setProgress(p)
          if (p.total) jobs.update(jobId, { status: p.state, progress: (p.done + p.failed) / p.total })
        },
      })
      jobRef.current = job
      try {
        const final = await job.run()
        jobs.update(jobId, { status: final.state, completed: true, errorMessage: final.state === 'failed' ? final.message : null })
        log('info', `Translation job ${final.state}`, final)
        const profileLabel = t(getProfile(project.activeProfile).label)
        if (final.state === 'completed' && final.total) {
          notify(final.failed ? 'warning' : 'success', final.failed ? t('Translation finished with errors') : t('Translation finished'), t('{done} translated ({cached} from cache), {failed} failed, {skipped} skipped → {profile}.', { done: final.done, cached: final.cached, failed: final.failed, skipped: final.skipped, profile: profileLabel }))
        } else if (final.state === 'completed') {
          notify('info', t('Nothing to translate'), t('All {n} segment(s) already have a translation, are locked, approved or edited by you. Tick "Re-translate existing machine/test output" to translate them again.', { n: final.skipped }))
        } else if (final.state === 'failed') {
          notify('error', t('Translation failed'), final.message)
        }
      } catch (error) {
        jobs.update(jobId, { status: 'failed', completed: true, errorMessage: (error as Error).message })
        reportError(t('Translation job crashed'), error)
      } finally {
        jobRef.current = null
      }
    },
    [adapt, cache, glossary, jobs, maxCharsPerLine, providerDeps, settings.translation],
  )

  const runRef = useRef(run)
  runRef.current = run

  const start = useCallback(async (options: StartOptions = {}) => {
    if (startingRef.current || (jobRef.current && (jobRef.current.state === 'running' || jobRef.current.state === 'paused'))) return
    startingRef.current = true
    try {
      await runRef.current(options)
    } finally {
      startingRef.current = false
    }
  }, [])

  const running = progress?.state === 'running' || progress?.state === 'paused'
  return {
    progress,
    providerLabel,
    running,
    start,
    pause: () => jobRef.current?.pause(),
    resume: () => jobRef.current?.resume(),
    cancel: () => jobRef.current?.cancel(),
    clear: () => setProgress(null),
  }
}

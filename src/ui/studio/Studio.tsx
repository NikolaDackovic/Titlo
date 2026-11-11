import { FileText, Languages, ListVideo, Mic, Plus, Search, ShieldCheck, Sparkles, Upload, Wrench } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Navigation } from '../../app/App'
import { useServices } from '../../app/services'
import { useSettings } from '../../app/settingsContext'
import { isAdaptation } from '../../domain/languages'
import { isSourceProtected, isTranslationStale, needsSourceReview, newId, SOURCE_STATUSES, sourceOriginOf, sourceStatusOf, type ProjectDoc, type Segment, type SourceStatus } from '../../domain/types'
import { IMPORT_EXTENSIONS, parseSubtitleFile } from '../../formats'
import { activeTerms, toLocalizationRules } from '../../glossary/rules'
import { t, useT } from '../../i18n'
import { computePeaks, decodeToMono16k } from '../../media/audio'
import { analyzeActivity, type AudioActivity } from '../../media/audioActivity'
import { SEED_TERMBASE } from '../../localization/termbase'
import { MEDIA_EXTENSIONS } from '../../media/types'
import { pickFile, readFileBytes } from '../../platform/files'
import { getQcProfile, runQc, type QcCategory, type QcIssue } from '../../qc'
import { errorMessage, reportError } from '../../services/errors'
import { notify } from '../../services/notifications'
import { deleteSegments, editTranslation, insertSegmentAfter, mergeWithNext, segmentsFromCues, setSourceStatus, setTranslationState, splitSegment, updateSegment } from '../../state/segmentOps'
import { useProjectEditor } from '../../state/useProjectEditor'
import { useTranscription } from '../../state/useTranscription'
import { useTranslationJob, type StartOptions } from '../../state/useTranslationJob'
import { Modal } from '../components/Modal'
import { FindReplacePanel } from './dock/FindReplacePanel'
import { LocalizationPanel } from './dock/LocalizationPanel'
import { QcPanel } from './dock/QcPanel'
import { ToolsPanel } from './dock/ToolsPanel'
import { TranscriptionPanel } from './dock/TranscriptionPanel'
import { TranslationPanel } from './dock/TranslationPanel'
import { ExportDialog } from './ExportDialog'
import { clearSessionMedia, getSessionMedia, setSessionMedia, setSessionPeaks, takeAutoTranscription } from './mediaStore'
import { SegmentEditor } from './SegmentEditor'
import { SegmentList } from './SegmentList'
import { StudioToolbar } from './StudioToolbar'
import { Timeline } from './Timeline'
import { TranslationGate, type GateChoice } from './TranslationGate'
import { VideoPanel, type VideoHandle } from './VideoPanel'

type DockTab = 'subtitles' | 'transcription' | 'translation' | 'localization' | 'qc' | 'find' | 'tools'

const TL_KEY = 'exyu.timelineHeight'
const readTlHeight = () => {
  try {
    const v = Number(localStorage.getItem(TL_KEY))
    return v >= 150 && v <= 900 ? v : 250
  } catch {
    return 250
  }
}

export function Studio({ projectId, nav }: { projectId: string; nav: Navigation }) {
  const { projects } = useServices()
  const tt = useT()
  const [doc] = useState<ProjectDoc | null>(() => projects.getDoc(projectId))
  useEffect(() => {
    if (doc) projects.touchOpened(projectId)
  }, [doc, projectId, projects])
  if (!doc) {
    return (
      <div className="empty">
        <h3>{tt('Project not found')}</h3>
        <button className="btn" onClick={nav.closeProject}>{tt('Back to home')}</button>
      </div>
    )
  }
  return <Workspace initial={doc} nav={nav} />
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT')
/** Context played before and after a subtitle when reviewing it. */
const CONTEXT_MS = 1500
/** Files up to this size get a waveform right after attaching (larger: after transcription). */
const AUTO_WAVEFORM_BYTES = 150 * 1024 * 1024

function Workspace({ initial, nav }: { initial: ProjectDoc; nav: Navigation }) {
  const tt = useT()
  const services = useServices()
  const { settings } = useSettings()
  const editor = useProjectEditor(initial)
  const { project, segments, mapSegments } = editor
  const profile = project.activeProfile
  const qcProfile = getQcProfile(settings.qcProfileId)

  // ---- dock -------------------------------------------------------------------
  const [tab, setTab] = useState<DockTab>(() => (initial.segments.length ? 'subtitles' : 'transcription'))
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [tlHeight, setTlHeight] = useState(readTlHeight)
  const [findToken, setFindToken] = useState(0)
  const [exportOpen, setExportOpen] = useState(false)
  const sourceCursor = useRef<number | undefined>(undefined)
  const openTab = useCallback((next: DockTab) => setTab(next), [])

  // Drag the splitter above the timeline to resize it (remembered per browser).
  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY
    const h0 = tlHeight
    const move = (ev: PointerEvent) => setTlHeight(Math.round(Math.min(window.innerHeight * 0.65, Math.max(150, h0 - (ev.clientY - y0)))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setTlHeight((h) => {
        try {
          localStorage.setItem(TL_KEY, String(h))
        } catch {
          /* optional */
        }
        return h
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- glossary -----------------------------------------------------------------
  const glossaryData = useMemo(() => services.glossaries.forProject(project.id), [services.glossaries, project.id])
  const terms = useMemo(() => activeTerms(glossaryData.glossaries, glossaryData.terms, profile), [glossaryData, profile])
  const rules = useMemo(() => toLocalizationRules(terms), [terms])
  const glossaryHints = useMemo(
    () =>
      terms
        .filter((g) => g.kind === 'terminology' && g.sourceLanguage === project.sourceLanguage)
        .map((g) => ({ source: g.sourceTerm, target: g.targetTerm, notes: g.notes || undefined, alternatives: g.alternatives ?? [], wholeWord: g.wholeWord, caseSensitive: g.caseSensitive })),
    [terms, project.sourceLanguage],
  )

  const job = useTranslationJob(editor, glossaryHints, qcProfile.maxCharsPerLine, { onAdapted: () => openTab('localization') })

  // ---- media --------------------------------------------------------------------
  const [media, setMedia] = useState(() => getSessionMedia(project.id))
  const [mediaRecord, setMediaRecord] = useState(() => services.projects.getMedia(project.id))
  const video = useRef<VideoHandle>(null)
  const [timeMs, setTimeMs] = useState(0)
  const [playing, setPlaying] = useState(false)

  const onPeaks = useCallback((peaks: Float32Array, durationMs: number, activity?: AudioActivity) => setMedia(setSessionPeaks(project.id, peaks, durationMs, activity)), [project.id])
  const transcription = useTranscription(editor, onPeaks)

  const buildWaveform = useCallback(
    async (file: File) => {
      if (file.size > AUTO_WAVEFORM_BYTES) return
      try {
        const { samples, durationMs } = await decodeToMono16k(file)
        // One pass each over the decoded audio; the samples are released afterwards.
        onPeaks(computePeaks(samples, Math.min(4000, Math.max(200, Math.round(durationMs / 50)))), durationMs, analyzeActivity(samples))
      } catch {
        /* waveform is optional; decoding errors are reported when transcribing */
      }
    },
    [onPeaks],
  )

  // A media session restored after navigating back: draw its waveform once.
  useEffect(() => {
    if (media && (!media.peaks || !media.activity)) void buildWaveform(media.file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Project created from a video/audio file: start speech recognition right away.
  useEffect(() => {
    const m = getSessionMedia(project.id)
    if (m && takeAutoTranscription(project.id)) {
      openTab('transcription')
      void transcription.start(m.file, project.sourceLanguage, 'replace')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const attachMedia = async () => {
    const picked = await pickFile([...MEDIA_EXTENSIONS, 'video/*', 'audio/*'])
    if (!picked) return
    try {
      const info = await services.media.probe(picked.file)
      setMedia(setSessionMedia(project.id, picked.file))
      services.projects.setMedia({ projectId: project.id, fileName: picked.name, fileType: picked.type || picked.name.split('.').pop() || 'unknown', durationMs: info.durationMs, fileSize: picked.size, filePath: null })
      setMediaRecord(services.projects.getMedia(project.id))
      if (info.durationMs === null) notify('warning', tt('Media metadata unavailable'), tt('The browser could not read this file. Preview may not work (MKV/HEVC are often unsupported in the browser version).'))
      if (!segments.length) openTab('transcription')
      void buildWaveform(picked.file)
    } catch (error) {
      reportError(tt('Could not attach media'), error)
    }
  }

  const importSubtitlesIntoProject = async () => {
    const picked = await pickFile(IMPORT_EXTENSIONS)
    if (!picked) return
    try {
      const result = parseSubtitleFile(picked.name, await readFileBytes(picked.file))
      mapSegments(() => segmentsFromCues(result.cues), 'import')
      editor.updateProject({ sourceFormat: result.format, sourceFileName: picked.name, formatHeader: result.header })
      notify('success', tt('Subtitles imported'), tt('{n} subtitles imported from {file}.', { n: result.cues.length, file: picked.name }), result.warnings.slice(0, 6).map((w) => w.message))
      openTab('translation')
    } catch (error) {
      notify('error', tt('Could not import the file'), errorMessage(error))
    }
  }

  // ---- selection -----------------------------------------------------------------
  const [activeId, setActiveId] = useState<string | null>(segments[0]?.id ?? null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const activeIndex = segments.findIndex((s) => s.id === activeId)
  const active = activeIndex >= 0 ? segments[activeIndex] : null

  useEffect(() => {
    if (!active && segments.length) setActiveId(segments[Math.min(Math.max(0, activeIndex), segments.length - 1)].id)
  }, [active, activeIndex, segments])

  // `select` must keep the same identity across edits: the subtitle list memoizes its rows on it,
  // and a new function on every keystroke re-rendered all rows (2,000 rows ≈ 0.5 s per key).
  const selectionDeps = useRef({ segments, playing })
  useLayoutEffect(() => {
    selectionDeps.current = { segments, playing }
  })
  const select = useCallback(
    (id: string, mode: 'single' | 'toggle' | 'range' = 'single', seek = true) => {
      const { segments, playing } = selectionDeps.current
      setActiveId(id)
      if (mode === 'single') {
        setSelected(new Set([id]))
        anchor.current = id
      } else if (mode === 'toggle') {
        setSelected((s) => {
          const next = new Set(s)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        anchor.current = id
      } else {
        const ids = segments.map((s) => s.id)
        const a = ids.indexOf(anchor.current ?? id)
        const b = ids.indexOf(id)
        setSelected(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)))
      }
      const seg = segments.find((s) => s.id === id)
      if (seek && seg && !playing) video.current?.seek(seg.start)
    },
    [],
  )

  // Follow playback — except while a subtitle is being reviewed with context (▶ from QC or the
  // inspector): the selection must stay on the subtitle the user is checking.
  const reviewing = useRef(false)
  const wasPlaying = useRef(false)
  useEffect(() => {
    // The review ends when that playback stops (seeking before it starts must not end it).
    if (wasPlaying.current && !playing) reviewing.current = false
    wasPlaying.current = playing
    if (!playing || reviewing.current) return
    const seg = segments.find((s) => timeMs >= s.start && timeMs < s.end)
    if (seg && seg.id !== activeId) setActiveId(seg.id)
  }, [timeMs, playing, segments, activeId])

  const onSubtitleTime = useMemo(() => segments.find((s) => timeMs >= s.start && timeMs < s.end) ?? null, [segments, timeMs])
  const overlay = onSubtitleTime ? onSubtitleTime.translations[profile]?.text || onSubtitleTime.source : null

  // ---- QC (deferred so typing stays smooth; recomputed when the UI language changes) ----
  const deferredSegments = useDeferredValue(segments)
  const issues = useMemo(
    () =>
      runQc({
        segments: deferredSegments,
        profile,
        sourceLanguage: project.sourceLanguage,
        neutralYat: project.neutralYat,
        qcProfile,
        termbase: SEED_TERMBASE,
        terminology: terms,
        localizationRules: rules,
        mediaDurationMs: mediaRecord?.durationMs ?? null,
        audio: media?.activity ?? null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deferredSegments, profile, project.sourceLanguage, project.neutralYat, qcProfile, terms, rules, mediaRecord?.durationMs, media?.activity, settings.uiLanguage],
  )
  const issuesBySegment = useMemo(() => {
    const map = new Map<string, QcIssue[]>()
    for (const i of issues) if (i.segmentId) map.set(i.segmentId, [...(map.get(i.segmentId) ?? []), i])
    return map
  }, [issues])

  // ---- review of the original text ----------------------------------------------------
  const sourceCounts = useMemo(() => {
    if (!deferredSegments.some((s) => sourceOriginOf(s) === 'whisper' || sourceStatusOf(s) !== 'unreviewed')) return null
    const c = Object.fromEntries(SOURCE_STATUSES.map((st) => [st, 0])) as Record<SourceStatus, number>
    for (const s of deferredSegments) c[sourceStatusOf(s)] += 1
    return c
  }, [deferredSegments])
  const protectedCount = useMemo(() => segments.filter(isSourceProtected).length, [segments])
  const [qcCategory, setQcCategory] = useState<QcCategory | 'all'>('all')
  const [focusSource, setFocusSource] = useState(0)
  const playContext = useCallback((startMs: number, endMs: number) => {
    reviewing.current = Boolean(video.current?.playRange(Math.max(0, startMs - CONTEXT_MS), endMs + CONTEXT_MS))
  }, [])
  const setSrcStatus = (ids: string[], status: SourceStatus) => mapSegments((cur) => setSourceStatus(cur, ids, status))

  // ---- segment actions --------------------------------------------------------------
  const go = (delta: number) => {
    const next = segments[Math.min(segments.length - 1, Math.max(0, activeIndex + delta))]
    if (next) select(next.id)
  }
  const approve = (andNext: boolean) => {
    if (!active?.translations[profile]?.text.trim()) return
    mapSegments((cur) => setTranslationState(cur, [active.id], profile, { status: 'approved' }))
    if (andNext) go(1)
  }
  const toggleLock = () => {
    if (!active) return
    const locked = Boolean(active.translations[profile]?.locked)
    const ids = selected.size > 1 && selected.has(active.id) ? [...selected] : [active.id]
    mapSegments((cur) => setTranslationState(cur, ids, profile, { locked: !locked }))
  }
  const split = () => {
    if (!active) return
    const check = splitSegment(segments, active.id, sourceCursor.current)
    if (check.error) return notify('warning', tt('Cannot split'), t(check.error))
    const cursor = sourceCursor.current
    mapSegments((cur) => splitSegment(cur, active.id, cursor).segments)
    sourceCursor.current = undefined
  }
  const mergeNext = () => {
    if (!active) return
    const check = mergeWithNext(segments, active.id)
    if (check.error) return notify('warning', tt('Cannot merge'), t(check.error))
    mapSegments((cur) => mergeWithNext(cur, active.id).segments)
  }
  const remove = () => {
    if (!active) return
    const ids = selected.size > 1 && selected.has(active.id) ? [...selected] : [active.id]
    // Any locked profile protects the segment (same rule as split/merge).
    const lockedCount = segments.filter((s) => ids.includes(s.id) && Object.values(s.translations).some((tr) => tr?.locked)).length
    if (lockedCount) return notify('warning', tt('Locked subtitles'), tt('Unlock the subtitles before deleting them.'))
    const nextActive = segments[activeIndex + 1]?.id ?? segments[activeIndex - 1]?.id ?? null
    mapSegments((cur) => deleteSegments(cur, ids))
    setActiveId(nextActive)
    setSelected(new Set())
    notify('info', tt('Deleted {n} subtitle(s)', { n: ids.length }), tt('Undo with Ctrl+Z.'))
  }
  const addAfter = () => {
    // Apply on the latest state (a running translation job may have dispatched updates).
    const id = newId()
    const afterId = active?.id ?? null
    mapSegments((cur) => insertSegmentAfter(cur, afterId, 2000, id).segments)
    setActiveId(id)
  }
  const startTranscription = () => openTab('transcription')

  // QC warning: select the subtitle, put the playhead at its start, let the user fix the text.
  const jumpToIssue = (issue: QcIssue) => {
    if (issue.segmentId) select(issue.segmentId, 'single', !issue.range)
    if (issue.range) {
      setTimeMs(issue.range.startMs)
      video.current?.seek(issue.range.startMs)
    }
    if (issue.segmentId && !issue.range) {
      setInspectorOpen(true)
      setFocusSource((n) => n + 1)
    }
  }
  const playIssue = (issue: QcIssue) => {
    const seg = issue.segmentId ? segments.find((s) => s.id === issue.segmentId) : null
    if (issue.range) playContext(issue.range.startMs, issue.range.endMs)
    else if (seg) playContext(seg.start, seg.end)
  }

  // ---- translation: check the original first, never overwrite manual work silently ----
  const [gate, setGate] = useState<{ options: StartOptions; pending: number; reviewedIds: string[]; total: number } | null>(null)
  const gateOff = useRef(false)
  const requestTranslate = (options: StartOptions = {}) => {
    const targeted = options.segmentIds ? segments.filter((s) => options.segmentIds!.includes(s.id)) : segments
    const pending = targeted.filter(needsSourceReview).length
    if (!pending || gateOff.current) return void job.start(options)
    const reviewedIds = targeted.filter((s) => sourceStatusOf(s) === 'verified' || sourceStatusOf(s) === 'approved').map((s) => s.id)
    setGate({ options, pending, reviewedIds, total: targeted.length })
  }
  const chooseGate = (choice: GateChoice) => {
    if (!gate) return
    setGate(null)
    if (choice === 'review') {
      setQcCategory('transcription')
      openTab('qc')
    } else if (choice === 'reviewed') void job.start({ ...gate.options, segmentIds: gate.reviewedIds })
    else {
      if (choice === 'continue') gateOff.current = true
      void job.start(gate.options)
    }
  }
  const [staleAsk, setStaleAsk] = useState<{ machine: string[]; manual: string[] } | null>(null)
  const retranslateStale = (ids: string[]) => {
    const stale = segments.filter((s) => ids.includes(s.id) && isTranslationStale(s, s.translations[profile]) && !s.translations[profile]?.locked)
    const manual = stale.filter((s) => s.translations[profile]?.origin === 'manual' || s.translations[profile]?.status === 'approved').map((s) => s.id)
    const machine = stale.filter((s) => !manual.includes(s.id)).map((s) => s.id)
    if (manual.length) setStaleAsk({ machine, manual })
    else if (machine.length) requestTranslate({ segmentIds: machine, retranslateMachine: true })
  }
  const staleIds = useMemo(() => deferredSegments.filter((s) => isTranslationStale(s, s.translations[profile])).map((s) => s.id), [deferredSegments, profile])

  // ---- keyboard shortcuts -------------------------------------------------------------
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (ctrl && key === 's' && !e.shiftKey) {
      e.preventDefault()
      void editor.saveNow().then(() => notify('success', tt('Saved'), tt('Project saved to the local database.'))).catch((err) => reportError(tt('Save failed'), err))
    } else if (ctrl && key === 'z' && !e.shiftKey) {
      e.preventDefault()
      editor.undo()
    } else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault()
      editor.redo()
    } else if (ctrl && key === 'f') {
      e.preventDefault()
      openTab('find')
      setFindToken((n) => n + 1)
    } else if (ctrl && key === 'e') {
      e.preventDefault()
      setExportOpen(true)
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      go(1)
    } else if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault()
      go(-1)
    } else if (ctrl && e.key === 'Enter') {
      e.preventDefault()
      approve(true)
    } else if (ctrl && key === 'l') {
      e.preventDefault()
      toggleLock()
    } else if (ctrl && e.shiftKey && key === 's') {
      e.preventDefault()
      split()
    } else if (ctrl && key === 'm') {
      e.preventDefault()
      mergeNext()
    } else if (ctrl && e.code === 'Space') {
      e.preventDefault()
      video.current?.togglePlay()
    } else if (!isTyping(e.target) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      go(e.key === 'ArrowDown' ? 1 : -1)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const applyTexts = (changes: Array<{ segmentId: string; text: string }>) => {
    if (!changes.length) return
    mapSegments((cur) => changes.reduce((acc, c) => editTranslation(acc, c.segmentId, profile, c.text), cur))
    notify('success', tt('Applied changes to {n} subtitle(s)', { n: changes.length }), tt('Undo with Ctrl+Z.'))
  }

  const selectedIds = [...selected].filter((id) => segments.some((s) => s.id === id))
  const sameLanguage = isAdaptation(project.sourceLanguage, profile)

  const qcCount = issues.filter((i) => i.severity !== 'suggestion').length
  const tabs: Array<[DockTab, typeof ListVideo, string, boolean]> = [
    ['subtitles', ListVideo, tt('Subtitles'), false],
    ['transcription', Mic, tt('Speech'), transcription.running],
    ['translation', Languages, sameLanguage ? tt('Adapt') : tt('Translation'), job.running],
    ['localization', Sparkles, tt('Suggestions'), false],
    ['qc', ShieldCheck, tt('Quality'), false],
    ['find', Search, tt('Find'), false],
    ['tools', Wrench, tt('Tools'), false],
  ]

  const emptyState = (
    <div className="studio-empty">
      <h3>{transcription.running ? tt('Recognising speech…') : tt('This project has no subtitles yet')}</h3>
      <p className="small muted">{tt('Choose how to create them. Translation and adaptation come next.')}</p>
      <div className="next-steps">
        <button className="next-step" onClick={() => (media ? startTranscription() : void attachMedia())}>
          <span className="ns-num"><Mic size={14} /></span>
          <span>
            <strong>{media ? tt('Transcribe "{file}"', { file: media.name }) : tt('Attach video or audio and transcribe')}</strong>
            <span className="tiny muted">{tt('Speech → timed subtitles, locally (Whisper).')}</span>
          </span>
        </button>
        <button className="next-step" onClick={() => void importSubtitlesIntoProject()}>
          <span className="ns-num"><FileText size={14} /></span>
          <span>
            <strong>{tt('Import a subtitle file')}</strong>
            <span className="tiny muted">SRT · VTT · ASS</span>
          </span>
        </button>
        <button className="next-step" onClick={addAfter}>
          <span className="ns-num"><Plus size={14} /></span>
          <span>
            <strong>{tt('Write the first subtitle by hand')}</strong>
            <span className="tiny muted">{tt('Useful with the video playing next to it.')}</span>
          </span>
        </button>
      </div>
      {!media && mediaRecord && (
        <button className="btn sm" onClick={() => void attachMedia()}><Upload size={13} /> {tt('Select {file} again', { file: mediaRecord.fileName })}</button>
      )}
    </div>
  )

  return (
    <div className={`studio${inspectorOpen ? ' inspector-open' : ''}`} style={{ ['--tl-h' as string]: `${tlHeight}px` }}>
      <StudioToolbar
        project={project}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        jobRunning={job.running}
        transcribing={transcription.running}
        issues={issues}
        onBack={nav.closeProject}
        onRename={(name) => editor.updateProject({ name })}
        onProfile={(p) => editor.updateProject({ activeProfile: p })}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onSave={() => void editor.saveNow().then(() => notify('success', tt('Saved'))).catch((e) => reportError(tt('Save failed'), e))}
        onTranscribe={startTranscription}
        onTranslate={() => openTab('translation')}
        onExport={() => setExportOpen(true)}
        onShowQc={() => openTab('qc')}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((o) => !o)}
      />

      <aside className="st-left">
        <div className="side-tabs" role="tablist" aria-label={tt('Workspace')}>
          {tabs.map(([id, Icon, label, busy]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`side-tab${tab === id ? ' active' : ''}`} onClick={() => openTab(id)} title={label}>
              <span className="side-tab-icon">
                <Icon size={17} />
                {busy && <span className="busy-dot" />}
                {id === 'qc' && qcCount > 0 && <span className="count">{qcCount > 99 ? '99+' : qcCount}</span>}
              </span>
              <span className="side-tab-label">{label}</span>
            </button>
          ))}
        </div>
        <div className="side-body">
          {tab === 'subtitles' && <SegmentList segments={segments} profile={profile} activeId={activeId} selected={selected} issuesBySegment={issuesBySegment} onSelect={select} />}
          {tab === 'transcription' && (
            <TranscriptionPanel
              media={media}
              sourceLanguage={project.sourceLanguage}
              segmentCount={segments.length}
              protectedCount={protectedCount}
              state={transcription.state}
              onStart={(language, mode, options) => media && void transcription.start(media.file, language, mode, options)}
              onReview={() => (setQcCategory('transcription'), openTab('qc'))}
              onCancel={transcription.cancel}
              onAttach={() => void attachMedia()}
              onNext={() => openTab('translation')}
            />
          )}
          {tab === 'qc' && (
            <QcPanel
              issues={issues}
              qcProfileLabel={t(qcProfile.label)}
              sourceCounts={sourceCounts}
              audioAnalysed={Boolean(media?.activity)}
              canPlay={Boolean(media)}
              category={qcCategory}
              onCategory={setQcCategory}
              onJump={jumpToIssue}
              onPlay={playIssue}
              onVerify={(id) => setSrcStatus([id], 'verified')}
            />
          )}
          {tab === 'localization' && (
            <LocalizationPanel segments={segments} profile={profile} neutralYat={project.neutralYat} termbase={SEED_TERMBASE} rules={rules} activeId={activeId} onApply={applyTexts} onJump={(id) => select(id)} />
          )}
          {tab === 'translation' && (
            <TranslationPanel
              segments={segments}
              profile={profile}
              sourceLanguage={project.sourceLanguage}
              providerId={settings.translation.providerId}
              selected={selectedIds}
              progress={job.progress}
              running={job.running}
              staleIds={staleIds}
              onRetranslateStale={() => retranslateStale(staleIds)}
              onStart={(o) => requestTranslate(o)}
              onPause={job.pause}
              onResume={job.resume}
              onCancel={job.cancel}
              onOpenModels={() => nav.go('models')}
              onTranscribe={() => openTab('transcription')}
            />
          )}
          {tab === 'find' && <FindReplacePanel segments={segments} profile={profile} activeId={activeId} focusToken={findToken} onJump={(id) => select(id)} onReplace={(fn) => mapSegments(fn)} />}
          {tab === 'tools' && (
            <ToolsPanel
              segments={segments}
              profile={profile}
              sourceLanguage={project.sourceLanguage}
              neutralYat={project.neutralYat}
              selected={selectedIds}
              onChange={(fn: (s: Segment[]) => Segment[]) => mapSegments(fn)}
              onProject={(patch) => editor.updateProject(patch)}
            />
          )}
        </div>
      </aside>

      <section className="st-center">
        <VideoPanel
          ref={video}
          media={media}
          record={mediaRecord}
          subtitle={overlay}
          onAttach={() => void attachMedia()}
          onDetach={() => {
            clearSessionMedia(project.id)
            setMedia(null)
          }}
          onTime={setTimeMs}
          onPlayingChange={setPlaying}
        />
      </section>

      <aside className="st-right" aria-label={tt('Inspector')}>
        {active ? (
          <SegmentEditor
            segment={active}
            index={activeIndex}
            profile={profile}
            sourceLanguage={project.sourceLanguage}
            qcProfile={qcProfile}
            issues={issuesBySegment.get(active.id) ?? []}
            terms={terms}
            busy={job.running}
            onSourceCursor={(p) => (sourceCursor.current = p)}
            onSource={(text) => mapSegments((cur) => updateSegment(cur, active.id, { source: text }), `src:${active.id}`)}
            onTranslation={(text) => mapSegments((cur) => editTranslation(cur, active.id, profile, text), `tr:${active.id}:${profile}`)}
            onTiming={(start, end) => mapSegments((cur) => updateSegment(cur, active.id, { start, end }), `time:${active.id}`)}
            onApprove={() => approve(false)}
            onReview={() => mapSegments((cur) => setTranslationState(cur, [active.id], profile, { status: 'needs_review' }))}
            onToggleLock={toggleLock}
            onSplit={split}
            onMergeNext={mergeNext}
            onDelete={remove}
            onAddAfter={addAfter}
            onTranslateThis={() => requestTranslate({ segmentIds: [active.id], retranslateMachine: true })}
            onSourceStatus={(status) => setSrcStatus([active.id], status)}
            onRetranslateStale={() => retranslateStale([active.id])}
            onPlayContext={media ? () => playContext(active.start, active.end) : null}
            focusSourceToken={focusSource}
          />
        ) : (
          <div className="inspector">{emptyState}</div>
        )}
      </aside>

      <div className="st-split" role="separator" aria-orientation="horizontal" aria-label={tt('Resize timeline')} onPointerDown={startResize} />

      <section className="st-timeline">
        <Timeline
          segments={segments}
          profile={profile}
          activeId={activeId}
          selected={selected}
          timeMs={timeMs}
          durationMs={media?.durationMs ?? mediaRecord?.durationMs ?? null}
          peaks={media?.peaks ?? null}
          mediaName={media?.name ?? mediaRecord?.fileName ?? null}
          issuesBySegment={issuesBySegment}
          onSelect={(id, mode) => select(id, mode)}
          onSeek={(ms) => {
            setTimeMs(ms)
            video.current?.seek(ms)
          }}
          onRetime={(id, start, end) => mapSegments((cur) => updateSegment(cur, id, { start, end }), `time:${id}`)}
          onSplit={split}
          onMerge={mergeNext}
          onDelete={remove}
          onAdd={addAfter}
        />
      </section>

      {exportOpen && <ExportDialog project={project} segments={segments} onClose={() => setExportOpen(false)} />}
      {gate && <TranslationGate pending={gate.pending} reviewed={gate.reviewedIds.length} total={gate.total} sameLanguage={sameLanguage} onChoose={chooseGate} onClose={() => setGate(null)} />}
      {staleAsk && (
        <Modal
          title={tt('Replace translations you edited?')}
          onClose={() => setStaleAsk(null)}
          footer={
            <>
              <button className="btn" onClick={() => setStaleAsk(null)}>{tt('Cancel')}</button>
              {staleAsk.machine.length > 0 && (
                <button className="btn primary" autoFocus onClick={() => (setStaleAsk(null), requestTranslate({ segmentIds: staleAsk.machine, retranslateMachine: true }))}>
                  {tt('Only machine translations ({n})', { n: staleAsk.machine.length })}
                </button>
              )}
              <button className="btn danger" onClick={() => (setStaleAsk(null), requestTranslate({ segmentIds: [...staleAsk.machine, ...staleAsk.manual], retranslateMachine: true, overwriteManual: true }))}>
                {tt('Also replace my edits ({n})', { n: staleAsk.manual.length })}
              </button>
            </>
          }
        >
          <p className="small" style={{ color: 'var(--text-1)' }}>{tt('{n} out-of-date translation(s) were edited or approved by you. A new machine translation would replace that work (Ctrl+Z undoes it).', { n: staleAsk.manual.length })}</p>
        </Modal>
      )}
    </div>
  )
}

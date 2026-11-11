import { AlertCircle, AlertTriangle, BadgeCheck, BookText, Check, CheckCheck, Combine, Eye, Flag, History, Languages, Lightbulb, Lock, Play, Plus, Scissors, Trash2, Unlock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getProfile, isAdaptation, sourceLanguageLabel, type ProfileId, type SourceLanguage } from '../../domain/languages'
import { formatDisplayTime, formatDuration, formatSrtTime, parseTimecode } from '../../domain/time'
import { isTranslationStale, SOURCE_STATUS_LABEL, sourceOriginOf, sourceStatusOf, type Segment, type SourceStatus } from '../../domain/types'
import { stripMarkup } from '../../formats/markup'
import type { GlossaryTerm } from '../../glossary/types'
import { useT } from '../../i18n'
import { findTerm } from '../../localization/matching'
import { latinToCyrillic } from '../../localization/transliterate'
import type { QcIssue, QcProfile } from '../../qc'
import { StatusBadge } from '../components/Field'

interface Props {
  segment: Segment
  index: number
  profile: ProfileId
  sourceLanguage: SourceLanguage
  qcProfile: QcProfile
  issues: QcIssue[]
  terms: GlossaryTerm[]
  busy: boolean
  onSourceCursor: (position: number) => void
  onSource: (text: string) => void
  onTranslation: (text: string) => void
  onTiming: (start: number, end: number) => void
  onApprove: () => void
  onReview: () => void
  onToggleLock: () => void
  onSplit: () => void
  onMergeNext: () => void
  onDelete: () => void
  onAddAfter: () => void
  onTranslateThis: () => void
  /** Change the review state of the original text. */
  onSourceStatus: (status: SourceStatus) => void
  /** Re-translate this segment after its original changed (Studio asks before replacing manual work). */
  onRetranslateStale: () => void
  /** Play the subtitle with context (null when no media is attached). */
  onPlayContext: (() => void) | null
  /** Changes when the original textarea should take focus (jump from a QC warning). */
  focusSourceToken: number
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (ms: number) => void }) {
  const t = useT()
  const [text, setText] = useState(formatSrtTime(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setText(formatSrtTime(value))
    setInvalid(false)
  }, [value])
  const commit = () => {
    const ms = parseTimecode(text)
    if (ms === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (ms !== value) onCommit(ms)
  }
  return (
    <label className="field">
      <span className="label">{label}</span>
      <div className="time-input">
        <button className="btn sm icon" onClick={() => onCommit(Math.max(0, value - 100))} title="−100 ms" aria-label={`${label} −100 ms`}>−</button>
        <input
          className={`input mono${invalid ? ' invalid' : ''}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          aria-invalid={invalid}
          title={invalid ? t('Use the format HH:MM:SS,mmm') : undefined}
        />
        <button className="btn sm icon" onClick={() => onCommit(value + 100)} title="+100 ms" aria-label={`${label} +100 ms`}>+</button>
      </div>
    </label>
  )
}

const SEVERITY_ICON = {
  error: <AlertCircle size={14} color="var(--err)" />,
  warning: <AlertTriangle size={14} color="var(--warn)" />,
  suggestion: <Lightbulb size={14} color="var(--info)" />,
}

export function SegmentEditor(props: Props) {
  const t = useT()
  const { segment, index, profile, qcProfile, issues, terms, busy, sourceLanguage } = props
  const def = getProfile(profile)
  const tr = segment.translations[profile]
  const locked = Boolean(tr?.locked)
  const text = tr?.text ?? ''
  const duration = segment.end - segment.start
  const lines = stripMarkup(text).split('\n')
  const chars = stripMarkup(text).replace(/\n/g, '').length
  const cps = duration > 0 ? chars / (duration / 1000) : 0
  const sameLanguage = isAdaptation(sourceLanguage, profile)
  const sourceStatus = sourceStatusOf(segment)
  const stale = isTranslationStale(segment, tr)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (props.focusSourceToken) sourceRef.current?.focus()
  }, [props.focusSourceToken])

  const hints = terms.filter((g) => g.kind === 'terminology' && findTerm(stripMarkup(segment.source), g.sourceTerm, { wholeWord: g.wholeWord, caseSensitive: g.caseSensitive }).length)

  const errors = issues.filter((x) => x.severity === 'error').length
  const warnings = issues.filter((x) => x.severity === 'warning').length

  return (
    <div className="inspector editor-panel">
      <div className="insp-head">
        <span className="insp-title">{t('Subtitle #{n}', { n: index + 1 })}</span>
        <StatusBadge tr={tr} />
        {locked && <span className="pill"><Lock size={11} /> {t('Locked')}</span>}
        <span className="spacer" />
        <button className="tbtn" title={t('Add a subtitle after this one')} aria-label={t('Add a subtitle after this one')} onClick={props.onAddAfter}><Plus size={15} /></button>
      </div>
      <div className="insp-body">
        <details className="insp-sec" open>
          <summary>{t('Text')}</summary>
          <div className="insp-sec-body">
            <div className="field">
              <div className="row src-head">
                <span className="label">{t('Original')} · {t(sourceLanguageLabel(sourceLanguage))}</span>
                <span className={`src-chip src-${sourceStatus}`} title={sourceOriginOf(segment) === 'whisper' ? t('Transcribed by Whisper') : sourceOriginOf(segment) === 'manual' ? t('Written by hand') : t('Imported')}>
                  <i /> {t(SOURCE_STATUS_LABEL[sourceStatus])}
                </span>
                <span className="spacer" />
                {props.onPlayContext && (
                  <button className="tbtn" onClick={props.onPlayContext} title={t('Play with 1.5 s before and after')} aria-label={t('Play with 1.5 s before and after')}><Play size={14} /></button>
                )}
                <button className={`tbtn${sourceStatus === 'verified' ? ' on' : ''}`} onClick={() => props.onSourceStatus('verified')} title={t('I listened: the text is correct (verified)')} aria-label={t('Mark as verified')}><CheckCheck size={15} /></button>
                <button className={`tbtn${sourceStatus === 'needs-review' ? ' on' : ''}`} onClick={() => props.onSourceStatus('needs-review')} title={t('Mark the original for review')} aria-label={t('Mark the original for review')}><Flag size={14} /></button>
                <button className={`tbtn${sourceStatus === 'approved' ? ' on' : ''}`} onClick={() => props.onSourceStatus('approved')} title={t('Approve the original as final')} aria-label={t('Approve the original as final')}><BadgeCheck size={15} /></button>
              </div>
              <textarea ref={sourceRef} className="textarea source" rows={3} value={segment.source} aria-label={t('Original')} onChange={(e) => props.onSource(e.target.value)} onSelect={(e) => props.onSourceCursor(e.currentTarget.selectionStart)} spellCheck={false} />
            </div>
            <label className="field">
              <span className="label">{t('Subtitle in')} {t(def.label)}</span>
              <textarea
                className="textarea target"
                rows={3}
                value={text}
                readOnly={locked}
                lang={def.language === 'en' ? 'en' : def.variant === 'hr' ? 'hr' : def.variant === 'bs' ? 'bs' : def.script === 'Cyrl' ? 'sr-Cyrl' : 'sr-Latn'}
                placeholder={locked ? t('Locked') : t('Type the subtitle text…')}
                onChange={(e) => props.onTranslation(e.target.value)}
              />
              <div className="line-stats">
                {lines.map((l, i) => (
                  <span key={i} className={l.length > qcProfile.maxCharsPerLine ? 'over' : ''} title={t('Characters in line {n}', { n: i + 1 })}>{t('L{n}', { n: i + 1 })} {l.length}</span>
                ))}
                <span className={cps > qcProfile.maxCps ? 'over' : ''} title={t('Characters per second (reading speed)')}>{cps.toFixed(1)} {t('ch/s')}</span>
              </div>
              {tr?.error && <span className="hint" style={{ color: 'var(--warn)' }}>{tr.error}</span>}
            </label>
            {stale && (
              <div className="callout warn stale-note">
                <History size={15} />
                <div className="small grow">
                  <strong>{t('Translation is out of date.')}</strong> {t('The original changed after this translation was made. The translation is kept as it is.')}
                  {tr?.sourceText && <div className="tiny muted" style={{ marginTop: 3 }}>{t('It was made from: "{text}"', { text: stripMarkup(tr.sourceText) })}</div>}
                  <div style={{ marginTop: 6 }}>
                    <button className="btn sm" onClick={props.onRetranslateStale} disabled={busy || locked}><Languages size={13} /> {sameLanguage ? t('Adapt again') : t('Translate again')}</button>
                  </div>
                </div>
              </div>
            )}
            <div className="insp-actions">
              <button className="btn sm primary" onClick={props.onApprove} disabled={!text.trim()} title={t('Approve (Ctrl+Enter)')}><Check size={13} /> {t('Approve')}</button>
              <button className="btn sm" onClick={props.onTranslateThis} disabled={busy || locked}><Languages size={13} /> {sameLanguage ? t('Adapt') : t('Translate')}</button>
              <button className="tbtn" onClick={props.onReview} disabled={!text.trim()} title={t('Needs review')} aria-label={t('Needs review')}><Eye size={15} /></button>
              <button className={`tbtn${locked ? ' on' : ''}`} onClick={props.onToggleLock} title={t('Lock / unlock (Ctrl+L)')} aria-label={locked ? t('Unlock') : t('Lock')}>{locked ? <Unlock size={15} /> : <Lock size={15} />}</button>
            </div>
          </div>
        </details>

        <details className="insp-sec" open>
          <summary>{t('Timing')} <span className="sum-meta mono">{formatDuration(duration)}</span></summary>
          <div className="insp-sec-body">
            <div className="grid-2">
              <TimeField label={t('Start')} value={segment.start} onCommit={(ms) => props.onTiming(ms, segment.end)} />
              <TimeField label={t('End')} value={segment.end} onCommit={(ms) => props.onTiming(segment.start, ms)} />
            </div>
            <div className="insp-actions">
              <button className="btn sm" onClick={props.onSplit} title={t('Split at the cursor position in the original (Ctrl+Shift+S)')}><Scissors size={13} /> {t('Split')}</button>
              <button className="btn sm" onClick={props.onMergeNext} title={t('Merge with next (Ctrl+M)')}><Combine size={13} /> {t('Merge with next')}</button>
              <button className="tbtn danger" onClick={props.onDelete} title={t('Delete')} aria-label={t('Delete')}><Trash2 size={15} /></button>
            </div>
          </div>
        </details>

        <details className="insp-sec" open={issues.length > 0}>
          <summary>
            {t('Quality control')}
            <span className="sum-meta">
              {errors > 0 && <span className="pill err">{errors}</span>}
              {warnings > 0 && <span className="pill warn">{warnings}</span>}
              {issues.length === 0 && <span className="pill ok"><Check size={11} /></span>}
            </span>
          </summary>
          <div className="insp-sec-body">
            {issues.length === 0 && <span className="small muted">{t('No issues for this subtitle.')}</span>}
            {issues.map((issue) => (
              <div key={issue.id} className="issue-mini">
                {SEVERITY_ICON[issue.severity]}
                <span>
                  <strong>{issue.title}.</strong> {issue.message}
                  <span className="issue-fix">{issue.suggestion}</span>
                </span>
              </div>
            ))}
          </div>
        </details>

        {hints.length > 0 && (
          <details className="insp-sec" open>
            <summary>{t('Terminology')} <span className="sum-meta">{hints.length}</span></summary>
            <div className="insp-sec-body">
              {hints.map((h) => (
                <div key={h.id} className="issue-mini">
                  <BookText size={14} color="var(--accent-strong)" />
                  <span>
                    <strong>{h.sourceTerm}</strong> → {def.script === 'Cyrl' ? latinToCyrillic(h.targetTerm) : h.targetTerm}
                    {(h.alternatives ?? []).length > 0 && <span className="muted"> ({t('also')}: {(h.alternatives ?? []).map((a) => (def.script === 'Cyrl' ? latinToCyrillic(a) : a)).join(', ')})</span>}
                    {h.notes && <span className="muted"> — {h.notes}</span>}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="insp-foot tiny subtle mono">
          {formatDisplayTime(segment.start)} → {formatDisplayTime(segment.end)} · {t('original {n} characters', { n: stripMarkup(segment.source).length })}
        </div>
      </div>
    </div>
  )
}

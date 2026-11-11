import { AlertCircle, AlertTriangle, Check, Lightbulb, Play, ShieldCheck, Volume2 } from 'lucide-react'
import { useMemo, useState, type ReactElement } from 'react'
import { SOURCE_STATUS_LABEL, SOURCE_STATUSES, type SourceStatus } from '../../../domain/types'
import { summarize, type QcCategory, type QcIssue, type QcSeverity } from '../../../qc'
import { useT } from '../../../i18n'

const ICON: Record<QcSeverity, ReactElement> = {
  error: <AlertCircle size={14} color="var(--err)" />,
  warning: <AlertTriangle size={14} color="var(--warn)" />,
  suggestion: <Lightbulb size={14} color="var(--info)" />,
}
const CATEGORIES: Array<QcCategory | 'all'> = ['all', 'transcription', 'timing', 'readability', 'language', 'terminology', 'formatting']

const CATEGORY_LABEL: Record<QcCategory | 'all', string> = {
  all: 'All categories',
  transcription: 'Transcription',
  timing: 'Timing',
  readability: 'Readability',
  language: 'Language',
  terminology: 'Terminology',
  formatting: 'Formatting',
}

interface Props {
  issues: QcIssue[]
  qcProfileLabel: string
  /** Counts of original-text review states (only shown when the project has transcribed text). */
  sourceCounts: Record<SourceStatus, number> | null
  /** Audio of the attached media was analysed in this session (silence/activity checks). */
  audioAnalysed: boolean
  canPlay: boolean
  category: QcCategory | 'all'
  onCategory: (category: QcCategory | 'all') => void
  onJump: (issue: QcIssue) => void
  onPlay: (issue: QcIssue) => void
  onVerify: (segmentId: string) => void
}

export function QcPanel({ issues, qcProfileLabel, sourceCounts, audioAnalysed, canPlay, category, onCategory: setCategory, onJump, onPlay, onVerify }: Props) {
  const t = useT()
  const [severity, setSeverity] = useState<Record<QcSeverity, boolean>>({ error: true, warning: true, suggestion: false })
  const counts = summarize(issues)
  const visible = useMemo(() => issues.filter((i) => severity[i.severity] && (category === 'all' || i.category === category)), [issues, severity, category])
  const transcriptionCount = issues.filter((i) => i.category === 'transcription' && i.severity !== 'suggestion').length

  return (
    <>
      <div className="filters">
        {(['error', 'warning', 'suggestion'] as QcSeverity[]).map((s) => (
          <button key={s} className={`btn sm${severity[s] ? ' active' : ''}`} onClick={() => setSeverity((v) => ({ ...v, [s]: !v[s] }))}>
            {ICON[s]} {s === 'error' ? t('Errors') : s === 'warning' ? t('Warnings') : t('Suggestions')} <span className="muted">{counts[s]}</span>
          </button>
        ))}
        <select className="select" style={{ width: 150, height: 24 }} value={category} onChange={(e) => setCategory(e.target.value as QcCategory | 'all')} aria-label={t('Category')}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{t(CATEGORY_LABEL[c])}{c === 'transcription' && transcriptionCount ? ` (${transcriptionCount})` : ''}</option>
          ))}
        </select>
        <span className="spacer" />
        <span className="tiny subtle">{t('Profile: {profile} · QC never changes text', { profile: qcProfileLabel })}</span>
      </div>
      {sourceCounts && (
        <div className="review-strip" aria-label={t('Review of the original text')}>
          <span className="tiny subtle">{t('Original:')}</span>
          {SOURCE_STATUSES.map((st) => (
            <span key={st} className={`src-chip src-${st}`} title={t(SOURCE_STATUS_LABEL[st])}>
              <i /> {t(SOURCE_STATUS_LABEL[st])} <b>{sourceCounts[st]}</b>
            </span>
          ))}
          {!audioAnalysed && <span className="tiny subtle"><Volume2 size={11} /> {t('Silence checks need the video/audio attached in this session.')}</span>}
        </div>
      )}
      <div className="dock-body">
        {visible.length === 0 && (
          <div className="empty small qc-empty">
            <ShieldCheck size={22} color="var(--ok)" />
            <strong>{issues.length ? t('No issues match the filter.') : t('No issues found.')}</strong>
            {!issues.length && <span className="tiny muted">{t('Checked: transcription (silence, repetition, audio activity), timing, readability, language and terminology. Suggestions are hidden by default.')}</span>}
          </div>
        )}
        {visible.slice(0, 1000).map((i) => {
          const playable = canPlay && (i.segmentId || i.range)
          const verifiable = i.category === 'transcription' && i.segmentId && !i.range
          return (
            <div key={i.id} className="qc-row" onClick={() => onJump(i)} title={t('Jump to subtitle')}>
              {ICON[i.severity]}
              <span className="mono subtle">{i.range && !i.segmentNumber ? t('gap') : i.segmentNumber ? `#${i.segmentNumber}` : t('project')}</span>
              <span className="title">{i.title}</span>
              <span>
                {i.message} <span className="sugg">— {i.suggestion}</span>
              </span>
              <span className="qc-actions">
                {playable && (
                  <button className="tbtn" onClick={(e) => (e.stopPropagation(), onPlay(i))} title={t('Play with 1.5 s before and after')} aria-label={t('Play with 1.5 s before and after')}>
                    <Play size={13} />
                  </button>
                )}
                {verifiable && (
                  <button className="tbtn" onClick={(e) => (e.stopPropagation(), onVerify(i.segmentId!))} title={t('I listened: the text is correct (verified)')} aria-label={t('Mark as verified')}>
                    <Check size={13} />
                  </button>
                )}
                <span className="badge">{t(CATEGORY_LABEL[i.category])}</span>
              </span>
            </div>
          )
        })}
        {visible.length > 1000 && <div className="empty small">{t('Showing the first 1000 of {n} issues.', { n: visible.length })}</div>}
      </div>
    </>
  )
}

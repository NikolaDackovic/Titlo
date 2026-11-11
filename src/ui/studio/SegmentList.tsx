import { History, Lock, Search } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ProfileId } from '../../domain/languages'
import { formatDisplayTime } from '../../domain/time'
import { isTranslationStale, needsSourceReview, SOURCE_STATUS_LABEL, sourceOriginOf, sourceStatusOf, TRANSLATION_STATUS_LABEL, type Segment, type TranslationStatus } from '../../domain/types'
import { stripMarkup } from '../../formats/markup'
import type { QcIssue } from '../../qc'
import { statusDotClass } from '../components/Field'
import { t, useT } from '../../i18n'

type Filter = 'all' | 'untranslated' | 'needs_review' | 'issues' | 'approved' | 'failed' | 'src-review' | 'src-verified' | 'src-edited' | 'stale'

interface Props {
  segments: Segment[]
  profile: ProfileId
  activeId: string | null
  selected: Set<string>
  issuesBySegment: Map<string, QcIssue[]>
  onSelect: (id: string, mode: 'single' | 'toggle' | 'range') => void
}

const matchesFilter = (s: Segment, profile: ProfileId, filter: Filter, issues: QcIssue[] | undefined) => {
  const tr = s.translations[profile]
  const status: TranslationStatus = tr?.text.trim() ? tr.status : 'not_translated'
  switch (filter) {
    case 'all':
      return true
    case 'untranslated':
      return status === 'not_translated'
    case 'needs_review':
      return status === 'needs_review' || tr?.origin === 'test'
    case 'approved':
      return status === 'approved'
    case 'failed':
      return status === 'failed'
    case 'issues':
      return Boolean(issues?.some((i) => i.severity !== 'suggestion'))
    case 'src-review':
      return needsSourceReview(s)
    case 'src-verified':
      return sourceStatusOf(s) === 'verified' || sourceStatusOf(s) === 'approved'
    case 'src-edited':
      return sourceStatusOf(s) === 'manually-edited'
    case 'stale':
      return isTranslationStale(s, tr)
  }
}

const Row = memo(function Row({ segment, index, profile, active, selected, issues, onSelect }: {
  segment: Segment
  index: number
  profile: ProfileId
  active: boolean
  selected: boolean
  issues: QcIssue[] | undefined
  onSelect: Props['onSelect']
}) {
  const tr = segment.translations[profile]
  const errors = issues?.filter((i) => i.severity === 'error').length ?? 0
  const warnings = issues?.filter((i) => i.severity === 'warning').length ?? 0
  const srcStatus = sourceStatusOf(segment)
  // Imported, never-touched originals stay unmarked to keep the list calm.
  const showSrc = srcStatus !== 'unreviewed' || sourceOriginOf(segment) === 'whisper'
  const stale = isTranslationStale(segment, tr)
  return (
    <div
      className={`seg-row${active ? ' active' : ''}${selected && !active ? ' selected' : ''}`}
      data-segment-id={segment.id}
      onClick={(e) => onSelect(segment.id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single')}
    >
      <span className="num">{index + 1}</span>
      <span className="times">
        {formatDisplayTime(segment.start)} → {formatDisplayTime(segment.end)}
      </span>
      <span className="flags">
        {tr?.locked && <Lock size={11} className="subtle" />}
        {stale && <History size={11} color="var(--warn)" aria-label={t('Translation is out of date.')} />}
        {showSrc && <i className={`src-dot src-${srcStatus}`} title={`${t('Original')}: ${t(SOURCE_STATUS_LABEL[srcStatus])}`} />}
        {errors > 0 && <span className="badge err" title={t('{n} QC error(s)', { n: errors })}>{errors}</span>}
        {warnings > 0 && <span className="badge warn" title={t('{n} QC warning(s)', { n: warnings })}>{warnings}</span>}
        <span className={`dot ${statusDotClass(tr)}`} title={t(TRANSLATION_STATUS_LABEL[tr?.status ?? 'not_translated'])} />
      </span>
      <span className="text">
        {tr?.text.trim() ? stripMarkup(tr.text) : <span className="src">{stripMarkup(segment.source) || t('(empty)')}</span>}
      </span>
    </div>
  )
})

export function SegmentList({ segments, profile, activeId, selected, issuesBySegment, onSelect }: Props) {
  const tt = useT()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const listRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => matchesFilter(segment, profile, filter, issuesBySegment.get(segment.id)))
      .filter(({ segment }) => !q || segment.source.toLowerCase().includes(q) || (segment.translations[profile]?.text ?? '').toLowerCase().includes(q))
  }, [segments, profile, filter, query, issuesBySegment])

  // Keep the active row visible (keyboard navigation, jump from QC/timeline).
  useEffect(() => {
    if (!activeId) return
    const el = listRef.current?.querySelector(`[data-segment-id="${CSS.escape(activeId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return (
    <div className="panel" style={{ minHeight: 0 }}>
      <div className="panel-head" style={{ gap: 6 }}>
        <Search size={13} className="muted" />
        <input className="input" style={{ height: 24, border: 0, background: 'transparent', padding: 0 }} placeholder={tt('Search subtitles…')} aria-label={tt('Search subtitles…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="tiny subtle">{visible.length}/{segments.length}</span>
      </div>
      <div className="filters" style={{ padding: '5px 8px' }}>
        <select className="select" style={{ height: 24, fontSize: 12 }} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">{tt('All subtitles')}</option>
          <option value="untranslated">{tt('Not translated')}</option>
          <option value="needs_review">{tt('Needs review')}</option>
          <option value="issues">{tt('With QC errors/warnings')}</option>
          <option value="failed">{tt('Failed')}</option>
          <option value="approved">{tt('Approved')}</option>
          <optgroup label={tt('Original text')}>
            <option value="src-review">{tt('Original: to review')}</option>
            <option value="src-edited">{tt('Original: edited by you')}</option>
            <option value="src-verified">{tt('Original: verified or approved')}</option>
            <option value="stale">{tt('Translation out of date')}</option>
          </optgroup>
        </select>
        {selected.size > 1 && <span className="badge accent">{tt('{n} selected', { n: selected.size })}</span>}
      </div>
      <div className="seg-list" ref={listRef}>
        {segments.length === 0 && (
          <div className="empty">
            <h3>{tt('No subtitles yet')}</h3>
            <p className="small">{tt('Transcribe the video, import a subtitle file or add a line by hand.')}</p>
          </div>
        )}
        {visible.map(({ segment, index }) => (
          <Row
            key={segment.id}
            segment={segment}
            index={index}
            profile={profile}
            active={segment.id === activeId}
            selected={selected.has(segment.id)}
            issues={issuesBySegment.get(segment.id)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

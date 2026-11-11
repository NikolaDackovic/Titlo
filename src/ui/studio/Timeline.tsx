import { Combine, Film, Maximize2, Plus, Scissors, Trash2, Type, Volume2, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProfileId } from '../../domain/languages'
import { formatDisplayTime } from '../../domain/time'
import { isTranslationStale, sourceOriginOf, sourceStatusOf, type Segment } from '../../domain/types'
import { stripMarkup } from '../../formats/markup'
import { useT } from '../../i18n'
import type { QcIssue } from '../../qc'
import { Waveform } from './Waveform'

interface Props {
  segments: Segment[]
  profile: ProfileId
  activeId: string | null
  selected: Set<string>
  timeMs: number
  durationMs: number | null
  peaks: Float32Array | null
  mediaName: string | null
  issuesBySegment: Map<string, QcIssue[]>
  onSelect: (id: string, mode: 'single' | 'toggle' | 'range') => void
  onSeek: (ms: number) => void
  /** Live retiming while dragging a block (coalesced into one undo step per segment). */
  onRetime: (id: string, start: number, end: number) => void
  onSplit: () => void
  onMerge: () => void
  onDelete: () => void
  onAdd: () => void
}

const MIN_PPS = 0.05
const MAX_PPS = 400
const MIN_DURATION_MS = 200
const HEAD_W = 84 // track header column

/** Ruler step (seconds) so labels stay ~80 px apart. */
function tickStep(pps: number) {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]) if (s * pps >= 80) return s
  return 7200
}

type Drag = { id: string; mode: 'move' | 'start' | 'end'; x0: number; start0: number; end0: number; moved: boolean; additive: 'single' | 'toggle' | 'range' }

export function Timeline(p: Props) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pps, setPps] = useState(40)
  const [view, setView] = useState({ left: 0, width: 1200 })
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const contentEnd = useMemo(() => Math.max(p.durationMs ?? 0, p.segments.reduce((m, s) => Math.max(m, s.end), 0)), [p.durationMs, p.segments])
  const end = contentEnd + 3000
  const width = Math.max((end / 1000) * pps, view.width)
  const x = useCallback((ms: number) => (ms / 1000) * pps, [pps])

  // Track the visible window (for virtualisation) and container width.
  const sync = useCallback(() => {
    const el = scrollRef.current
    if (el) setView({ left: el.scrollLeft, width: el.clientWidth })
  }, [])
  useLayoutEffect(() => {
    sync()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sync])

  const fit = useCallback(() => {
    const el = scrollRef.current
    if (!el || contentEnd <= 0) return
    setPps(Math.min(MAX_PPS, Math.max(MIN_PPS, (el.clientWidth - 24) / (contentEnd / 1000))))
    el.scrollLeft = 0
  }, [contentEnd])

  // Zoom around the playhead.
  const zoomTo = (next: number) => {
    const el = scrollRef.current
    const clamped = Math.min(MAX_PPS, Math.max(MIN_PPS, next))
    if (el) {
      const anchorMs = p.timeMs
      const offset = x(anchorMs) - el.scrollLeft
      setPps(clamped)
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, (anchorMs / 1000) * clamped - offset)
        sync()
      })
    } else setPps(clamped)
  }

  // Keep the active subtitle in view.
  useEffect(() => {
    const seg = p.segments.find((s) => s.id === p.activeId)
    const el = scrollRef.current
    if (!seg || !el || drag.current) return
    const sx = x(seg.start)
    const ex = x(seg.end)
    if (sx < el.scrollLeft || ex > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, sx - el.clientWidth / 3)
  }, [p.activeId, p.segments, x])

  const step = tickStep(pps)
  const ticks = useMemo(() => {
    const out: number[] = []
    const first = Math.floor(view.left / pps / step) * step
    const last = (view.left + view.width) / pps + step
    for (let s = Math.max(0, first); s <= last; s += step) out.push(s)
    return out
  }, [view, pps, step])

  // Only render blocks near the visible window (projects can have thousands of subtitles).
  const visible = useMemo(() => {
    const fromMs = ((view.left - view.width) / pps) * 1000
    const toMs = ((view.left + 2 * view.width) / pps) * 1000
    const out: Array<{ s: Segment; i: number }> = []
    p.segments.forEach((s, i) => {
      if (s.end >= fromMs && s.start <= toMs) out.push({ s, i })
    })
    return out
  }, [p.segments, view, pps])

  const seekAt = (clientX: number) => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    p.onSeek(Math.max(0, ((clientX - rect.left + el.scrollLeft) / pps) * 1000))
  }

  const onBlockDown = (e: React.PointerEvent, s: Segment) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const target = e.target as HTMLElement
    const mode = target.classList.contains('h-start') ? 'start' : target.classList.contains('h-end') ? 'end' : 'move'
    drag.current = { id: s.id, mode, x0: e.clientX, start0: s.start, end0: s.end, moved: false, additive: e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single' }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onBlockMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(dx) < 4) return
    if (!d.moved) {
      d.moved = true
      setDragging(d.id)
    }
    const dms = Math.round(((dx / pps) * 1000) / 10) * 10
    if (d.mode === 'move') {
      const start = Math.max(0, d.start0 + dms)
      p.onRetime(d.id, start, start + (d.end0 - d.start0))
    } else if (d.mode === 'start') {
      p.onRetime(d.id, Math.min(Math.max(0, d.start0 + dms), d.end0 - MIN_DURATION_MS), d.end0)
    } else {
      p.onRetime(d.id, d.start0, Math.max(d.start0 + MIN_DURATION_MS, d.end0 + dms))
    }
  }
  const onBlockUp = () => {
    const d = drag.current
    drag.current = null
    setDragging(null)
    if (d && !d.moved) p.onSelect(d.id, d.additive)
  }

  const active = p.segments.find((s) => s.id === p.activeId)

  return (
    <div className="tl">
      <div className="tl-toolbar">
        <div className="tl-tools">
          <button className="tbtn" onClick={p.onSplit} disabled={!active} title={t('Split at the cursor position in the original (Ctrl+Shift+S)')} aria-label={t('Split')}><Scissors size={15} /></button>
          <button className="tbtn" onClick={p.onMerge} disabled={!active} title={t('Merge with next (Ctrl+M)')} aria-label={t('Merge with next')}><Combine size={15} /></button>
          <button className="tbtn" onClick={p.onAdd} title={t('Add a subtitle after this one')} aria-label={t('Add a subtitle after this one')}><Plus size={15} /></button>
          <button className="tbtn danger" onClick={p.onDelete} disabled={!active} title={t('Delete')} aria-label={t('Delete')}><Trash2 size={15} /></button>
        </div>
        <span className="tl-time mono"><strong>{formatDisplayTime(p.timeMs)}</strong><span> / {formatDisplayTime(contentEnd)}</span></span>
        <span className="tl-count">{t('{n} subtitles', { n: p.segments.length })}</span>
        <span className="spacer" />
        <div className="tl-zoom">
          <button className="tbtn" onClick={() => zoomTo(pps / 1.5)} aria-label={t('Zoom out')} title={t('Zoom out')}><ZoomOut size={15} /></button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 1000)}
            onChange={(e) => zoomTo(MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, Number(e.target.value) / 1000))}
            aria-label={t('Zoom')}
          />
          <button className="tbtn" onClick={() => zoomTo(pps * 1.5)} aria-label={t('Zoom in')} title={t('Zoom in')}><ZoomIn size={15} /></button>
          <button className="tbtn" onClick={fit} title={t('Fit timeline')} aria-label={t('Fit timeline')}><Maximize2 size={14} /></button>
        </div>
      </div>

      <div className="tl-body">
        <div className="tl-heads" style={{ width: HEAD_W }}>
          <div className="tl-head ruler-head" />
          <div className="tl-head sub"><Type size={13} /> {t('Subtitles')}</div>
          <div className="tl-head audio"><Volume2 size={13} /> {t('Audio')}</div>
          <div className="tl-head video"><Film size={13} /> {t('Video')}</div>
        </div>
        <div className="tl-scroll" ref={scrollRef} onScroll={sync}>
          <div className="tl-canvas" style={{ width }}>
            <div className="tl-ruler" onPointerDown={(e) => seekAt(e.clientX)}>
              {ticks.map((s) => (
                <span key={s} className="tl-tick" style={{ left: s * pps }}>{formatDisplayTime(s * 1000).replace(/\.\d+$/, '').replace(/^00:/, '')}</span>
              ))}
            </div>
            <div className="tl-track sub" onPointerDown={(e) => e.target === e.currentTarget && seekAt(e.clientX)}>
              {visible.map(({ s, i }) => {
                const tr = s.translations[p.profile]
                const issues = p.issuesBySegment.get(s.id)
                const err = issues?.some((q) => q.severity === 'error')
                const warn = !err && issues?.some((q) => q.severity === 'warning')
                const state = tr?.status === 'approved' ? 'approved' : tr?.locked ? 'locked' : tr?.text.trim() ? 'translated' : ''
                const w = Math.max(3, x(s.end - s.start))
                const srcStatus = sourceStatusOf(s)
                const src = srcStatus !== 'unreviewed' || sourceOriginOf(s) === 'whisper' ? ` src-${srcStatus}` : ''
                return (
                  <div
                    key={s.id}
                    className={`tl-block ${state}${src}${isTranslationStale(s, tr) ? ' stale' : ''}${s.id === p.activeId ? ' active' : ''}${p.selected.has(s.id) && s.id !== p.activeId ? ' selected' : ''}${dragging === s.id ? ' dragging' : ''}${err ? ' err' : warn ? ' warn' : ''}`}
                    style={{ left: x(s.start), width: w }}
                    title={`#${i + 1}  ${formatDisplayTime(s.start)} → ${formatDisplayTime(s.end)}\n${stripMarkup(tr?.text || s.source)}`}
                    onPointerDown={(e) => onBlockDown(e, s)}
                    onPointerMove={onBlockMove}
                    onPointerUp={onBlockUp}
                    onPointerCancel={onBlockUp}
                  >
                    {w > 14 && <span className="h-start" />}
                    {w > 34 && (
                      <span className="tl-block-text">
                        <b>{i + 1}</b> {stripMarkup(tr?.text || s.source)}
                      </span>
                    )}
                    {w > 14 && <span className="h-end" />}
                  </div>
                )
              })}
            </div>
            <div className="tl-track audio" onPointerDown={(e) => seekAt(e.clientX)}>
              {p.peaks && p.durationMs ? (
                <Waveform className="tl-wave" peaks={p.peaks} width={x(p.durationMs)} height={52} progress={p.timeMs / p.durationMs} />
              ) : (
                <span className="tl-empty-track">{t('The waveform appears after transcription.')}</span>
              )}
            </div>
            <div className="tl-track video" onPointerDown={(e) => seekAt(e.clientX)}>
              {p.mediaName && p.durationMs ? (
                <div className="tl-clip" style={{ width: x(p.durationMs) }}><Film size={12} /> {p.mediaName}</div>
              ) : (
                <span className="tl-empty-track">{t('No video or audio attached')}</span>
              )}
            </div>
            <div className="tl-playhead" style={{ left: x(p.timeMs) }}><span /></div>
          </div>
        </div>
      </div>
    </div>
  )
}

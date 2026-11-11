import { formatDuration } from '../../domain/time'
import type { QcInput, QcIssue } from '../types'
import { t as L } from '../../i18n'

export function checkTiming(input: QcInput): QcIssue[] {
  const { segments, qcProfile: p } = input
  const issues: QcIssue[] = []

  segments.forEach((s, i) => {
    const n = i + 1
    const base = { segmentId: s.id, segmentNumber: n, category: 'timing' as const }
    const duration = s.end - s.start

    if (s.start < 0 || s.end < 0) {
      issues.push({ ...base, id: `neg:${s.id}`, check: 'negative-time', severity: 'error', title: L('Negative timestamp'), message: L('Segment {n} has a negative start or end time.', { n }), suggestion: L('Set the start time to 0 or later.') })
    }
    if (s.end <= s.start) {
      issues.push({ ...base, id: `order:${s.id}`, check: 'end-before-start', severity: 'error', title: L('End before start'), message: L('Segment {n} ends at or before its start.', { n }), suggestion: L('Fix the end time so it is later than the start time.') })
      return
    }
    if (duration > 30_000) {
      issues.push({ ...base, id: `unreal:${s.id}`, check: 'unrealistic-duration', severity: 'error', title: L('Unrealistic duration'), message: L('Segment {n} lasts {duration}.', { n, duration: formatDuration(duration) }), suggestion: L('This is almost certainly a timing error; check the end time.') })
    } else if (duration > p.maxDurationMs) {
      issues.push({ ...base, id: `long:${s.id}`, check: 'too-long', severity: 'warning', title: L('Too long on screen'), message: L('Segment {n} lasts {duration} (max {maxDurationMs}).', { n, duration: formatDuration(duration), maxDurationMs: formatDuration(p.maxDurationMs) }), suggestion: L('Split the subtitle or shorten its duration.') })
    }
    if (duration < p.minDurationMs) {
      issues.push({ ...base, id: `short:${s.id}`, check: 'too-short', severity: 'warning', title: L('Too short on screen'), message: L('Segment {n} lasts {duration} (min {minDurationMs}).', { n, duration: formatDuration(duration), minDurationMs: formatDuration(p.minDurationMs) }), suggestion: L('Extend the end time or merge with a neighbouring subtitle.') })
    }
    if (input.mediaDurationMs && s.end > input.mediaDurationMs + 1000) {
      issues.push({ ...base, id: `pastmedia:${s.id}`, check: 'beyond-media', severity: 'warning', title: L('After end of media'), message: L('Segment {n} ends after the attached media ({mediaDurationMs}).', { n, mediaDurationMs: formatDuration(input.mediaDurationMs) }), suggestion: L('Check the frame rate / sync of the subtitle file.') })
    }

    const prev = segments[i - 1]
    if (!prev) return
    if (s.start < prev.start) {
      issues.push({ ...base, id: `disc:${s.id}`, check: 'discontinuity', severity: 'error', title: L('Timing discontinuity'), message: L('Segment {n} starts before segment {v}.', { n, v: n - 1 }), suggestion: L('Re-order the segments or fix the timestamps.') })
    } else if (s.start < prev.end) {
      issues.push({ ...base, id: `overlap:${s.id}`, check: 'overlap', severity: 'error', title: L('Overlapping subtitles'), message: L('Segment {n} overlaps segment {v} by {end}.', { n, v: n - 1, end: formatDuration(prev.end - s.start) }), suggestion: L('Move the start to {end} or shorten segment {v}.', { end: formatDuration(prev.end + p.minGapMs), v: n - 1 }) })
    } else if (p.minGapMs > 0 && s.start - prev.end < p.minGapMs && s.start !== prev.end) {
      issues.push({ ...base, id: `gap:${s.id}`, check: 'small-gap', severity: 'suggestion', title: L('Very small gap'), message: L('Only {end} ms between segments {v} and {n}.', { end: s.start - prev.end, v: n - 1, n }), suggestion: L('Use a gap of at least {minGapMs} ms or make the subtitles touch (0 ms).', { minGapMs: p.minGapMs }) })
    }
  })
  return issues
}

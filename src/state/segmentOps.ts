import type { ProfileId } from '../domain/languages'
import { isSourceProtected, newId, nowIso, type Segment, type SegmentTranslation, type SourceStatus, type TranslationOrigin, type TranslationStatus } from '../domain/types'
import type { ParsedCue } from '../formats/types'
import { buildTermRegExp, escapeRegExp } from '../localization/matching'
import { latinToCyrillic } from '../localization/transliterate'
import type { SegmentUpdate } from '../translation/engine'

export const segmentsFromCues = (cues: ParsedCue[]): Segment[] =>
  cues.map((c) => ({ id: newId(), start: c.start, end: c.end, source: c.text, translations: {}, meta: c.meta, sourceStatus: 'unreviewed', sourceOrigin: 'import' }))

const mapSegment = (segments: Segment[], id: string, fn: (s: Segment) => Segment) => segments.map((s) => (s.id === id ? fn(s) : s))

/**
 * Change timing and/or original text. Changing the text marks the original "manually-edited"
 * (also after an approval: the approved text no longer exists). Timing changes keep the status.
 */
export function updateSegment(segments: Segment[], id: string, patch: Partial<Pick<Segment, 'start' | 'end' | 'source'>>) {
  return mapSegment(segments, id, (s) => {
    const textChanged = patch.source !== undefined && patch.source !== s.source
    return { ...s, ...patch, ...(textChanged ? { sourceStatus: 'manually-edited' as const } : {}) }
  })
}

/** Set the review state of the original text (explicit user action). */
export function setSourceStatus(segments: Segment[], ids: string[], status: SourceStatus) {
  const set = new Set(ids)
  let changed = false
  const out = segments.map((s) => {
    if (!set.has(s.id) || s.sourceStatus === status) return s
    changed = true
    return { ...s, sourceStatus: status }
  })
  return changed ? out : segments
}

/** Mark segments "needs-review", but only those nobody has decided about yet ("unreviewed"). */
export function flagForReview(segments: Segment[], ids: Iterable<string>) {
  const set = new Set(ids)
  let changed = false
  const out = segments.map((s) => {
    if (!set.has(s.id) || (s.sourceStatus ?? 'unreviewed') !== 'unreviewed') return s
    changed = true
    return { ...s, sourceStatus: 'needs-review' as const }
  })
  return changed ? out : segments
}

export interface TranscriptionMerge {
  segments: Segment[]
  kept: number
  added: number
  dropped: number
}

/**
 * Put a new transcription in place of the old one.
 * - keepProtected: verified, manually-edited and approved originals stay exactly as they are,
 *   and new segments that overlap them in time are not added (the human text wins).
 * - Otherwise everything is replaced (only after an explicit confirmation in the UI).
 */
export function mergeTranscription(current: Segment[], incoming: Segment[], keepProtected: boolean): TranscriptionMerge {
  if (!keepProtected) return { segments: incoming, kept: 0, added: incoming.length, dropped: 0 }
  const keep = current.filter(isSourceProtected)
  if (!keep.length) return { segments: incoming, kept: 0, added: incoming.length, dropped: 0 }
  const overlaps = (a: Segment, b: Segment) => a.start < b.end && b.start < a.end
  const fresh = incoming.filter((n) => !keep.some((k) => overlaps(k, n)))
  return { segments: sortByStart([...keep, ...fresh]), kept: keep.length, added: fresh.length, dropped: incoming.length - fresh.length }
}

/** Set translation text as a manual edit (marks origin manual, never overwritten by batch jobs). */
export function editTranslation(segments: Segment[], id: string, profile: ProfileId, text: string) {
  return mapSegment(segments, id, (s) => {
    const prev = s.translations[profile]
    const tr: SegmentTranslation = {
      text,
      status: text.trim() ? (prev?.status === 'approved' ? 'approved' : prev?.status === 'not_translated' || !prev ? 'translated' : prev.status === 'failed' ? 'translated' : prev.status) : 'not_translated',
      origin: 'manual',
      locked: prev?.locked ?? false,
      providerId: prev?.providerId,
      updatedAt: nowIso(),
      // Written against the current original.
      sourceText: s.source,
    }
    return { ...s, translations: { ...s.translations, [profile]: tr } }
  })
}

export function setTranslationState(segments: Segment[], ids: string[], profile: ProfileId, patch: { status?: TranslationStatus; locked?: boolean }) {
  const set = new Set(ids)
  return segments.map((s) => {
    if (!set.has(s.id)) return s
    const prev: SegmentTranslation = s.translations[profile] ?? { text: '', status: 'not_translated', origin: 'none', locked: false, updatedAt: nowIso() }
    return { ...s, translations: { ...s.translations, [profile]: { ...prev, ...patch, error: patch.status === 'approved' ? undefined : prev.error, updatedAt: nowIso() } } }
  })
}

/** Best split index near `ratio` of the text, preferring whitespace. */
function splitPoint(text: string, ratio: number): number {
  const target = Math.round(text.length * ratio)
  let best = -1
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i]) && (best === -1 || Math.abs(i - target) < Math.abs(best - target))) best = i
  }
  return best === -1 ? target : best
}

const halves = (text: string, at: number): [string, string] => [text.slice(0, at).trim(), text.slice(at).trim()]

export interface SplitResult {
  segments: Segment[]
  newId: string | null
  error?: string
}

/**
 * Split a segment into two. The split position in the source text (cursor, or the
 * whitespace nearest the middle) also determines the time split. Translations are
 * split proportionally and marked "Needs review" because a proportional cut can be wrong.
 */
export function splitSegment(segments: Segment[], id: string, sourceCursor?: number): SplitResult {
  const index = segments.findIndex((s) => s.id === id)
  if (index === -1) return { segments, newId: null, error: 'Segment not found.' }
  const seg = segments[index]
  if (Object.values(seg.translations).some((t) => t?.locked)) return { segments, newId: null, error: 'Unlock the segment before splitting it.' }
  if (seg.end - seg.start < 200) return { segments, newId: null, error: 'Segment is too short to split.' }

  const at = sourceCursor !== undefined && sourceCursor > 0 && sourceCursor < seg.source.length ? sourceCursor : splitPoint(seg.source, 0.5)
  const ratio = seg.source.length ? Math.min(0.9, Math.max(0.1, at / seg.source.length)) : 0.5
  const [srcA, srcB] = halves(seg.source, at)
  const mid = Math.round(seg.start + (seg.end - seg.start) * ratio)

  const trA: Segment['translations'] = {}
  const trB: Segment['translations'] = {}
  for (const [profile, tr] of Object.entries(seg.translations) as Array<[ProfileId, SegmentTranslation | undefined]>) {
    if (!tr) continue
    const [a, b] = halves(tr.text, splitPoint(tr.text, ratio))
    const status: TranslationStatus = tr.text.trim() ? 'needs_review' : tr.status
    trA[profile] = { ...tr, text: a, status, updatedAt: nowIso(), sourceText: srcA }
    trB[profile] = { ...tr, text: b, status, updatedAt: nowIso(), sourceText: srcB }
  }

  // Splitting is a manual edit of the original.
  const first: Segment = { ...seg, end: mid, source: srcA, translations: trA, sourceStatus: 'manually-edited' }
  // WebVTT cue ids must be unique: the new half does not inherit the identifier.
  const secondMeta = seg.meta ? Object.fromEntries(Object.entries(seg.meta).filter(([k]) => k !== 'vttId')) : undefined
  const second: Segment = { id: newId(), start: mid, end: seg.end, source: srcB, translations: trB, meta: secondMeta && Object.keys(secondMeta).length ? secondMeta : undefined, sourceStatus: 'manually-edited', sourceOrigin: seg.sourceOrigin }
  const next = [...segments]
  next.splice(index, 1, first, second)
  return { segments: next, newId: second.id }
}

export function mergeWithNext(segments: Segment[], id: string): { segments: Segment[]; error?: string } {
  const index = segments.findIndex((s) => s.id === id)
  if (index === -1 || index === segments.length - 1) return { segments, error: 'There is no next segment to merge with.' }
  const a = segments[index]
  const b = segments[index + 1]
  if ([a, b].some((s) => Object.values(s.translations).some((t) => t?.locked))) return { segments, error: 'Unlock both segments before merging.' }

  const join = (x: string, y: string) => {
    if (!x.trim()) return y
    if (!y.trim()) return x
    const lines = x.split('\n').length + y.split('\n').length
    return lines <= 2 ? `${x}\n${y}` : `${x} ${y}`
  }
  const profiles = new Set([...Object.keys(a.translations), ...Object.keys(b.translations)] as ProfileId[])
  const translations: Segment['translations'] = {}
  for (const p of profiles) {
    const ta = a.translations[p]
    const tb = b.translations[p]
    const text = join(ta?.text ?? '', tb?.text ?? '')
    const origin: TranslationOrigin = ta?.origin === 'manual' || tb?.origin === 'manual' ? 'manual' : (ta ?? tb)!.origin
    translations[p] = { text, status: text.trim() ? 'needs_review' : 'not_translated', origin, locked: false, updatedAt: nowIso(), sourceText: join(a.source, b.source) }
  }
  const merged: Segment = { ...a, end: Math.max(a.end, b.end), source: join(a.source, b.source), translations, sourceStatus: 'manually-edited' }
  const next = [...segments]
  next.splice(index, 2, merged)
  return { segments: next }
}

export function deleteSegments(segments: Segment[], ids: string[]) {
  const set = new Set(ids)
  return segments.filter((s) => !set.has(s.id))
}

/** Insert an empty segment after `afterId` (or at the start), fitted into the gap when possible. */
export function insertSegmentAfter(segments: Segment[], afterId: string | null, durationMs = 2000, id: string = newId()): { segments: Segment[]; newId: string } {
  const index = afterId ? segments.findIndex((s) => s.id === afterId) : -1
  const prev = index >= 0 ? segments[index] : null
  const next = segments[index + 1] ?? null
  const start = prev ? prev.end + 80 : 0
  let end = start + durationMs
  // Fit into the gap; only if there is no room at all does it overlap (QC then reports it).
  if (next && end > next.start - 80) end = next.start - 80 > start + 100 ? next.start - 80 : start + 500
  const seg: Segment = { id, start, end, source: '', translations: {}, sourceStatus: 'manually-edited', sourceOrigin: 'manual' }
  const out = [...segments]
  out.splice(index + 1, 0, seg)
  return { segments: out, newId: seg.id }
}

export const sortByStart = (segments: Segment[]) => [...segments].sort((a, b) => a.start - b.start || a.end - b.end)

export function shiftTimes(segments: Segment[], deltaMs: number, ids?: string[]) {
  const set = ids ? new Set(ids) : null
  return segments.map((s) => {
    if (set && !set.has(s.id)) return s
    // Clamp at 0 but keep the duration (a large negative shift must not collapse a cue to 0–0).
    const start = Math.max(0, s.start + deltaMs)
    return { ...s, start, end: start + Math.max(0, s.end - s.start) }
  })
}

export interface FindOptions {
  find: string
  field: 'source' | 'translation'
  profile: ProfileId
  caseSensitive: boolean
  wholeWord: boolean
}

const findRegExp = (o: FindOptions) =>
  o.wholeWord ? buildTermRegExp(o.find, { wholeWord: true, caseSensitive: o.caseSensitive }) : new RegExp(escapeRegExp(o.find), o.caseSensitive ? 'gu' : 'giu')

export function findMatches(segments: Segment[], o: FindOptions): Array<{ segmentId: string; count: number }> {
  if (!o.find) return []
  const re = findRegExp(o)
  return segments
    .map((s) => {
      const text = o.field === 'source' ? s.source : (s.translations[o.profile]?.text ?? '')
      return { segmentId: s.id, count: (text.match(re) ?? []).length }
    })
    .filter((m) => m.count > 0)
}

/** Replace in all (or the given) segments. Locked translations are skipped and counted. */
export function replaceAll(segments: Segment[], o: FindOptions & { replace: string; onlyIds?: string[] }) {
  if (!o.find) return { segments, replaced: 0, skippedLocked: 0 }
  const re = findRegExp(o)
  const only = o.onlyIds ? new Set(o.onlyIds) : null
  let replaced = 0
  let skippedLocked = 0
  const out = segments.map((s) => {
    if (only && !only.has(s.id)) return s
    if (o.field === 'source') {
      const count = (s.source.match(re) ?? []).length
      if (!count) return s
      replaced += count
      return { ...s, source: s.source.replace(re, () => o.replace), sourceStatus: 'manually-edited' as const }
    }
    const tr = s.translations[o.profile]
    if (!tr) return s
    const count = (tr.text.match(re) ?? []).length
    if (!count) return s
    if (tr.locked) {
      skippedLocked += count
      return s
    }
    replaced += count
    return { ...s, translations: { ...s.translations, [o.profile]: { ...tr, text: tr.text.replace(re, () => o.replace), origin: 'manual' as const, updatedAt: nowIso(), sourceText: s.source } } }
  })
  return { segments: out, replaced, skippedLocked }
}

/**
 * Derive Serbian Cyrillic from Serbian Latin (deterministic). Existing Cyrillic text that
 * was edited manually, approved or locked is kept unless `overwrite` is set.
 */
export function deriveCyrillic(segments: Segment[], overwrite = false) {
  let created = 0
  let kept = 0
  const out = segments.map((s) => {
    const lat = s.translations['sr-Latn']
    if (!lat?.text.trim()) return s
    const cyr = s.translations['sr-Cyrl']
    if (cyr?.text.trim() && (cyr.locked || (!overwrite && (cyr.origin === 'manual' || cyr.status === 'approved')))) {
      kept += 1
      return s
    }
    created += 1
    const status: TranslationStatus = lat.status === 'approved' ? 'translated' : lat.status
    return {
      ...s,
      translations: {
        ...s.translations,
        'sr-Cyrl': { text: latinToCyrillic(lat.text), status, origin: 'transliteration' as const, locked: false, providerId: 'transliteration', updatedAt: nowIso(), sourceText: lat.sourceText },
      },
    }
  })
  return { segments: out, created, kept }
}

/**
 * Same-language adaptation (sr/hr/bs source → target profile): the source becomes the
 * starting text (transliterated for Cyrillic), marked "Needs review" with origin "machine",
 * so the Localization panel can propose regional changes. Locked, approved and manually
 * edited translations are kept unless `overwriteManual` is set.
 */
export function adaptSourceToProfile(segments: Segment[], profile: ProfileId, cyrillic: boolean, overwriteManual = false, onlyIds?: string[]) {
  let adapted = 0
  let skipped = 0
  const only = onlyIds ? new Set(onlyIds) : null
  const out = segments.map((s) => {
    if (only && !only.has(s.id)) return s
    const tr = s.translations[profile]
    if (!s.source.trim() || tr?.locked || tr?.status === 'approved' || (tr?.origin === 'manual' && tr.text.trim() && !overwriteManual)) {
      skipped += 1
      return s
    }
    adapted += 1
    return {
      ...s,
      translations: {
        ...s.translations,
        [profile]: { text: cyrillic ? latinToCyrillic(s.source) : s.source, status: 'needs_review' as const, origin: 'machine' as const, locked: false, providerId: 'adaptation', updatedAt: nowIso(), sourceText: s.source },
      },
    }
  })
  return { segments: out, adapted, skipped }
}

/** Copy source text into a profile as a starting point (same-language adaptation). */
export function copySourceToProfile(segments: Segment[], profile: ProfileId, cyrillic: boolean) {
  let copied = 0
  const out = segments.map((s) => {
    const tr = s.translations[profile]
    if (tr?.text.trim() || !s.source.trim()) return s
    copied += 1
    return {
      ...s,
      translations: {
        ...s.translations,
        [profile]: { text: cyrillic ? latinToCyrillic(s.source) : s.source, status: 'needs_review' as const, origin: 'manual' as const, locked: false, providerId: 'copy-source', updatedAt: nowIso(), sourceText: s.source },
      },
    }
  })
  return { segments: out, copied }
}

/**
 * Apply translation job updates. An update is ignored when the source changed, the
 * segment was locked/approved meanwhile, or the user edited it manually after the job started.
 */
export function applyTranslationUpdates(segments: Segment[], profile: ProfileId, updates: SegmentUpdate[], jobStartedAt: string) {
  const byId = new Map(updates.map((u) => [u.segmentId, u]))
  let applied = 0
  let ignored = 0
  const out = segments.map((s) => {
    const u = byId.get(s.id)
    if (!u) return s
    const tr = s.translations[profile]
    const editedMeanwhile = tr?.origin === 'manual' && tr.updatedAt > jobStartedAt
    if (u.sourceText !== s.source || tr?.locked || tr?.status === 'approved' || editedMeanwhile) {
      ignored += 1
      return s
    }
    applied += 1
    return {
      ...s,
      translations: {
        ...s.translations,
        [profile]: { text: u.text, status: u.status, origin: u.origin, locked: false, providerId: u.providerId, error: u.error, updatedAt: nowIso(), sourceText: u.sourceText },
      },
    }
  })
  return { segments: out, applied, ignored }
}

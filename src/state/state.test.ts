import { describe, expect, it } from 'vitest'
import type { Segment } from '../domain/types'
import { createHistory, pushHistory, redo, undo } from './history'
import { copySourceToProfile, deriveCyrillic, editTranslation, findMatches, insertSegmentAfter, mergeWithNext, replaceAll, shiftTimes, splitSegment } from './segmentOps'

const base = (): Segment[] => [
  { id: 'a', start: 0, end: 4000, source: 'You know what? I never trusted him.', translations: { 'sr-Latn': { text: 'Znaš šta? Nikad mu nisam verovao.', status: 'translated', origin: 'machine', locked: false, updatedAt: '' } } },
  { id: 'b', start: 4500, end: 6000, source: 'Not even once.', translations: {} },
]

describe('segment operations', () => {
  it('splits at the cursor, splits time proportionally, flags translation for review', () => {
    const r = splitSegment(base(), 'a', 14)
    expect(r.segments).toHaveLength(3)
    const [a1, a2] = r.segments
    expect(a1.source).toBe('You know what?')
    expect(a2.source).toBe('I never trusted him.')
    expect(a1.end).toBe(a2.start)
    expect(a1.end).toBeGreaterThan(1000)
    expect(a1.translations['sr-Latn']?.status).toBe('needs_review')
    expect(`${a1.translations['sr-Latn']?.text} ${a2.translations['sr-Latn']?.text}`).toBe('Znaš šta? Nikad mu nisam verovao.')
  })

  it('refuses to split or merge locked segments', () => {
    const s = base()
    s[0].translations['sr-Latn']!.locked = true
    expect(splitSegment(s, 'a').error).toBeTruthy()
    expect(mergeWithNext(s, 'a').error).toBeTruthy()
  })

  it('merges with next, joining lines and translations', () => {
    const r = mergeWithNext(base(), 'a')
    expect(r.segments).toHaveLength(1)
    expect(r.segments[0]).toMatchObject({ start: 0, end: 6000, source: 'You know what? I never trusted him.\nNot even once.' })
  })

  it('inserts a segment into the gap', () => {
    const r = insertSegmentAfter(base(), 'a')
    const inserted = r.segments[1]
    expect(inserted.start).toBe(4080)
    expect(inserted.end).toBeLessThanOrEqual(4420)
  })

  it('find & replace respects whole words, locks and marks manual origin', () => {
    const s = base()
    expect(findMatches(s, { find: 'šta', field: 'translation', profile: 'sr-Latn', caseSensitive: false, wholeWord: true })).toEqual([{ segmentId: 'a', count: 1 }])
    const r = replaceAll(s, { find: 'šta', replace: 'što', field: 'translation', profile: 'sr-Latn', caseSensitive: false, wholeWord: true })
    expect(r.replaced).toBe(1)
    expect(r.segments[0].translations['sr-Latn']).toMatchObject({ text: 'Znaš što? Nikad mu nisam verovao.', origin: 'manual' })
    s[0].translations['sr-Latn']!.locked = true
    expect(replaceAll(s, { find: 'šta', replace: 'x', field: 'translation', profile: 'sr-Latn', caseSensitive: false, wholeWord: true }).skippedLocked).toBe(1)
  })

  it('derives Serbian Cyrillic from Latin and keeps manual Cyrillic edits', () => {
    const s = base()
    s[1].translations['sr-Latn'] = { text: 'Ni jednom, Ljubo.', status: 'approved', origin: 'manual', locked: false, updatedAt: '' }
    s[1].translations['sr-Cyrl'] = { text: 'Ручно.', status: 'translated', origin: 'manual', locked: false, updatedAt: '' }
    const r = deriveCyrillic(s)
    expect(r.created).toBe(1)
    expect(r.kept).toBe(1)
    expect(r.segments[0].translations['sr-Cyrl']).toMatchObject({ text: 'Знаш шта? Никад му нисам веровао.', origin: 'transliteration' })
    expect(r.segments[1].translations['sr-Cyrl']?.text).toBe('Ручно.')
    expect(deriveCyrillic(s, true).segments[1].translations['sr-Cyrl']?.text).toBe('Ни једном, Љубо.')
  })

  it('manual edit sets origin manual', () => {
    const r = editTranslation(base(), 'b', 'hr', 'Ni jednom.')
    expect(r[1].translations.hr).toMatchObject({ text: 'Ni jednom.', origin: 'manual', status: 'translated' })
  })

  it('copies source for same-language adaptation and shifts timing', () => {
    expect(copySourceToProfile(base(), 'hr', false).copied).toBe(2)
    expect(shiftTimes(base(), -500)[0]).toMatchObject({ start: 0, end: 4000 }) // duration kept (code review fix)
  })
})

describe('history', () => {
  it('undo/redo with coalescing', () => {
    let h = createHistory(1)
    h = pushHistory(h, 2, 'type:a', 1000)
    h = pushHistory(h, 3, 'type:a', 1500) // coalesced
    h = pushHistory(h, 4, 'other', 1600)
    expect(h.past).toEqual([1, 3])
    h = undo(h)
    expect(h.present).toBe(3)
    h = undo(h)
    expect(h.present).toBe(1)
    h = redo(h)
    expect(h.present).toBe(3)
    h = pushHistory(h, 9, null)
    expect(h.future).toEqual([])
  })
})

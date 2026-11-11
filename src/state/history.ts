/**
 * Undo/redo history of immutable snapshots.
 * Consecutive changes with the same `coalesceKey` (e.g. typing in one field, or all
 * batches of one translation job) are merged into a single undo step.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
  lastKey: string | null
  lastAt: number
}

const LIMIT = 200
const COALESCE_MS = 1500

export const createHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], lastKey: null, lastAt: 0 })

export function pushHistory<T>(h: History<T>, next: T, coalesceKey: string | null = null, now = Date.now()): History<T> {
  if (next === h.present) return h
  const coalesce = coalesceKey !== null && coalesceKey === h.lastKey && (coalesceKey.startsWith('job:') || now - h.lastAt < COALESCE_MS)
  if (coalesce) return { ...h, present: next, future: [], lastAt: now }
  const past = [...h.past, h.present]
  if (past.length > LIMIT) past.shift()
  return { past, present: next, future: [], lastKey: coalesceKey, lastAt: now }
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  const previous = h.past[h.past.length - 1]
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future], lastKey: null, lastAt: 0 }
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  const [next, ...rest] = h.future
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null, lastAt: 0 }
}

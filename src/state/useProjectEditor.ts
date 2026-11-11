import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useServices } from '../app/services'
import { nowIso, type Project, type ProjectDoc, type Segment } from '../domain/types'
import { reportError } from '../services/errors'
import { createHistory, pushHistory, redo, undo, type History } from './history'

interface State {
  project: Project
  history: History<Segment[]>
  /** Increments on every change; used to trigger autosave. */
  revision: number
}

type Action =
  | { type: 'map'; fn: (segments: Segment[]) => Segment[]; key: string | null }
  | { type: 'project'; patch: Partial<Project> }
  | { type: 'undo' }
  | { type: 'redo' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'map': {
      const next = action.fn(state.history.present)
      if (next === state.history.present) return state
      return { ...state, history: pushHistory(state.history, next, action.key), revision: state.revision + 1 }
    }
    case 'project':
      return { ...state, project: { ...state.project, ...action.patch }, revision: state.revision + 1 }
    case 'undo':
      return state.history.past.length ? { ...state, history: undo(state.history), revision: state.revision + 1 } : state
    case 'redo':
      return state.history.future.length ? { ...state, history: redo(state.history), revision: state.revision + 1 } : state
  }
}

const AUTOSAVE_MS = 350

/**
 * Editing state of one project: undo/redo history of segments and debounced autosave
 * to SQLite. Pending changes are written synchronously on unmount, and the database
 * file is flushed, so leaving the Studio never loses edits.
 */
export function useProjectEditor(initial: ProjectDoc) {
  const { projects, db } = useServices()
  const [state, dispatch] = useReducer(reducer, initial, (doc) => ({ project: doc.project, history: createHistory(doc.segments), revision: 0 }))
  const latest = useRef(state)
  latest.current = state
  const savedRevision = useRef(0)

  const persist = useCallback(() => {
    const s = latest.current
    if (s.revision === savedRevision.current) return
    try {
      projects.save({ project: { ...s.project, updatedAt: nowIso() }, segments: s.history.present })
      savedRevision.current = s.revision
    } catch (error) {
      reportError('Autosave failed', error)
    }
  }, [projects])

  useEffect(() => {
    if (state.revision === savedRevision.current) return
    const t = setTimeout(persist, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [state.revision, persist])

  useEffect(() => {
    const onHide = () => persist()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      persist()
      void db.flush().catch((e) => reportError('Saving failed', e))
    }
  }, [persist, db])

  const saveNow = useCallback(async () => {
    persist()
    await db.flush()
  }, [persist, db])

  return {
    project: state.project,
    segments: state.history.present,
    canUndo: state.history.past.length > 0,
    canRedo: state.history.future.length > 0,
    /** Apply a pure transformation to the latest segments (safe for async callbacks). */
    mapSegments: useCallback((fn: (s: Segment[]) => Segment[], key: string | null = null) => dispatch({ type: 'map', fn, key }), []),
    updateProject: useCallback((patch: Partial<Project>) => dispatch({ type: 'project', patch }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    saveNow,
  }
}

export type ProjectEditor = ReturnType<typeof useProjectEditor>

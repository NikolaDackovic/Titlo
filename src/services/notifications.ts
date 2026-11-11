export type NoticeKind = 'info' | 'success' | 'warning' | 'error'

export interface Notice {
  id: number
  kind: NoticeKind
  title: string
  message?: string
  details?: string[]
  /** ms; 0 = stays until dismissed. */
  timeout: number
}

type Listener = (notices: Notice[]) => void

let notices: Notice[] = []
let nextId = 1
const listeners = new Set<Listener>()

const emit = () => listeners.forEach((l) => l(notices))

export function notify(kind: NoticeKind, title: string, message?: string, details?: string[]) {
  // Errors stay longer, but never cover the UI permanently.
  const timeout = kind === 'error' ? 15000 : kind === 'warning' ? 9000 : 4500
  const notice: Notice = { id: nextId++, kind, title, message, details, timeout }
  notices = [...notices.slice(-4), notice]
  emit()
  if (timeout) setTimeout(() => dismiss(notice.id), timeout)
  return notice.id
}

export function dismiss(id: number) {
  notices = notices.filter((n) => n.id !== id)
  emit()
}

export function subscribeNotices(listener: Listener) {
  listeners.add(listener)
  listener(notices)
  return () => {
    listeners.delete(listener)
  }
}

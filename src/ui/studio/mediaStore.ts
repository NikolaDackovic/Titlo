import type { AudioActivity } from '../../media/audioActivity'

/**
 * In-session media for preview and transcription. A browser cannot keep access to a local
 * file across reloads, so the File / object URL live only for this session; the project
 * stores the file's name/size/duration and asks the user to re-select it after a restart.
 * The desktop build will store the native path instead.
 */
export interface SessionMedia {
  url: string
  name: string
  type: string
  isVideo: boolean
  file: File
  /** Waveform (0–1), filled after decoding (transcription or on attach). */
  peaks?: Float32Array
  durationMs?: number
  /** Level/ZCR per 20 ms frame (for QC), filled together with the waveform. */
  activity?: AudioActivity
}

const media = new Map<string, SessionMedia>()
/** Projects created from a video/audio file: the Studio starts transcription on open. */
const pendingTranscription = new Set<string>()

export const getSessionMedia = (projectId: string) => media.get(projectId) ?? null

export function setSessionMedia(projectId: string, file: File): SessionMedia {
  const previous = media.get(projectId)
  if (previous) URL.revokeObjectURL(previous.url)
  const entry: SessionMedia = {
    url: URL.createObjectURL(file),
    name: file.name,
    type: file.type,
    isVideo: file.type.startsWith('video/') || /\.(mp4|mkv|mov|webm)$/i.test(file.name),
    file,
  }
  media.set(projectId, entry)
  return entry
}

export function setSessionPeaks(projectId: string, peaks: Float32Array, durationMs: number, activity?: AudioActivity): SessionMedia | null {
  const entry = media.get(projectId)
  if (!entry) return null
  const next = { ...entry, peaks, durationMs, activity: activity ?? entry.activity }
  media.set(projectId, next)
  return next
}

export function clearSessionMedia(projectId: string) {
  const previous = media.get(projectId)
  if (previous) URL.revokeObjectURL(previous.url)
  media.delete(projectId)
}

export const requestAutoTranscription = (projectId: string) => pendingTranscription.add(projectId)
export function takeAutoTranscription(projectId: string): boolean {
  const pending = pendingTranscription.has(projectId)
  pendingTranscription.delete(projectId)
  return pending
}

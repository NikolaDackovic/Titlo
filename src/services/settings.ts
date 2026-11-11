import type { ProfileId } from '../domain/languages'
import type { Locale } from '../i18n'
import type { ExportContent, ExportFormat } from '../formats/exporter'
import type { LineEnding } from '../formats/types'
import { DEFAULT_TRANSLATION_SETTINGS, type TranslationSettings } from '../translation/registry'

export type Theme = 'dark' | 'light'

export interface AppSettings {
  uiLanguage: Locale
  theme: Theme
  defaultProfile: ProfileId
  defaultExportFormat: ExportFormat
  defaultExportContent: ExportContent
  exportLineEnding: LineEnding
  exportBom: boolean
  qcProfileId: string
  translation: TranslationSettings
  transcription: { modelId: string }
}

export const DEFAULT_SETTINGS: AppSettings = {
  uiLanguage: 'sr',
  theme: 'dark',
  defaultProfile: 'exyu-neutral',
  defaultExportFormat: 'srt',
  defaultExportContent: 'translation',
  exportLineEnding: 'crlf',
  exportBom: false,
  qcProfileId: 'standard',
  translation: DEFAULT_TRANSLATION_SETTINGS,
  transcription: { modelId: 'onnx-community/whisper-small' },
}

/** Merge stored settings over defaults so new settings get sane values after updates. */
export function mergeSettings(stored: Partial<AppSettings> | null | undefined): AppSettings {
  const s = stored ?? {}
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    translation: {
      ...DEFAULT_TRANSLATION_SETTINGS,
      ...(s.translation ?? {}),
      opus: { ...DEFAULT_TRANSLATION_SETTINGS.opus, ...(s.translation?.opus ?? {}) },
      llm: { ...DEFAULT_TRANSLATION_SETTINGS.llm, ...(s.translation?.llm ?? {}) },
      // The TEST provider is no longer selectable in the app (it only marks text); old choices move to the real model.
      ...((s.translation?.providerId as string | undefined) === 'test' ? { providerId: DEFAULT_TRANSLATION_SETTINGS.providerId } : {}),
    },
    transcription: { ...DEFAULT_SETTINGS.transcription, ...(s.transcription ?? {}) },
  }
}

export const KEYBOARD_SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl+S', action: 'Save now' },
  { keys: 'Ctrl+Z / Ctrl+Y', action: 'Undo / Redo' },
  { keys: 'Ctrl+Shift+Z', action: 'Redo' },
  { keys: 'Ctrl+F', action: 'Find & replace' },
  { keys: 'Alt+↓ / Alt+↑', action: 'Next / previous segment' },
  { keys: 'Ctrl+Enter', action: 'Approve segment and go to next' },
  { keys: 'Ctrl+L', action: 'Lock / unlock segment' },
  { keys: 'Ctrl+Shift+S', action: 'Split segment at cursor' },
  { keys: 'Ctrl+M', action: 'Merge with next segment' },
  { keys: 'Ctrl+Space', action: 'Play / pause video' },
  { keys: 'Ctrl+E', action: 'Export' },
]

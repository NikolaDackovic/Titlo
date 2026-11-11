/**
 * Media & transcription architecture.
 *
 * Browser build: audio is decoded by the browser (Web Audio) and transcribed by Whisper
 * running locally in a Web Worker (Transformers.js / ONNX Runtime WASM).
 * Desktop build (planned): FFmpeg + whisper.cpp sidecars for long films and any codec.
 * The UI only talks to these interfaces.
 */
import type { ProviderAvailability } from '../translation/types'
import type { SourceLanguage } from '../domain/languages'
import type { AudioActivity } from './audioActivity'
import type { LanguageDetection } from './languageDetection'
import type { TranscribedSegment, TranscriptionLanguage } from './transcription'

export const MEDIA_EXTENSIONS = ['.mp4', '.mkv', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac']

export interface MediaInfo {
  durationMs: number | null
  hasVideo: boolean
  width?: number
  height?: number
}

export interface MediaProcessor {
  probe(file: File): Promise<MediaInfo>
}

export const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-small', label: 'Whisper small', sizeMb: 250, note: 'Better accuracy for Serbian, Croatian and Bosnian. Slower.' },
  { id: 'onnx-community/whisper-base', label: 'Whisper base', sizeMb: 77, note: 'Fast, less accurate. Good for clear English speech.' },
] as const

export type WhisperModelId = (typeof WHISPER_MODELS)[number]['id']

export interface TranscriptionOptions {
  modelId: string
  language: TranscriptionLanguage
  /**
   * With "auto": the variant to use when Serbian/Croatian/Bosnian is detected (usually the
   * project's language). Whisper cannot tell the variants apart reliably (it often says "croatian"
   * for Serbian speech), so the user's choice wins. Measured effect on the text is small.
   */
  shVariant?: SourceLanguage
}

export type TranscriptionStage = 'decoding' | 'loading' | 'detecting' | 'transcribing'

export interface TranscriptionProgress {
  stage: TranscriptionStage
  /** Blocks finished / total (only while transcribing). */
  done: number
  total: number
  /** Milliseconds of audio transcribed so far. */
  audioDoneMs: number
  audioTotalMs: number
}

export interface TranscriptionResult {
  segments: TranscribedSegment[]
  durationMs: number
  /** Downsampled waveform (0–1) for the timeline. */
  peaks: Float32Array
  /** Per-frame level and zero-crossing rate, for quality-control warnings. */
  activity: AudioActivity
  elapsedMs: number
  modelId: string
  /** Language Whisper was told to transcribe (chosen by the user, or detected). */
  language: SourceLanguage
  /** Present when the language was detected automatically. */
  detection: LanguageDetection | null
}

export interface TranscriptionEngine {
  checkModel(modelId: string): Promise<ProviderAvailability>
  /** Load the model ahead of time (no transcription). */
  warmUp(modelId: string): Promise<void>
  /** Decode and detect the spoken language only (no transcription). */
  detectLanguage(file: File, modelId: string, signal: AbortSignal): Promise<LanguageDetection>
  transcribe(file: File, options: TranscriptionOptions, signal: AbortSignal, onProgress: (p: TranscriptionProgress) => void): Promise<TranscriptionResult>
}

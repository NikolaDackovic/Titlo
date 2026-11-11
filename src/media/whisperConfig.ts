/**
 * Whisper settings used by the app (worker) and recorded by the speech benchmark.
 * Kept dependency-free so the worker bundle stays small.
 * Decoding is greedy: Transformers.js 4.3 ignores num_beams for generation.
 */
export const WHISPER_RUNTIME = { dtype: 'q8', device: 'wasm' } as const
export const WHISPER_DECODE_OPTIONS = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' } as const
/** Blocks handed to the worker one at a time (see planBlocks). */
export const BLOCK_TARGET_SEC = 90

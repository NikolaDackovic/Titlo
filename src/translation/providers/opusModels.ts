/** Model ids shared by the provider and the worker (kept dependency-free for the worker bundle). */
export const OPUS_SH_EN_MODEL_ID = 'Helsinki-NLP/opus-mt-tc-big-sh-en'

/**
 * Models installed with a decoder that has no past-key-value inputs (the int8 export of
 * opus-mt-tc-big-sh-en has no merged decoder). They must generate with `use_cache: false`,
 * otherwise only the last token reaches the decoder and the output collapses ("Hi I").
 */
export const noKvCache = (modelId: string) => modelId === OPUS_SH_EN_MODEL_ID

interface GenerationModel {
  _update_model_kwargs_for_generation(args: { model_inputs: Record<string, unknown>; [k: string]: unknown }): Record<string, unknown>
}

/**
 * Transformers.js always feeds only the newest token to the decoder during generation
 * (it assumes a KV cache). For a decoder without past inputs, feed the whole decoder
 * sequence instead and drop the cache so nothing is sliced away.
 * `cat` is passed in to keep this module free of the Transformers.js import.
 */
export function patchNoKvCache(model: unknown, cat: (tensors: unknown[], dim: number) => unknown) {
  const m = model as GenerationModel & { __noKvCache?: boolean }
  if (m.__noKvCache) return
  const original = m._update_model_kwargs_for_generation.bind(m)
  m._update_model_kwargs_for_generation = (args) => {
    const previous = args.model_inputs.input_ids
    const next = original(args)
    next.input_ids = cat([previous, next.input_ids], 1)
    next.past_key_values = null
    return next
  }
  m.__noKvCache = true
}

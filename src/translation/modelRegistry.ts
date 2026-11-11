/**
 * Research results for candidate local models (checked on the model cards, Nov 2026).
 * "Languages" lists only what the model card explicitly states.
 */
export type ModelVerdict = 'selected' | 'fallback' | 'optional' | 'rejected' | 'unverified'

export interface ModelCandidate {
  id: string
  name: string
  task: 'translation' | 'speech-to-text'
  languages: string
  license: string
  commercial: string
  size: string
  ram: string
  hardware: string
  verdict: ModelVerdict
  notes: string
  source: string
}

export const MODEL_CANDIDATES: ModelCandidate[] = [
  {
    id: 'opus-mt-tc-base-en-sh',
    name: 'Helsinki-NLP/opus-mt-tc-base-en-sh',
    task: 'translation',
    languages: 'EN → bos_Latn, hrv, srp_Latn, srp_Cyrl, hbs (target token required)',
    license: 'CC-BY-4.0',
    commercial: 'Allowed; attribution to Helsinki-NLP / OPUS-MT required. Redistribution allowed with attribution.',
    size: '74M params · installed int8 ONNX package 398 MB on disk (encoder 49 MB int8 + merged decoder 343 MB)',
    ram: 'Measured peak 0.47–0.72 GB (Node process); browser load 44–60 s on a 2-core / 3.4 GB laptop',
    hardware: 'CPU (onnxruntime-node / WASM). GPU not used.',
    verdict: 'selected',
    notes: 'EXPERIMENTAL. Runs locally (verified: 400/400 benchmark lines, real browser job). Language token works only with the fixed tokenizer.json. Weak on slang/idioms (chrF ≈38–41), srp_Latn output needs mojibake repair, >>hbs<< unusable, bos_Latn mixes ekavian. Human quality evaluation not done — see docs/TRANSLATION_QUALITY_REPORT.md.',
    source: 'https://huggingface.co/Helsinki-NLP/opus-mt-tc-base-en-sh',
  },
  {
    id: 'opus-mt-en-zls',
    name: 'Helsinki-NLP/opus-mt-en-zls',
    task: 'translation',
    languages: 'EN → bos_Latn, hrv, srp_Latn, srp_Cyrl, bul, mkd, slv',
    license: 'Apache-2.0',
    commercial: 'Allowed (Apache-2.0).',
    size: 'Not stated on card (Marian transformer, similar class)',
    ram: '< 1 GB',
    hardware: 'CPU',
    verdict: 'fallback',
    notes: 'Older multi-target model; only a combined Tatoeba eng-hbs score is published (chrF 0.619). Usable with the same provider by changing the model id.',
    source: 'https://huggingface.co/Helsinki-NLP/opus-mt-en-zls',
  },
  {
    id: 'eurollm-9b',
    name: 'utter-project/EuroLLM-9B-Instruct',
    task: 'translation',
    languages: '35 languages incl. Croatian; Serbian and Bosnian NOT listed',
    license: 'Apache-2.0 (gated download)',
    commercial: 'Allowed by licence.',
    size: '9.2B params (≈5.5 GB at Q4 GGUF)',
    ram: '8–16 GB',
    hardware: 'CPU slow; GPU recommended',
    verdict: 'optional',
    notes: 'Can be used through the Local LLM provider (llama.cpp/Ollama). Good candidate for Croatian; Serbian/Bosnian quality unknown — benchmark first.',
    source: 'https://huggingface.co/utter-project/EuroLLM-9B-Instruct',
  },
  {
    id: 'qwen3-8b',
    name: 'Qwen/Qwen3-8B',
    task: 'translation',
    languages: '"100+ languages" — no list; sr/hr/bs not mentioned',
    license: 'Apache-2.0',
    commercial: 'Allowed by licence.',
    size: '8.2B params (≈5 GB at Q4 GGUF)',
    ram: '8–16 GB',
    hardware: 'CPU slow; GPU recommended',
    verdict: 'optional',
    notes: 'Usable via the Local LLM provider for context-aware translation; language support for the ExYu variants is not documented.',
    source: 'https://huggingface.co/Qwen/Qwen3-8B',
  },
  {
    id: 'madlad400-3b',
    name: 'google/madlad400-3b-mt',
    task: 'translation',
    languages: '"400+ languages" — the card does not list sr/hr/bs codes',
    license: 'Apache-2.0',
    commercial: 'Allowed by licence.',
    size: '3B params (1.65 GB q4k GGUF published)',
    ram: '4–8 GB',
    hardware: 'CPU possible',
    verdict: 'unverified',
    notes: 'Promising and permissive, but per-language support was not confirmed from the card; needs verification against the paper and our benchmark.',
    source: 'https://huggingface.co/google/madlad400-3b-mt',
  },
  {
    id: 'gemma-3',
    name: 'google/gemma-3-12b-it',
    task: 'translation',
    languages: '"140+ languages" — sr/hr/bs not listed',
    license: 'Gemma Terms of Use (custom)',
    commercial: 'Custom terms with use restrictions — legal review required.',
    size: '12B params',
    ram: '16 GB+',
    hardware: 'GPU recommended',
    verdict: 'rejected',
    notes: 'Not chosen: custom licence and unverified language support.',
    source: 'https://huggingface.co/google/gemma-3-12b-it',
  },
  {
    id: 'bergamot',
    name: 'Mozilla Firefox Translations (Bergamot)',
    task: 'translation',
    languages: 'No en-hr / en-sr / en-bs models found in the repository listing',
    license: 'MPL-2.0',
    commercial: 'Allowed (MPL-2.0).',
    size: '≈15–40 MB per pair',
    ram: '< 1 GB',
    hardware: 'CPU',
    verdict: 'rejected',
    notes: 'Repository archived (Dec 2025); no ExYu language pairs confirmed.',
    source: 'https://github.com/mozilla/firefox-translations-models',
  },
  {
    id: 'nllb-200',
    name: 'facebook/nllb-200',
    task: 'translation',
    languages: 'Includes bos_Latn, hrv_Latn, srp_Cyrl',
    license: 'CC-BY-NC-4.0',
    commercial: 'NOT allowed (non-commercial licence).',
    size: '600M–3.3B params',
    ram: '2–16 GB',
    hardware: 'CPU/GPU',
    verdict: 'rejected',
    notes: 'Excluded because the licence forbids commercial use.',
    source: 'https://huggingface.co/facebook/nllb-200-distilled-600M',
  },
  {
    id: 'whisper-cpp',
    name: 'whisper.cpp + OpenAI Whisper ggml models',
    task: 'speech-to-text',
    languages: 'Multilingual incl. Serbian, Croatian, Bosnian (Whisper language list)',
    license: 'MIT (code and model weights)',
    commercial: 'Allowed (MIT).',
    size: 'tiny 75 MB · base 142 MB · small 466 MB · medium 1.5 GB · large-v3 2.9 GB',
    ram: '≈0.4 GB (base) to ≈4 GB (large)',
    hardware: 'CPU; optional CUDA/Vulkan/Metal builds',
    verdict: 'selected',
    notes: 'Planned for Phase G (desktop build). Requires native binaries; not runnable in the browser version.',
    source: 'https://github.com/ggml-org/whisper.cpp',
  },
]

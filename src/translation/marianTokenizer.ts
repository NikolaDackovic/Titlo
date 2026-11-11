/**
 * Builds a Transformers.js-compatible `tokenizer.json` for Marian (OPUS-MT) models
 * without Python.
 *
 * This is a faithful port of the official Transformers.js conversion helper
 * (scripts/extra/marian.py, tag 3.7.6): vocabulary order comes from `vocab.json`,
 * piece scores are the maximum of the source and target SentencePiece scores
 * (-100 when a piece is missing), special tokens get score 0.
 *
 * Deliberate differences (documented in docs/MODELS.md):
 *  - `unk_id` is the real id of `<unk>` from vocab.json. The Python helper hard-codes 2,
 *    which is wrong for "tc" models (here `<unk>` = 47908).
 *  - The vocabulary list is ordered by token id (the Unigram model uses list position
 *    as id); the Python helper relies on file order, which is the same for valid files.
 */

export interface SentencePiecePiece {
  piece: string
  score: number
  type: number
}

/** Minimal protobuf reader for SentencePiece `ModelProto` (only field 1: pieces). */
export function parseSentencePieceModel(bytes: Uint8Array): SentencePiecePiece[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pos = 0

  const varint = (limit: number): number => {
    let result = 0
    let shift = 0
    for (;;) {
      if (pos >= limit) throw new Error('Truncated varint in SentencePiece model')
      const b = bytes[pos++]
      result += (b & 0x7f) * 2 ** shift
      if ((b & 0x80) === 0) return result
      shift += 7
      if (shift > 63) throw new Error('Invalid varint in SentencePiece model')
    }
  }
  const skip = (wire: number, limit: number) => {
    if (wire === 0) varint(limit)
    else if (wire === 1) pos += 8
    else if (wire === 2) {
      // Read the length first: `pos += varint()` would use the pre-call value of pos.
      const length = varint(limit)
      pos += length
    }
    else if (wire === 5) pos += 4
    else throw new Error(`Unsupported protobuf wire type ${wire}`)
  }

  const pieces: SentencePiecePiece[] = []
  while (pos < bytes.length) {
    const key = varint(bytes.length)
    const field = Math.floor(key / 8)
    const wire = key & 7
    if (field === 1 && wire === 2) {
      const len = varint(bytes.length)
      const end = pos + len
      const p: SentencePiecePiece = { piece: '', score: 0, type: 1 }
      while (pos < end) {
        const k = varint(end)
        const f = Math.floor(k / 8)
        const w = k & 7
        if (f === 1 && w === 2) {
          const l = varint(end)
          p.piece = decoder.decode(bytes.subarray(pos, pos + l))
          pos += l
        } else if (f === 2 && w === 5) {
          p.score = view.getFloat32(pos, true)
          pos += 4
        } else if (f === 3 && w === 0) {
          p.type = varint(end)
        } else skip(w, end)
      }
      pos = end
      pieces.push(p)
    } else skip(wire, bytes.length)
  }
  if (!pieces.length) throw new Error('No pieces found — not a SentencePiece model file')
  return pieces
}

export interface MarianTokenizerInputs {
  vocab: Record<string, number>
  sourceSpm: Uint8Array
  targetSpm: Uint8Array
  eosToken?: string
  unkToken?: string
  padToken?: string
}

export function buildMarianTokenizerJson(input: MarianTokenizerInputs) {
  const eos = input.eosToken ?? '</s>'
  const unk = input.unkToken ?? '<unk>'
  const pad = input.padToken ?? '<pad>'
  const specials = [eos, unk, pad]
  for (const s of specials) if (input.vocab[s] === undefined) throw new Error(`Special token ${s} missing from vocab.json`)

  const scoreMap = (pieces: SentencePiecePiece[]) => new Map(pieces.map((p) => [p.piece, p.score]))
  const src = scoreMap(parseSentencePieceModel(input.sourceSpm))
  const tgt = scoreMap(parseSentencePieceModel(input.targetSpm))

  const entries = Object.entries(input.vocab).sort((a, b) => a[1] - b[1])
  entries.forEach(([token, id], index) => {
    if (id !== index) throw new Error(`vocab.json ids are not contiguous (token ${token} has id ${id}, expected ${index})`)
  })

  // Target-language labels (">>hrv<<", ">>srp_Latn<<", …) must be atomic tokens. The Python
  // MarianTokenizer strips them before SentencePiece; Transformers.js v4 no longer routes
  // encoding through that override, so without this the label is split into ">", ">",
  // "hr", "v", … and the model never receives the target-variant signal (verified).
  const languageTokens = entries.map(([token]) => token).filter((t) => /^>>\w+<<$/.test(t))
  const added = [...specials, ...languageTokens]
  const addedSet = new Set(added)

  const vocabList: Array<[string, number]> = entries.map(([token]) => [
    token,
    addedSet.has(token) ? 0 : Math.max(src.get(token) ?? -100, tgt.get(token) ?? -100),
  ])

  return {
    version: '1.0',
    truncation: null,
    padding: null,
    added_tokens: added.map((content) => ({
      id: input.vocab[content],
      special: true,
      content,
      single_word: false,
      lstrip: false,
      rstrip: false,
      normalized: false,
    })),
    normalizer: { type: 'Precompiled', precompiled_charsmap: null },
    pre_tokenizer: {
      type: 'Sequence',
      pretokenizers: [{ type: 'WhitespaceSplit' }, { type: 'Metaspace', replacement: '▁', add_prefix_space: true }],
    },
    post_processor: {
      type: 'TemplateProcessing',
      single: [{ Sequence: { id: 'A', type_id: 0 } }, { SpecialToken: { id: eos, type_id: 0 } }],
      pair: [
        { Sequence: { id: 'A', type_id: 0 } },
        { SpecialToken: { id: eos, type_id: 0 } },
        { Sequence: { id: 'B', type_id: 0 } },
        { SpecialToken: { id: eos, type_id: 0 } },
      ],
      special_tokens: { [eos]: { id: eos, ids: [input.vocab[eos]], tokens: [eos] } },
    },
    decoder: { type: 'Metaspace', replacement: '▁', add_prefix_space: true },
    model: { type: 'Unigram', unk_id: input.vocab[unk], vocab: vocabList },
  }
}

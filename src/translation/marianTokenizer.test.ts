import { describe, expect, it } from 'vitest'
import { buildMarianTokenizerJson, parseSentencePieceModel } from './marianTokenizer'

/** Encode a tiny SentencePiece ModelProto (field 1 = pieces) for tests. */
function encodeSpm(pieces: Array<[string, number]>, withTrailer = true): Uint8Array {
  const bytes: number[] = []
  const varint = (n: number) => {
    while (n > 0x7f) {
      bytes.push((n & 0x7f) | 0x80)
      n >>>= 7
    }
    bytes.push(n)
  }
  for (const [piece, score] of pieces) {
    const p = new TextEncoder().encode(piece)
    const f = new Uint8Array(new Float32Array([score]).buffer)
    const inner = [0x0a, p.length, ...p, 0x15, ...f, 0x18, 1]
    bytes.push(0x0a)
    varint(inner.length)
    bytes.push(...inner)
  }
  if (withTrailer) {
    // field 2 (trainer_spec) length-delimited with a 200-byte body → 2-byte varint length
    bytes.push(0x12)
    varint(200)
    bytes.push(...new Array(200).fill(0))
  }
  return new Uint8Array(bytes)
}

describe('SentencePiece parser', () => {
  it('reads pieces and scores, skipping other fields (incl. multi-byte lengths)', () => {
    const pieces = parseSentencePieceModel(encodeSpm([['▁kuća', -9.5], ['▁the', -3.25]]))
    expect(pieces.map((p) => p.piece)).toEqual(['▁kuća', '▁the'])
    expect(pieces[1].score).toBeCloseTo(-3.25)
  })
  it('rejects non-SentencePiece data', () => {
    expect(() => parseSentencePieceModel(new Uint8Array([0x12, 0x00]))).toThrow()
  })
})

describe('Marian tokenizer.json builder', () => {
  const vocab = { '</s>': 0, '<unk>': 1, '▁kuća': 2, '>>hrv<<': 3, '▁the': 4, '<pad>': 5 }
  const src = encodeSpm([['▁the', -3]])
  const tgt = encodeSpm([['▁kuća', -9], ['▁the', -5]])

  it('uses the real <unk> id, max scores, and makes language labels atomic tokens', () => {
    const t = buildMarianTokenizerJson({ vocab, sourceSpm: src, targetSpm: tgt })
    expect(t.model.unk_id).toBe(1)
    expect(t.model.vocab).toEqual([['</s>', 0], ['<unk>', 0], ['▁kuća', -9], ['>>hrv<<', 0], ['▁the', -3], ['<pad>', 0]])
    expect(t.added_tokens.map((a) => a.content)).toEqual(['</s>', '<unk>', '<pad>', '>>hrv<<'])
    expect(t.added_tokens.find((a) => a.content === '>>hrv<<')?.id).toBe(3)
    expect(t.post_processor.special_tokens['</s>'].ids).toEqual([0])
  })
  it('fails loudly on non-contiguous ids or missing special tokens', () => {
    expect(() => buildMarianTokenizerJson({ vocab: { '</s>': 0, '<unk>': 1, '<pad>': 5 }, sourceSpm: src, targetSpm: tgt })).toThrow(/contiguous/)
    expect(() => buildMarianTokenizerJson({ vocab: { a: 0 }, sourceSpm: src, targetSpm: tgt })).toThrow(/Special token/)
  })
})

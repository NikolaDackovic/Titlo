/**
 * Decoding of subtitle files.
 *
 * Many subtitles in the ExYu region are still distributed as Windows-1250 (Latin
 * with č/ć/š/ž/đ) or Windows-1251 (Cyrillic). Reading them as UTF-8 silently
 * destroys diacritics, so we detect the encoding and report what was used.
 */

export type DetectedEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1250' | 'windows-1251'

export interface DecodedText {
  text: string
  encoding: DetectedEncoding
  hadBom: boolean
  /** True when the encoding was guessed heuristically (legacy 8-bit). */
  guessed: boolean
}

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((b, i) => bytes[i] === b)

export function decodeSubtitleBytes(input: ArrayBuffer | Uint8Array): DecodedText {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)

  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8', hadBom: true, guessed: false }
  }
  if (startsWith(bytes, [0xff, 0xfe])) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le', hadBom: true, guessed: false }
  }
  if (startsWith(bytes, [0xfe, 0xff])) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be', hadBom: true, guessed: false }
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, encoding: 'utf-8', hadBom: false, guessed: false }
  } catch {
    // Not valid UTF-8: fall through to legacy 8-bit detection.
  }

  // Heuristic: in Windows-1251 the 0xC0–0xFF range is entirely Cyrillic letters,
  // in Windows-1250 it is accented Latin. Cyrillic text has a very high share of
  // such bytes; Latin text with diacritics has a low share.
  let letters = 0
  let high = 0
  for (const b of bytes) {
    if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)) letters += 1
    else if (b >= 0xc0) {
      letters += 1
      high += 1
    }
  }
  const encoding: DetectedEncoding = letters > 0 && high / letters > 0.4 ? 'windows-1251' : 'windows-1250'
  return { text: new TextDecoder(encoding).decode(bytes), encoding, hadBom: false, guessed: true }
}

/** Encode text for export. Output is always UTF-8 (optionally with BOM for legacy players). */
export function encodeUtf8(text: string, withBom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text)
  if (!withBom) return body
  const out = new Uint8Array(body.length + 3)
  out.set([0xef, 0xbb, 0xbf], 0)
  out.set(body, 3)
  return out
}

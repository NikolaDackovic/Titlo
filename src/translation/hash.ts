/** Deterministic 64-bit FNV-1a hash rendered as hex (cache keys, not security). */
export function fnv1a64(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0xcbf29ce4
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

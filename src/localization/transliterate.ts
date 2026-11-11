/**
 * Serbian Latin ⇄ Cyrillic transliteration (Vuk's alphabet, 30 letters each).
 *
 * - Digraphs lj, nj, dž map to Љ/Њ/Џ with correct casing (Lj, LJ, lj).
 * - Known words where the letters are NOT a digraph (nad|živeti, kon|junkcija, in|jekcija…)
 *   are handled by an exception list.
 * - Markup (HTML tags, ASS overrides), URLs, e-mails and words containing q/w/x/y
 *   (foreign words, brand names) are left in Latin. QC reports mixed-script words.
 */

const LAT_TO_CYR: Record<string, string> = {
  a: 'а', b: 'б', c: 'ц', č: 'ч', ć: 'ћ', d: 'д', đ: 'ђ', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и',
  j: 'ј', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', š: 'ш', t: 'т', u: 'у',
  v: 'в', z: 'з', ž: 'ж',
}
const DIGRAPH_TO_CYR: Record<string, string> = { lj: 'љ', nj: 'њ', dž: 'џ' }

const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z', и: 'i', ј: 'j', к: 'k',
  л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć', у: 'u',
  ф: 'f', х: 'h', ц: 'c', ч: 'č', џ: 'dž', ш: 'š',
}

/**
 * Word stems where a letter pair looks like a digraph but is pronounced separately.
 * `|` marks the boundary. Matching is by lowercase prefix of the word or of a known
 * prefix position inside it.
 */
const NON_DIGRAPH_STEMS = [
  'nad|živ', 'nad|žnj', 'pod|žanr', 'pod|žup', 'pod|žel', 'od|živ',
  'kon|jug', 'kon|junk', 'in|jekc', 'in|jekt', 'in|jun', 'van|jezi', 'tan|jug-', 'izvan|jezi',
]

const PROTECTED = /(<[^>]+>|\{\\[^}]*\}|https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+)/gu
const WORD = /\p{L}+/gu

const isUpper = (ch: string) => ch !== ch.toLowerCase() && ch === ch.toUpperCase()

function nonDigraphPositions(lowerWord: string): Set<number> {
  const positions = new Set<number>()
  for (const stem of NON_DIGRAPH_STEMS) {
    const boundary = stem.indexOf('|')
    const plain = stem.replace('|', '').replace(/-$/, '')
    let from = 0
    for (;;) {
      const idx = lowerWord.indexOf(plain, from)
      if (idx === -1) break
      // Only at word start or after a common prefix (e.g. "pre-nadživeti" is rare; keep start + "pre").
      if (idx === 0 || ['pre', 'ne', 'na', 'u'].some((p) => lowerWord.slice(0, idx) === p)) {
        positions.add(idx + boundary - 1) // index of the first letter of the pair
      }
      from = idx + 1
    }
  }
  return positions
}

function wordToCyrillic(word: string): string {
  const lower = word.toLowerCase()
  if (/[qwxy]/.test(lower)) return word // foreign word: keep Latin
  const skip = nonDigraphPositions(lower)
  const allCaps = word.length > 1 && word === word.toUpperCase()
  let out = ''
  for (let i = 0; i < word.length; i += 1) {
    const pair = lower.slice(i, i + 2)
    if (DIGRAPH_TO_CYR[pair] && !skip.has(i)) {
      const cyr = DIGRAPH_TO_CYR[pair]
      out += isUpper(word[i]) || allCaps ? cyr.toUpperCase() : cyr
      i += 1
      continue
    }
    const ch = word[i]
    const mapped = LAT_TO_CYR[ch.toLowerCase()]
    if (!mapped) out += ch
    else out += isUpper(ch) ? mapped.toUpperCase() : mapped
  }
  return out
}

function wordToLatin(word: string): string {
  const allCaps = word.length > 1 && word === word.toUpperCase()
  let out = ''
  for (let i = 0; i < word.length; i += 1) {
    const ch = word[i]
    const mapped = CYR_TO_LAT[ch.toLowerCase()]
    if (!mapped) {
      out += ch
      continue
    }
    if (!isUpper(ch)) {
      out += mapped
      continue
    }
    if (mapped.length === 1) {
      out += mapped.toUpperCase()
      continue
    }
    // Digraph: "LJ" in all-caps context or when the next letter is uppercase, else "Lj".
    const next = word[i + 1]
    const upperContext = allCaps || (next !== undefined && isUpper(next))
    out += upperContext ? mapped.toUpperCase() : mapped[0].toUpperCase() + mapped.slice(1)
  }
  return out
}

const transformOutsideProtected = (text: string, fn: (word: string) => string) =>
  text
    .split(PROTECTED)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(WORD, fn)))
    .join('')

/**
 * Cyrillic → Latin with an index map: `map[i]` is the Cyrillic index of Latin character i
 * (`map[latin.length] === text.length`). Lets callers find Latin-space matches and edit
 * the ORIGINAL Cyrillic text in place, without round-tripping the whole string.
 */
export function cyrillicToLatinWithMap(text: string): { latin: string; map: number[] } {
  const latin = cyrillicToLatin(text)
  // Character-level alignment: every Cyrillic letter becomes 1 or 2 Latin letters,
  // everything else is copied unchanged, so lengths can be walked in parallel.
  const map: number[] = []
  let li = 0
  for (let ci = 0; ci < text.length; ci += 1) {
    const mapped = CYR_TO_LAT[text[ci].toLowerCase()]
    const width = mapped ? mapped.length : 1
    for (let k = 0; k < width; k += 1) map[li + k] = ci
    li += width
  }
  map[li] = text.length
  if (li !== latin.length) throw new Error('Transliteration map out of sync')
  return { latin, map }
}

export const latinToCyrillic = (text: string) => transformOutsideProtected(text, wordToCyrillic)
export const cyrillicToLatin = (text: string) => transformOutsideProtected(text, wordToLatin)

const CYRILLIC_LETTER = /[Ѐ-ӿ]/
const LATIN_LETTER = /[A-Za-zČĆŠŽĐčćšžđ]/

/** Words that mix Latin and Cyrillic letters, e.g. a Latin "a" inside a Cyrillic word. */
export function findMixedScriptWords(text: string): string[] {
  const words = stripProtected(text).match(WORD) ?? []
  return words.filter((w) => CYRILLIC_LETTER.test(w) && LATIN_LETTER.test(w))
}

export const stripProtected = (text: string) => text.replace(PROTECTED, ' ')

export const scriptOf = (text: string): 'Latn' | 'Cyrl' | 'mixed' | 'none' => {
  const plain = stripProtected(text)
  const cyr = (plain.match(/[Ѐ-ӿ]/g) ?? []).length
  const lat = (plain.match(/[A-Za-zČĆŠŽĐčćšžđ]/g) ?? []).length
  if (!cyr && !lat) return 'none'
  if (cyr && lat) return cyr > lat * 4 || lat > cyr * 4 ? (cyr > lat ? 'Cyrl' : 'Latn') : 'mixed'
  return cyr ? 'Cyrl' : 'Latn'
}

import type { Yat } from '../domain/languages'
import { stripProtected } from './transliterate'

/**
 * Ekavian / ijekavian detection.
 *
 * Converting between the two reflexes is NOT rule-safe (e.g. "pjesma" vs "pesma" is
 * regular, but "htio/hteo", "uspio/uspeo", "bijel/beo" are not), so the app never
 * rewrites yat automatically. It only detects which reflex a text uses so that QC
 * can flag mixed or wrong usage for the selected profile.
 *
 * Pairs: [ekavian, ijekavian]. Only unambiguous, frequent words are listed.
 */
export const YAT_PAIRS: Array<[string, string]> = [
  ['mleko', 'mlijeko'], ['mleka', 'mlijeka'], ['dete', 'dijete'], ['deteta', 'djeteta'], ['detetu', 'djetetu'],
  ['deca', 'djeca'], ['dece', 'djece'], ['deci', 'djeci'], ['vreme', 'vrijeme'], 
  ['reč', 'riječ'], ['reči', 'riječi'], ['lep', 'lijep'], ['lepa', 'lijepa'], ['lepo', 'lijepo'], ['lepi', 'lijepi'],
  ['lepu', 'lijepu'], ['mesto', 'mjesto'], ['mesta', 'mjesta'], ['mestu', 'mjestu'], ['uvek', 'uvijek'],
  ['gde', 'gdje'], ['negde', 'negdje'], ['nigde', 'nigdje'], ['svugde', 'svugdje'], ['hteo', 'htio'],
  ['htela', 'htjela'], ['želeo', 'želio'], ['želela', 'željela'], ['voleo', 'volio'], ['volela', 'voljela'],
  ['razumeo', 'razumio'], ['razumela', 'razumjela'], ['videla', 'vidjela'], ['videli', 'vidjeli'],
  ['devojka', 'djevojka'], ['devojku', 'djevojku'], ['devojke', 'djevojke'], ['cvet', 'cvijet'],
  ['belo', 'bijelo'], ['bela', 'bijela'], ['beli', 'bijeli'],
  ['reka', 'rijeka'], ['reke', 'rijeke'], ['pesma', 'pjesma'], ['pesmu', 'pjesmu'], ['leto', 'ljeto'],
  ['posle', 'poslije'], ['pre', 'prije'], ['ceo', 'cijeli'], ['cela', 'cijela'], ['celo', 'cijelo'],
  ['lek', 'lijek'], ['lekove', 'lijekove'], ['vetar', 'vjetar'], ['zvezda', 'zvijezda'], ['sneg', 'snijeg'],
  ['mesec', 'mjesec'], ['meseci', 'mjeseci'], ['čovek', 'čovjek'], ['čoveka', 'čovjeka'], ['čoveku', 'čovjeku'],
  ['telo', 'tijelo'], ['tela', 'tijela'], ['vest', 'vijest'], ['vesti', 'vijesti'], ['smeh', 'smijeh'],
  ['osećam', 'osjećam'], ['sećam', 'sjećam'], ['sećaš', 'sjećaš'], ['primetio', 'primijetio'], ['rešiti', 'riješiti'],
  ['rešenje', 'rješenje'], ['pevati', 'pjevati'], ['uspeh', 'uspjeh'], ['uspeo', 'uspio'], ['uspela', 'uspjela'],
  ['beži', 'bježi'], ['bežati', 'bježati'], ['sedi', 'sjedi'], ['sesti', 'sjesti'], ['nedelja', 'nedjelja'],
  ['nedelje', 'nedjelje'], ['podseti', 'podsjeti'], ['zameniti', 'zamijeniti'], ['promeniti', 'promijeniti'],
  ['promenio', 'promijenio'], ['verujem', 'vjerujem'], ['veruješ', 'vjeruješ'], ['verovati', 'vjerovati'],
  ['umesto', 'umjesto'], ['pesnik', 'pjesnik'], ['dvesta', 'dvjesta'], ['sedeo', 'sjedio'], ['hleb', 'hljeb'],
  ['lekar', 'ljekar'], ['ponedeljak', 'ponedjeljak'], ['predlog', 'prijedlog'], ['pobeda', 'pobjeda'],
  ['pobediti', 'pobijediti'],
]

const EKAVIAN = new Set(YAT_PAIRS.filter(([e, i]) => e !== i).map(([e]) => e))
const IJEKAVIAN = new Set(YAT_PAIRS.filter(([e, i]) => e !== i).map(([, i]) => i))

export interface YatEvidence {
  ekavian: string[]
  ijekavian: string[]
}

export function detectYat(text: string): YatEvidence {
  const words = stripProtected(text).toLowerCase().match(/\p{L}+/gu) ?? []
  const evidence: YatEvidence = { ekavian: [], ijekavian: [] }
  for (const w of words) {
    if (EKAVIAN.has(w)) evidence.ekavian.push(w)
    else if (IJEKAVIAN.has(w)) evidence.ijekavian.push(w)
  }
  return evidence
}

/** Returns words in `text` that use the wrong reflex for `expected`. */
export function wrongYatWords(text: string, expected: Yat): string[] {
  const e = detectYat(text)
  return expected === 'ekavian' ? e.ijekavian : e.ekavian
}

/** Counterpart suggestion for a known word, if listed. */
export function yatCounterpart(word: string, expected: Yat): string | null {
  const lower = word.toLowerCase()
  const pair = YAT_PAIRS.find(([e, i]) => (expected === 'ekavian' ? i === lower : e === lower))
  if (!pair) return null
  return expected === 'ekavian' ? pair[0] : pair[1]
}

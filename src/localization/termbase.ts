import type { Variant } from '../domain/languages'

/**
 * Regional termbase (seed data).
 *
 * Each concept lists the inflected forms used in the Serbian, Croatian and Bosnian
 * standards. Forms are *position-aligned* across variants (same index = same
 * grammatical case/number), so "vozu" maps to "vlaku", not to "vlak".
 * Only listed forms are matched — e.g. the verb "vozi" is not a form of "voz" and is
 * therefore never touched.
 *
 * `strength`:
 *   - 'strong'  — clearly a variant marker; a localization proposal is generated.
 *   - 'soft'    — both forms are used/understood in the target variant; only a
 *                 low-priority suggestion is generated.
 * `ambiguous` — the form has another meaning (e.g. "nedelja" = week AND Sunday);
 *               proposals are always marked for human review.
 * `applyTo`   — restrict proposals to these target variants (default: all).
 *
 * ExYu Neutral: the termbase does not hand-pick "neutral" words. A concept gets a
 * neutral proposal only when two of the three standards share the same forms (the
 * majority form). Where all three differ (hleb/kruh/hljeb), nothing is changed and
 * QC only checks the project for consistent use.
 *
 * This list is a starting point written for the MVP and must be reviewed by native
 * speakers of each variant before commercial use.
 */
export interface TermConcept {
  id: string
  gloss: string
  forms: Record<Variant, string[]>
  strength: 'strong' | 'soft'
  ambiguous?: string
  applyTo?: Variant[]
  note?: string
}

type Raw = [id: string, gloss: string, sr: string, hr: string, bs: string | '=sr' | '=hr', strength?: 'soft', extra?: Partial<TermConcept>]

const RAW: Raw[] = [
  ['train', 'train', 'voz voza vozu vozom vozovi vozova vozove vozovima', 'vlak vlaka vlaku vlakom vlakovi vlakova vlakove vlakovima', '=sr', undefined, { note: '"Vlak" is also heard in Bosnia; "voz" is the Bosnian standard form.' }],
  ['bread', 'bread', 'hleb hleba hlebu hlebom', 'kruh kruha kruhu kruhom', 'hljeb hljeba hljebu hljebom'],
  ['carrot', 'carrot', 'šargarepa šargarepe šargarepu šargarepom šargarepi', 'mrkva mrkve mrkvu mrkvom mrkvi', '=hr'],
  ['thousand', 'thousand', 'hiljada hiljade hiljadu hiljadama', 'tisuća tisuće tisuću tisućama', '=sr'],
  ['million', 'million', 'milion miliona milionu milionom milioni', 'milijun milijuna milijunu milijunom milijuni', '=sr'],
  ['history', 'history', 'istorija istorije istoriji istoriju istorijom', 'povijest povijesti povijesti povijest poviješću', 'historija historije historiji historiju historijom'],
  ['week', 'week', 'nedelja nedelje nedelju nedeljom nedelji', 'tjedan tjedna tjedan tjednom tjednu', 'sedmica sedmice sedmicu sedmicom sedmici', undefined, { ambiguous: '"Nedelja/nedjelja" also means Sunday — check the context.', applyTo: ['hr'] }],
  ['airplane', 'airplane', 'avion aviona avionu avionom avioni', 'zrakoplov zrakoplova zrakoplovu zrakoplovom zrakoplovi', '=sr', 'soft', { note: '"Avion" is common in colloquial Croatian; "zrakoplov" is formal.' }],
  ['point', 'point / dot', 'tačka tačke tački tačku tačkom', 'točka točke točki točku točkom', '=sr'],
  ['at-all', 'at all', 'uopšte', 'uopće', '=hr'],
  ['municipality', 'municipality', 'opština opštine opštini opštinu opštinom', 'općina općine općini općinu općinom', '=hr'],
  ['chemistry', 'chemistry', 'hemija hemije hemiji hemiju hemijom', 'kemija kemije kemiji kemiju kemijom', '=sr'],
  ['theatre', 'theatre', 'pozorište pozorišta pozorištu pozorištem', 'kazalište kazališta kazalištu kazalištem', '=sr', undefined, { note: '"Teatar" is understood everywhere.' }],
  ['cinema', 'cinema', 'bioskop bioskopa bioskopu bioskopom', 'kino kina kinu kinom', '=hr'],
  ['football', 'football (soccer)', 'fudbal fudbala fudbalu fudbalom', 'nogomet nogometa nogometu nogometom', '=sr'],
  ['beans', 'beans', 'pasulj pasulja pasulju pasuljem', 'grah graha grahu grahom', '=hr'],
  ['tomato', 'tomato', 'paradajz paradajza paradajzu paradajzom', 'rajčica rajčice rajčici rajčicom', '=sr'],
  ['spoon', 'spoon', 'kašika kašike kašiku kašikom kašiki', 'žlica žlice žlicu žlicom žlici', '=sr'],
  ['computer', 'computer', 'računar računara računaru računarom računari', 'računalo računala računalu računalom računala', '=sr', undefined, { note: '"Kompjuter" is understood in all variants.' }],
  ['embassy', 'embassy', 'ambasada ambasade ambasadi ambasadu ambasadom', 'veleposlanstvo veleposlanstva veleposlanstvu veleposlanstvo veleposlanstvom', '=sr', 'soft'],
  ['air', 'air', 'vazduh vazduha vazduhu vazduhom', 'zrak zraka zraku zrakom', '=hr'],
  ['family', 'family', 'porodica porodice porodici porodicu porodicom', 'obitelj obitelji obitelji obitelj obitelji', '=sr', undefined, { note: '"Familija" is colloquial everywhere.' }],
  ['university', 'university', 'univerzitet univerziteta univerzitetu univerzitetom', 'sveučilište sveučilišta sveučilištu sveučilištem', '=sr'],
  ['who', 'who', 'ko', 'tko', '=sr', undefined, { applyTo: ['hr'], ambiguous: 'Colloquial "ko" can also mean "kao" (like/as), e.g. "ko da".' }],
  ['somebody', 'somebody', 'neko', 'netko', '=sr', undefined, { applyTo: ['hr'], ambiguous: '"Neko" can also mean "some" (adjective) in Serbian/Bosnian.' }],
  ['nobody', 'nobody', 'niko', 'nitko', '=sr', undefined, { applyTo: ['hr'] }],
  ['what', 'what', 'šta', 'što', '=sr', undefined, { applyTo: ['hr'], note: 'Applied only toward Croatian: "što" is also standard Serbian (why/that).' }],
  ['coffee', 'coffee', 'kafa kafe kafi kafu kafom', 'kava kave kavi kavu kavom', '=sr', undefined, { note: 'Bosnian standard also allows "kahva".' }],
  ['pharmacy', 'pharmacy', 'apoteka apoteke apoteci apoteku apotekom', 'ljekarna ljekarne ljekarni ljekarnu ljekarnom', '=sr'],
  // Soft since Phase 3 benchmark: "otok" is also common in Bosnia; a high-confidence
  // otok→ostrvo proposal on real model output was a false positive.
  ['island', 'island', 'ostrvo ostrva ostrvu ostrvom', 'otok otoka otoku otokom', '=sr', 'soft', { note: '"Otok" is also widely used in Bosnia and Herzegovina.' }],
  ['office', 'office', 'kancelarija kancelarije kancelariji kancelariju kancelarijom', 'ured ureda uredu ured uredom', '=sr', 'soft'],
  ['music', 'music', 'muzika muzike muzici muziku muzikom', 'glazba glazbe glazbi glazbu glazbom', '=sr', undefined, { note: '"Muzika" is understood in Croatia.' }],
  ['factory', 'factory', 'fabrika fabrike fabrici fabriku fabrikom', 'tvornica tvornice tvornici tvornicu tvornicom', '=sr'],
  ['garbage', 'garbage', 'đubre đubreta đubretu đubretom', 'smeće smeća smeću smećem', '=hr'],
  ['plate', 'plate', 'tanjir tanjira tanjiru tanjirom', 'tanjur tanjura tanjuru tanjurom', '=sr'],
  ['trousers', 'trousers', 'pantalone pantalona pantalonama', 'hlače hlača hlačama', '=sr'],
  ['towel', 'towel', 'peškir peškira peškiru peškirom', 'ručnik ručnika ručniku ručnikom', '=sr'],
  ['traffic', 'traffic', 'saobraćaj saobraćaja saobraćaju saobraćajem', 'promet prometa prometu prometom', '=sr', 'soft', { ambiguous: '"Promet" also means turnover/sales.' }],
  ['doctor', 'doctor (physician)', 'lekar lekara lekaru lekarom lekari', 'liječnik liječnika liječniku liječnikom liječnici', 'ljekar ljekara ljekaru ljekarom ljekari', undefined, { note: '"Doktor" is understood everywhere and is often the most natural choice in dialogue.' }],
  ['neighbour', 'neighbour', 'komšija komšije komšiji komšiju', 'susjed susjeda susjedu susjeda', '=sr', 'soft', { note: '"Sused" (sr) / "susjed" (hr, bs) are also standard.' }],
  // Months: nominative, genitive, locative.
  ['m01', 'January', 'januar januara januaru', 'siječanj siječnja siječnju', '=sr'],
  ['m02', 'February', 'februar februara februaru', 'veljača veljače veljači', '=sr'],
  ['m03', 'March', 'mart marta martu', 'ožujak ožujka ožujku', '=sr'],
  ['m04', 'April', 'april aprila aprilu', 'travanj travnja travnju', '=sr'],
  ['m05', 'May', 'maj maja maju', 'svibanj svibnja svibnju', '=sr'],
  ['m06', 'June', 'jun juna junu', 'lipanj lipnja lipnju', 'juni juna junu'],
  ['m07', 'July', 'jul jula julu', 'srpanj srpnja srpnju', 'juli jula julu'],
  ['m08', 'August', 'avgust avgusta avgustu', 'kolovoz kolovoza kolovozu', 'august augusta augustu'],
  ['m09', 'September', 'septembar septembra septembru', 'rujan rujna rujnu', '=sr'],
  ['m10', 'October', 'oktobar oktobra oktobru', 'listopad listopada listopadu', '=sr'],
  ['m11', 'November', 'novembar novembra novembru', 'studeni studenoga studenom', '=sr'],
  ['m12', 'December', 'decembar decembra decembru', 'prosinac prosinca prosincu', '=sr'],
]

const toForms = (value: string) => value.split(/\s+/).filter(Boolean)

export const SEED_TERMBASE: TermConcept[] = RAW.map(([id, gloss, sr, hr, bs, strength, extra]) => {
  const srForms = toForms(sr)
  const hrForms = toForms(hr)
  const bsForms = bs === '=sr' ? srForms : bs === '=hr' ? hrForms : toForms(bs)
  return {
    id,
    gloss,
    forms: { sr: srForms, hr: hrForms, bs: bsForms },
    strength: strength ?? 'strong',
    ...extra,
  }
})

const sameForms = (a: string[], b: string[]) => a.length === b.length && a.every((f, i) => f === b[i])

/** Majority form for ExYu Neutral (shared by ≥2 of 3 standards), or null. */
export function neutralVariantFor(concept: TermConcept): Variant | null {
  const { sr, hr, bs } = concept.forms
  if (sameForms(sr, bs) && !sameForms(sr, hr)) return 'sr'
  if (sameForms(hr, bs) && !sameForms(sr, hr)) return 'hr'
  return null
}

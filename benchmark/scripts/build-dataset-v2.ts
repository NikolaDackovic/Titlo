/**
 * Builds benchmark/datasets/exyu-translation-100.json (dataset v2.0.0) — run once.
 *
 *   npx tsx benchmark/scripts/build-dataset-v2.ts
 *
 * v2 follows the Phase 3 category plan (10 categories × 10). It reuses 78 items of v1
 * (src/benchmark/sentences.ts, kept unchanged) and adds 22 new original lines. Once a
 * benchmark has been run on a dataset version, that version must not be edited: create
 * a new version instead.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BENCHMARK } from '../../src/benchmark/sentences'

type Category = 'everyday' | 'humor' | 'sarcasm' | 'emotional' | 'action' | 'slang' | 'idiom' | 'ambiguity' | 'long' | 'film-dialogue'

interface Item {
  id: string
  category: Category
  source: string
  references: { 'sr-Latn': string; hr: string; bs: string; 'exyu-neutral': string }
  challenge: string
  v1Id?: number
}

const CHALLENGE: Record<Category, string> = {
  everyday: 'Everyday phrasing; regional vocabulary and verb forms differ between variants.',
  humor: 'Joke must stay funny and short; wordplay may need adaptation.',
  sarcasm: 'Ironic meaning must survive; literal translation loses the tone.',
  emotional: 'Emotional register and naturalness; avoid stiff literal phrasing.',
  action: 'Very short imperative lines; must stay short and natural.',
  slang: 'Slang/colloquial English with no literal equivalent.',
  idiom: 'Idiom must be rendered by meaning, not word by word.',
  ambiguity: 'Multiple readings; context decides (references choose the most likely one).',
  long: 'Long, complex sentence; subtitle length and clause structure.',
  'film-dialogue': 'Natural film dialogue: multiple speakers, interruptions, phrasal verbs, negation.',
}

/** v1 id → v2 category (78 reused items). */
const FROM_V1: Array<[Category, number[]]> = [
  ['everyday', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  ['humor', [13, 14, 15, 16, 17, 18, 19, 20]],
  ['sarcasm', [21, 22, 23, 24, 25, 26, 27, 28]],
  ['emotional', [37, 38, 39, 40, 41, 42, 43, 44]],
  ['action', [45, 46, 47, 48, 49, 50, 51, 52, 53, 54]],
  ['slang', [63, 64, 65, 66, 67, 68, 69, 70, 95, 98]],
  ['idiom', [71, 72, 73, 74, 75, 76, 77, 78, 79, 80]],
  ['ambiguity', [81, 82, 83, 84, 85, 86, 87, 88]],
  ['long', [89, 90, 91, 92, 93, 94]],
]

type New = [Category, string, string, string, string, string, string]
const NEW: New[] = [
  ['humor', "I'm not arguing, I'm just explaining why I'm right.", 'Ne svađam se, samo objašnjavam zašto sam u pravu.', 'Ne svađam se, samo objašnjavam zašto sam u pravu.', 'Ne svađam se, samo objašnjavam zašto sam u pravu.', 'Ne svađam se, samo objašnjavam zašto sam u pravu.', 'Self-ironic punchline.'],
  ['humor', "My plants are dead again. I think they're doing it on purpose.", 'Biljke su mi opet uvenule. Mislim da to rade namerno.', 'Biljke su mi opet uvenule. Mislim da to rade namjerno.', 'Biljke su mi opet uvenule. Mislim da to rade namjerno.', 'Biljke su mi opet uvenule. Mislim da to rade namjerno.', 'Absurd humour; "dead" for plants.'],
  ['sarcasm', "Oh, sure. Take your time. It's not like we're in a hurry.", 'Ma naravno, ne žuri. Kao da nam se žuri.', 'Ma naravno, ne žuri. Kao da nam se žuri.', 'Ma naravno, ne žuri. Kao da nam se žuri.', 'Ma naravno, ne žuri. Kao da nam se žuri.', 'Sarcastic negation ("It\'s not like…").'],
  ['sarcasm', 'Great job. You broke it in record time.', 'Bravo. Pokvario si ga za rekordno vreme.', 'Bravo. Pokvario si ga u rekordnom vremenu.', 'Bravo. Pokvario si ga za rekordno vrijeme.', 'Bravo. Pokvario si ga za rekordno vrijeme.', 'Praise that means criticism.'],
  ['emotional', "I don't want to lose you.", 'Ne želim da te izgubim.', 'Ne želim te izgubiti.', 'Ne želim te izgubiti.', 'Ne želim te izgubiti.', 'Negation + infinitive vs "da" construction.'],
  ['emotional', "Why didn't you tell me you were leaving?", 'Zašto mi nisi rekao da odlaziš?', 'Zašto mi nisi rekao da odlaziš?', 'Zašto mi nisi rekao da odlaziš?', 'Zašto mi nisi rekao da odlaziš?', 'Reproach; reported speech; speaker gender unknown (masculine chosen).'],
  ['ambiguity', "I didn't say she stole the money.", 'Nisam rekao da je ona ukrala novac.', 'Nisam rekao da je ona ukrala novac.', 'Nisam rekao da je ona ukrala novac.', 'Nisam rekao da je ona ukrala novac.', 'Meaning depends on stress; negation scope.'],
  ['ambiguity', 'Leave it.', 'Pusti to.', 'Pusti to.', 'Pusti to.', 'Pusti to.', '"Drop the subject" vs "leave the object there".'],
  ['long', "I've been trying to call you all morning, but your phone was off, so I drove here because I thought something had happened to you.", 'Celo jutro pokušavam da te pozovem, ali telefon ti je bio isključen, pa sam se dovezao ovamo jer sam mislio da ti se nešto desilo.', 'Cijelo jutro te pokušavam nazvati, ali mobitel ti je bio isključen, pa sam se dovezao ovamo jer sam mislio da ti se nešto dogodilo.', 'Cijelo jutro pokušavam da te pozovem, ali telefon ti je bio isključen, pa sam se dovezao ovamo jer sam mislio da ti se nešto desilo.', 'Cijelo jutro pokušavam da te pozovem, ali telefon ti je bio isključen, pa sam se dovezao ovamo jer sam mislio da ti se nešto desilo.', 'Three clauses; too long for one subtitle — needs condensing.'],
  ['long', 'If you had told me the truth from the beginning, none of this would have happened.', 'Da si mi od početka rekao istinu, ništa od ovoga se ne bi desilo.', 'Da si mi od početka rekao istinu, ništa se od ovoga ne bi dogodilo.', 'Da si mi od početka rekao istinu, ništa od ovoga se ne bi desilo.', 'Da si mi od početka rekao istinu, ništa od ovoga se ne bi desilo.', 'Past conditional.'],
  ['long', 'The man who sold us the car, the one with the beard, called again and said he wants it back.', 'Čovek koji nam je prodao auto, onaj sa bradom, opet je zvao i rekao da hoće auto nazad.', 'Čovjek koji nam je prodao auto, onaj s bradom, opet je zvao i rekao da želi auto natrag.', 'Čovjek koji nam je prodao auto, onaj s bradom, opet je zvao i rekao da hoće auto nazad.', 'Čovjek koji nam je prodao auto, onaj s bradom, opet je zvao i rekao da hoće auto nazad.', 'Embedded relative clause and apposition; "wants it back".'],
  ['long', "Before you say anything, I know I messed up, and I'm not asking you to forgive me, I just need you to listen.", 'Pre nego što bilo šta kažeš, znam da sam zabrljao i ne tražim da mi oprostiš, samo treba da me saslušaš.', 'Prije nego što išta kažeš, znam da sam zabrljao i ne tražim da mi oprostiš, samo te molim da me saslušaš.', 'Prije nego što bilo šta kažeš, znam da sam zabrljao i ne tražim da mi oprostiš, samo trebam da me saslušaš.', 'Prije nego što išta kažeš, znam da sam zabrljao i ne tražim da mi oprostiš, samo te molim da me saslušaš.', 'Phrasal verb "messed up"; several clauses.'],
  ['film-dialogue', '- Where were you last night?\n- Out.', '- Gde si bio sinoć?\n- Napolju.', '- Gdje si bio sinoć?\n- Vani.', '- Gdje si bio sinoć?\n- Vani.', '- Gdje si bio sinoć?\n- Vani.', 'Two speakers in one subtitle; dash formatting must be kept.'],
  ['film-dialogue', 'Wait, wait, wait. Back up. You did what?', 'Čekaj, čekaj, čekaj. Vrati malo. Šta si uradio?', 'Čekaj, čekaj, čekaj. Vrati malo. Što si napravio?', 'Čekaj, čekaj, čekaj. Vrati malo. Šta si uradio?', 'Čekaj, čekaj, čekaj. Vrati malo. Šta si uradio?', 'Phrasal verb "back up" (= repeat), not "reverse".'],
  ['film-dialogue', "I'm not going anywhere until you tell me what's going on.", 'Ne idem nigde dok mi ne kažeš šta se dešava.', 'Ne idem nikamo dok mi ne kažeš što se događa.', 'Ne idem nigdje dok mi ne kažeš šta se dešava.', 'Ne idem nigdje dok mi ne kažeš šta se dešava.', 'Double negation; "going on".'],
  ['film-dialogue', '- Is he dead?\n- Not yet.', '- Je li mrtav?\n- Još nije.', '- Je li mrtav?\n- Još nije.', '- Je li mrtav?\n- Još nije.', '- Je li mrtav?\n- Još nije.', 'Two speakers; elliptical answer.'],
  ['film-dialogue', "Don't you dare hang up on me!", 'Da se nisi usudio da mi spustiš slušalicu!', 'Da se nisi usudio spustiti mi slušalicu!', 'Da se nisi usudio spustiti mi slušalicu!', 'Da se nisi usudio spustiti mi slušalicu!', 'Phrasal verb "hang up on"; threat.'],
  ['film-dialogue', 'We need to talk. Not here.', 'Moramo da razgovaramo. Ne ovde.', 'Moramo razgovarati. Ne ovdje.', 'Moramo razgovarati. Ne ovdje.', 'Moramo razgovarati. Ne ovdje.', 'Short fragments.'],
  ['film-dialogue', "You can't just show up after ten years and act like nothing happened.", 'Ne možeš tek tako da se pojaviš posle deset godina i da se ponašaš kao da se ništa nije desilo.', 'Ne možeš se tek tako pojaviti nakon deset godina i ponašati se kao da se ništa nije dogodilo.', 'Ne možeš se tek tako pojaviti nakon deset godina i ponašati se kao da se ništa nije desilo.', 'Ne možeš se tek tako pojaviti nakon deset godina i ponašati se kao da se ništa nije desilo.', 'Phrasal verb "show up"; reproach.'],
  ['film-dialogue', "I was gonna tell you, I swear, I just... I didn't know how.", 'Hteo sam da ti kažem, kunem se, samo... nisam znao kako.', 'Htio sam ti reći, kunem se, samo... nisam znao kako.', 'Htio sam ti reći, kunem se, samo... nisam znao kako.', 'Htio sam ti reći, kunem se, samo... nisam znao kako.', 'Interrupted sentence with ellipsis; "gonna".'],
  ['film-dialogue', "Get in the car. Now. I'll explain later.", 'Ulazi u auto. Odmah. Objasniću ti kasnije.', 'Ulazi u auto. Odmah. Objasnit ću ti kasnije.', 'Ulazi u auto. Odmah. Objasnit ću ti kasnije.', 'Ulazi u auto. Odmah. Objasnit ću ti kasnije.', 'Commands + future tense spelling (objasniću / objasnit ću).'],
  ['film-dialogue', '- Did you lock the door?\n- I thought you did.', '- Jesi li zaključao vrata?\n- Mislio sam da si ti.', '- Jesi li zaključao vrata?\n- Mislio sam da si ti.', '- Jesi li zaključao vrata?\n- Mislio sam da si ti.', '- Jesi li zaključao vrata?\n- Mislio sam da si ti.', 'Two speakers; elided verb ("you did").'],
]

const ORDER: Category[] = ['everyday', 'humor', 'sarcasm', 'emotional', 'action', 'slang', 'idiom', 'ambiguity', 'long', 'film-dialogue']
const PREFIX: Record<Category, string> = { everyday: 'EVD', humor: 'HUM', sarcasm: 'SAR', emotional: 'EMO', action: 'ACT', slang: 'SLG', idiom: 'IDI', ambiguity: 'AMB', long: 'LNG', 'film-dialogue': 'FLM' }

const items: Item[] = []
for (const category of ORDER) {
  const fromV1 = FROM_V1.find(([c]) => c === category)?.[1] ?? []
  const rows: Omit<Item, 'id'>[] = [
    ...fromV1.map((v1Id) => {
      const b = BENCHMARK.find((x) => x.id === v1Id)!
      return { category, source: b.en, references: { 'sr-Latn': b.sr, hr: b.hr, bs: b.bs, 'exyu-neutral': b.neutral }, challenge: b.note ? `${CHALLENGE[category]} ${b.note}` : CHALLENGE[category], v1Id }
    }),
    ...NEW.filter(([c]) => c === category).map(([, source, sr, hr, bs, neutral, note]) => ({ category, source, references: { 'sr-Latn': sr, hr, bs, 'exyu-neutral': neutral }, challenge: `${CHALLENGE[category]} ${note}` })),
  ]
  if (rows.length !== 10) throw new Error(`${category} has ${rows.length} items, expected 10`)
  rows.forEach((r, i) => items.push({ id: `${PREFIX[category]}-${String(i + 1).padStart(2, '0')}`, ...r }))
}

const body = JSON.stringify(items)
const dataset = {
  name: 'exyu-translation-100',
  version: '2.0.0',
  created: '2026-11-10',
  sourceLanguage: 'en',
  itemCount: items.length,
  contentSha256: createHash('sha256').update(body).digest('hex'),
  notes: [
    'All source lines are original test sentences written for this project (no quotes from existing films or series).',
    'References are DRAFTS (AI-assisted) and must be reviewed by native speakers. They are one valid translation, not the only one.',
    'Serbian references are ekavian; Croatian, Bosnian and ExYu Neutral references are ijekavian.',
    'Do not edit this file after a benchmark run; create a new version instead.',
  ],
  categories: Object.fromEntries(ORDER.map((c) => [c, CHALLENGE[c]])),
  items,
}

const out = path.resolve('benchmark/datasets/exyu-translation-100.json')
if (existsSync(out) && !process.argv.includes('--force')) throw new Error(`${out} exists; datasets are immutable (use a new version or --force before any run).`)
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(dataset, null, 2) + '\n')
console.log(`Wrote ${items.length} items → ${out} (sha256 ${dataset.contentSha256.slice(0, 12)}…)`)

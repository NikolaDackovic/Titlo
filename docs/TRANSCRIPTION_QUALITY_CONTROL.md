# Kontrola kvaliteta transkripcije (Titlo)

Cilj: nijedna sumnjiva Whisper transkripcija ne sme neprimetno da postane konačan titl. Korisnik ima
kontrolu nad tekstom, prevodom i terminologijom.

Tri pravila važe svuda:

1. **Ništa se ne briše i ne menja automatski.** QC samo upozorava. Tekst, vremena i prevodi menjaju se
   isključivo korisničkom akcijom (i to kroz undo istoriju).
2. **Nema izmišljene pouzdanosti.** Upozorenja su heuristike. Ne prikazuje se nikakav „confidence“
   procenat, nego šta je izmereno (npr. „zvuk u 12 % vremena, najglasnije −58 dBFS“).
3. **Ručni rad je zaštićen.** Provereni, ručno izmenjeni i odobreni originali se ne prepisuju novom
   transkripcijom, a ručno izmenjen prevod se ne zamenjuje mašinskim, osim posle izričite potvrde.

## Arhitektura

```
decodeToMono16k (Web Audio, jednom)
  ├─ computePeaks ............ talasni oblik (timeline)
  └─ analyzeActivity ......... AudioActivity: dBFS + ZCR po 20 ms okviru (~2 bajta/okvir; 2 h ≈ 0,7 MB)
                                 → sesija (SessionMedia.activity), uzorci se zatim oslobađaju

runQc (čiste funkcije, useDeferredValue u Studiju)
  └─ checkTranscript ......... kategorija "Transkripcija"  (src/qc/checks/transcript.ts)
        ├─ describeRange(activity, start, end)  → tišina / ujednačen zvuk / promenljiv zvuk / nalik govoru
        └─ activeRegions(activity)              → delovi sa zvukom (za „govor bez titla“)

useTranscription
  └─ novi segmenti: sourceOrigin = whisper, sourceStatus = unreviewed
     → checkTranscript → segmenti sa upozorenjem: needs-review (flagForReview)
```

Nema dodatnog modela ni workera: analiza je jedan prolaz kroz uzorke koje transkripcija ili talasni
oblik već imaju u memoriji. Izmereno: 5 min zvuka za ~40 ms, pa ~1 s za 2 h (Node, isti računar).

Audio aktivnost postoji samo dok je medij priložen u sesiji (browser ne pamti pristup fajlu posle
restarta). Bez nje rade provere teksta (ponavljanje, poznate halucinacije, neobični segmenti), a QC
panel napominje da provere tišine traže priložen video/audio.

## Detekcija tišine i audio aktivnosti (`src/media/audioActivity.ts`)

Po okviru od 20 ms: RMS nivo u dBFS (short-time energy) i broj prolazaka kroz nulu (ZCR).

| Prag | Vrednost | Značenje |
|---|---|---|
| `SILENT_DB` | −55 dBFS | okvir ispod ovoga je tih (pozadina tihog snimka je oko −60…−50) |
| `QUIET_DB` | −40 dBFS | aktivan zvuk ispod ovog proseka je „tih“ (šapat, udaljen ili veoma tih govor) |
| tišina | < 10 % aktivnih okvira | |
| ujednačen zvuk | raspon nivoa (p90 − p10) < 6 dB | šum, brujanje, ton |
| nalik govoru | udeo „niskoenergetskih“ okvira ≥ 0,2 **i** raspon ZCR ≥ 0,04 | pauze između slogova i smena zvučnih/bezvučnih glasova |
| promenljiv zvuk | ostalo | najčešće muzika; može biti i govor u buci |

Udeo niskoenergetskih okvira (u prozorima od 1 s, okviri ispod polovine srednje energije prozora) je
klasična osobina za razlikovanje govora i muzike (Scheirer i Slaney, 1997).

Šta sistem razlikuje:

| Situacija | Rezultat | Provereno na |
|---|---|---|
| Prava tišina | tišina | sintetička tišina, `controls/silence-10s.wav` |
| Muzika bez govora | promenljiv zvuk (nije govor) | sintetički akordi, `controls/music-10s.wav` |
| Šum | ujednačen zvuk | sintetički šum, `controls/noise-10s.wav` |
| Govor niske jačine | nalik govoru + „tih“ (nikad tišina) | sintetički govor na −50 dBFS; svi TTS snimci utišani 30 dB |
| Šapat | aktivan, „tih“, nije tišina | sintetički bezvučni slogovi |
| Govor uz muziku | nalik govoru | sintetički; 6 TTS snimaka sa muzikom (6 dB SNR) |
| Kratke reči | reč je aktivna, okolina tišina | 0,3 s reč u tišini |
| Duge pauze / govor posle duge tišine | odvojeni delovi, tačno vreme početka (±300 ms) | sintetički |

Na 46 Windows TTS snimaka (Zira, David; čisto, sa šumom 10 dB i sa muzikom 6 dB) svih 46 je
„nalik govoru“, a sve tri kontrole bez govora nisu. Ovo su **sintetički** glasovi i signali, a ne
merenje na ljudskom govoru, srpskom, hrvatskom ili bosanskom. Pre podešavanja prag je bio 0,3; jedan
TTS snimak sa šumom (0,26) tada nije prepoznat kao govor, pa je prag spušten na 0,2 (muzička
kontrola: 0,04).

Ograničenja: prava muzika sa vokalom, pevanje, aplauz i govor u velikoj buci mogu dobiti bilo koju
oznaku. Zato upozorenje za „promenljiv zvuk“ postoji samo za tipične poštapalice („you“, „Thank you.“).
Ničija reč se ne briše na osnovu ove analize. Originalna vremenska osa se ne menja.

## Heuristike (`src/qc/checks/transcript.ts`)

Proveravaju se samo originali čije je poreklo `whisper`. Originali sa statusom `verified` ili
`approved` se ne proveravaju ponovo (korisnik je već odlučio).

| Kôd | Nivo | Kada |
|---|---|---|
| `possible-silence-hallucination` | upozorenje | tekst na tišini ili ujednačenom zvuku; poznate izmišljene rečenice (špica titlova, „subscribe“, „thanks for watching“, „hvala na gledanju“, i bez zvuka); tipična poštapalica na muzici |
| `possible-repeated-output` | upozorenje | isti tekst kao prethodni segment (bez obzira na velika slova i interpunkciju); ista 1–4 reči ponovljene ≥ 3 puta zaredom |
| `possible-low-audio-activity` | upozorenje / predlog | zvuk u < 30 % segmenta od ≥ 1,5 s (upozorenje); tih govor, prosek < −40 dBFS (predlog) |
| `possible-unusual-segment` | upozorenje | segment duži od 10 s; više od 30 znakova po sekundi |
| `possible-missing-speech` | upozorenje | deo nalik govoru ≥ 2 s koji titlovi pokrivaju manje od 20 %; prazan titl preko govora |

Upozorenja „govor bez titla“ nose vremenski raspon (`range`) i vezuju se za titl pre praznine.

Ranije je `chunksToSegments` **tiho brisao** redove sa špicom titlova i uzastopne duplikate. Od ove
verzije oni ostaju, a QC ih prikazuje kao upozorenja. Isto je izmereno kao glavni problem u prethodnoj
fazi: na tišini Whisper piše „you“, a na šumu i muzici „Thank you.“ (`docs/SPEECH_ACCURACY_REPORT.md`).

## Statusi originala

Status originala (`Segment.sourceStatus`) je **odvojen** od statusa prevoda
(`SegmentTranslation.status`). Segment može imati original `verified` i prevod `not_translated`.

| Status | Kad nastaje |
|---|---|
| `unreviewed` | novi Whisper rezultat; uvezen fajl; stari projekti posle migracije |
| `needs-review` | QC upozorenje posle transkripcije (samo ako je bio `unreviewed`), ili ručno (zastavica u inspektoru) |
| `verified` | korisnik: „Preslušao/la sam: tekst je tačan“ (✓ u QC panelu ili u inspektoru) |
| `manually-edited` | korisnik je promenio tekst originala (kucanje, deljenje, spajanje, zamena u originalu, novi ručni titl) |
| `approved` | korisnik eksplicitno odobri original kao konačan |

Promena vremena ne menja status. Izmena teksta odobrenog originala daje `manually-edited`, jer odobreni
tekst više ne postoji. Poreklo (`sourceOrigin`): `whisper`, `import`, `manual`.

Na timeline-u blok dobija tanku gornju ivicu boje statusa (bez ivice: nepregledano; žuta: proveriti;
plava: provereno; ljubičasta: izmenili ste; zelena: odobreno). Zastareo prevod ima isprekidanu ivicu.
U listi titlova je mala tačka iste boje, uz filtere „Original: za pregled / izmenili ste / proveren ili
odobren“ i „Zastareo prevod“.

## Zaštita ručnog rada

- **Nova transkripcija** preko postojećih titlova: ako ima proverenih, izmenjenih ili odobrenih
  originala, dijalog nudi „Zadrži moj rad i transkribuj“ (podrazumevano) ili „Zameni sve“. Uz
  „Zadrži“ ti titlovi ostaju potpuno isti, a novi Whisper segmenti koji se s njima vremenski preklapaju
  se ne dodaju (`mergeTranscription`). Sve je jedan undo korak.
- **Prevod**: ručno izmenjeni, odobreni i zaključani prevodi se preskaču (kao i ranije). Za zastarele
  ručne prevode dijalog nudi „Samo mašinske prevode“ ili „Zameni i moje izmene“.

## Povezanost sa playerom

Koristi se postojeći player (`VideoPanel`), dobio je samo `playRange(od, do)`.

- Klik na upozorenje: titl se selektuje, playhead ide na početak titla (za „govor bez titla“ na
  početak praznine), inspektor se otvara, a fokus ide u polje originala, pa se tekst odmah ispravlja.
- ▶ u redu upozorenja ili u inspektoru: reprodukcija titla uz 1,5 s pre i posle, sa automatskom pauzom
  na kraju. Ručni klik na play/pauzu prekida automatsku pauzu.
- Tekst upozorenja kaže zašto je titl označen (npr. „zvuk je ovde: tišina; zvuk u 4 % vremena,
  najglasnije −61 dBFS“).

## Povezanost sa prevodom

- Pre prevoda (ceo projekat, izabrani titlovi ili jedan titl) proverava se koliko izabranih titlova
  ima original koji još čeka pregled: Whisper original `unreviewed` ili bilo koji `needs-review`.
  Uvezeni titlovi se ne računaju, jer ih je pravio čovek. Ako takvih ima, dijalog nudi:
  - **Samo proverene i odobrene** (`verified` + `approved`, kako je traženo),
  - **Sve titlove**,
  - **Nastavi, ne pitaj ponovo** (do zatvaranja Studija),
  - **Nazad na pregled** (otvara Kvalitet → Transkripcija).
  Prevod se nikad ne odbija automatski.
- Svaki prevod pamti original od kog je nastao (`sourceText`, kolona `source_snapshot`). Ako se
  original promeni, prevod ostaje, a prikazuje se kao **zastareo**: napomena u inspektoru sa starim
  originalom i dugmetom „Prevedi ponovo“, brojač u panelu Prevod i dugme za zastarele, filter u listi i
  isprekidana ivica na timeline-u. Prevodi iz starijih verzija nemaju zapamćen original, pa se nikad
  ne prikazuju kao zastareli (nepoznato nije isto što i zastarelo).

## Terminologija i prevod

„Glosar“ se u interfejsu zove **Terminologija**, a pojedinačni skupovi su **liste termina**. Baza i kod
su zadržali ime `glossary`. Termin ima: original, **preporučeni prevod**, **alternativne prevode**
(novo), jezik, profil (sr latinica, sr ćirilica, hr, bs, ExYu Neutral, en ili svi), kontekst,
**kategoriju** (novo), napomenu, prioritet i opcije poklapanja.

- QC razlikuje preporučeni prevod (u redu), prihvatljivu alternativu (predlog), **nedoslednost**
  (alternativa ovde, a preporučeni prevod na drugom mestu u projektu: upozorenje) i izostanak termina
  (upozorenje). Ćirilični profil proverava ćirilične oblike. Prevodi se ne pretpostavljaju jednakim za
  sve regionalne profile, jer svaki termin ima svoj profil.
- OPUS-MT ne može da primi listu termina. Zato se mašinski prevod koji ne sadrži ni preporučeni termin
  ni alternativu označava *Za pregled* umesto *Prevedeno* (`missedTerms`). Tekst se ne menja, a
  korisnikov ručni prevod se ne dira. Lokalni LLM provider dobija termine u promptu.
- CSV/JSON uvoz i izvoz imaju kolone `alternatives` (odvojene sa `|`) i `category`. Stari fajlovi se
  uvoze bez izmena.

## Migracija baze (v2)

`src/persistence/migrations.ts`, verzija 2 (samo `ALTER TABLE … ADD COLUMN` i jedan `UPDATE` porekla):

| Tabela | Kolona | Podrazumevano |
|---|---|---|
| `subtitle_segments` | `source_status` | `'unreviewed'` |
| `subtitle_segments` | `source_origin` | `'import'`; `'whisper'` za projekte bez uvezenog fajla sa završenim poslom transkripcije |
| `segment_translations` | `source_snapshot` | `NULL` (nepoznato) |
| `glossary_terms` | `alternatives`, `category` | `''` |

Baza se ne resetuje, ID-jevi i tekstovi se ne menjaju, a migracija se izvršava u transakciji zajedno sa
upisom u `schema_migrations`. Pre migracija se pravi backup (postojeći mehanizam). Test: pravi v1 baza sa
podacima → otvaranje → v2, isti ID-jevi i tekstovi, ispravno poreklo, stari prevod nije zastareo
(`persistence.integration.test.ts`).

## Performanse

Merenja iz `src/qc/performance.test.ts` (Node, Ryzen 3 3200U, uz drugo opterećenje; vrednosti
variraju ±50 %):

| | Vreme |
|---|---|
| Provere transkripcije, 2.000 titlova + 2 h audio aktivnosti | ~110–250 ms |
| Sve QC provere zajedno | ~330–380 ms |
| `analyzeActivity`, 5 min zvuka | ~40 ms (≈ 1 s za 2 h) |
| Autosave 2.000 titlova sa statusima / učitavanje | ~105–165 ms / ~135–185 ms |

U Edge-u (dev build, uvezen SRT sa 2.000 titlova, računar u swap-u):

| | Pre | Posle |
|---|---|---|
| Kucanje u originalu, do sledećeg kadra (medijana / p90) | 536 / 1053 ms | **88 / 216 ms** |
| Pomeranje timeline-a (medijana kadra), crta se 28 od 2.000 blokova | — | 22 ms |
| Otvaranje taba Provera | — | ~1,5 s |

Uzrok sporog kucanja nije bio QC, nego **postojeći** problem koji je ova faza otkrila. Studio je listi titlova
prosleđivao `select` callback koji se menjao pri svakoj izmeni, pa `memo` nije radio i svih 2.000 redova
se ponovo crtalo na svaki taster. Sada je callback stabilan (`useLayoutEffect` + ref).

QC radi nad `useDeferredValue(segments)`, pa kucanje ostaje glatko. Timeline crta samo vidljive
blokove (ranije uvedeno). Provera „govor bez titla“ koristi binarnu pretragu, a ne prolaz kroz sve
titlove za svaki deo zvuka. Opis zvuka segmenta koristi histograme i tabelu umesto sortiranja i
`Math.pow`, što je sa 2.000 titlova bilo ~4× brže.

## Poznata ograničenja

- Pragovi su podešeni na sintetičkim signalima i TTS glasovima. Na stvarnim snimcima (filmovi, podkasti,
  srpski/hrvatski/bosanski) nisu mereni, a lažno pozitivni i lažno negativni rezultati su mogući.
- Govor uz glasnu muziku, pevanje i govor u buci heuristika ne razlikuje pouzdano.
- Audio aktivnost se ne čuva u bazi: posle restarta je ponovo dostupna kad se video/audio ponovo
  izabere.
- Transformers.js 4.3 ne vraća pouzdanost po rečima ni no-speech verovatnoću po segmentu, pa ih QC ne
  koristi.
- Status „needs-review“ se postavlja automatski samo posle transkripcije. Kasnija upozorenja (npr. posle
  priloženog medija) se prikazuju u QC panelu bez promene statusa.

## Testovi

| Fajl | Šta |
|---|---|
| `src/media/audioActivity.test.ts` | tišina, muzika, šum, govor, tih govor, šapat, govor uz muziku, kratka reč, duge pauze, govor posle duge tišine, memorija; TTS WAV snimci i kontrole |
| `src/qc/transcript.test.ts` | svih 5 provera, poštapalice, špica, ponavljanje, malo zvuka, tih govor, preduge/prebrze rečenice, govor bez titla, prazan titl, „QC ne menja tekst“, preskakanje proverenih i uvezenih, bez procenata pouzdanosti, Terminologija (preporučeno/alternativa/nedosledno/izostavljeno, `missedTerms`) |
| `src/state/review.workflow.test.ts` | ceo tok: transkripcija → upozorenje → izmena (`manually-edited`) → provera → prevod → izmena originala → zastareo prevod → ručni prevod sačuvan; „Zadrži moj rad“ |
| `src/persistence/persistence.integration.test.ts` | migracija v1 → v2 sa podacima, čuvanje novih polja, CSV/JSON alternative |
| `src/qc/performance.test.ts` | 2.000 titlova |
| `src/branding.test.ts` | nema starog imena ni „Glosar/Glossary“ u interfejsu; SR/EN dosledni |

Svi audio signali u testovima su **sintetički** (`src/test/syntheticAudio.ts`) ili Windows TTS. To nije
benchmark srpskog, hrvatskog ni bosanskog govora.

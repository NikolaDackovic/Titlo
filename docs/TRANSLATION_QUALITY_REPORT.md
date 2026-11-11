# Izveštaj o kvalitetu prevoda — OPUS-MT `opus-mt-tc-base-en-sh`

**Datum:** 2026-11-10 · **Status modela u aplikaciji: `Experimental`** · **Ljudska evaluacija: `Not evaluated`** · **Komercijalna distribucija: `Pending legal review`**

> Svi primeri u ovom dokumentu su **stvarni izlazi modela** iz benchmark pokretanja
> `benchmark/results/2026-11-10T20-05-28-674Z-opus-q8-b4/` (osim gde je drugačije navedeno).
> Kvalitativne napomene i oznake „kandidat za kritičnu grešku“ su **preliminarna analiza
> razvojnog tima (AI asistent)**. To **nije** ljudska evaluacija i ne zamenjuje je.

## 1. Sažetak

| Pitanje | Odgovor |
|---|---|
| Da li model stvarno radi lokalno? | **Da.** Node (onnxruntime-node, CPU): 400/400 benchmark prevoda bez greške. Browser (WASM u Web Worker-u): pravi prevod projekta kroz UI. Bez cloud API-ja; `allowRemoteModels = false`. |
| Da li je kvalitet dovoljan za produkciju? | **Nije dokazano**, a preliminarni nalazi govore protiv toga bez ljudske korekcije: idiomi i sleng se često prevode pogrešno (chrF ≈ 38–41 u tim kategorijama), uz nekoliko grešaka u značenju. |
| Gde je dobar? | Kratke emotivne replike i komande (chrF 83–90), svakodnevni dijalog (≈ 70–78), duže rečenice sa jasnom strukturom (≈ 74–78). |
| Regionalni profili | Hrvatski: dosledan. Srpski: dobar posle popravke mojibake-a. Bosanski: povremeno meša ekavicu. ExYu Neutral: heuristika, **nije validirana**. |
| Preporuka | Koristiti kao **pomoć prevodiocu** (nacrt koji se obavezno pregleda), ne kao automatski prevod. |

## 2. Šta je tačno testirano

| Stavka | Vrednost |
|---|---|
| Model | `Helsinki-NLP/opus-mt-tc-base-en-sh` @ `8a5d73fe…` (CC-BY-4.0); ONNX `TigreGotico/opus-mt-tc-base-en-sh-onnx` @ `83f8ae0f…`; int8 encoder + decoder |
| Runtime | Transformers.js 4.3.2 + onnxruntime-node 1.30.0 (CPU); browser: onnxruntime-web 1.31.0-dev (WASM) |
| Dataset | `benchmark/datasets/exyu-translation-100.json` v2.0.0 (sha256 `86444208…`), 100 rečenica, 10 kategorija × 10 |
| Generisanje | beam 4, max 256 novih tokena, jedan titl po pozivu; titl se deli na rečenice i replike |
| Hardver | AMD Ryzen 3 3200U (2 jezgra / 4 niti), **3,4 GB RAM** (slobodno 0,3–0,4 GB), Radeon Vega 3 (nije korišćen), Windows 10 19045 |

## 3. Šta je pronađeno i ispravljeno tokom testiranja

| # | Problem (stvarno izmeren) | Uzrok | Ispravka | Efekat |
|---|---|---|---|---|
| 1 | Izbor varijante nije radio: `>>hrv<<` i `>>srp_Latn<<` davali su skoro isti izlaz | Transformers.js v4 deli jezički token na `>`,`>`,`hr`,`v`,`<`,`<` (stara `MarianTokenizer._encode_text` logika se više ne poziva) | Jezički tokeni su upisani kao `added_tokens` u generisani `tokenizer.json` | Token radi: `hrv` → „kruh, vlak, što“; `srp_Latn` → „hleb, voz, šta“ |
| 2 | `srp_Latn` izlaz: „sinoæ“, „hoæeš“, „Zvaæu“ (35/100 rečenica) | Model je naučio Windows-1250 → Latin-1 mojibake iz podataka za treniranje | Deterministička zamena æ→ć, è→č, ð→đ (+ velika slova); ti znakovi ne postoje u sr/hr/bs | 0 mojibake znakova posle popravke |
| 3 | Rečenice nestaju: „Get down! Now!“ → „Dolje!“; „Run! Don't look back!“ → „Ne osvrći se!“ | Model je treniran na pojedinačnim rečenicama | Svaki titl se deli na rečenice i replike, koje se prevode posebno | chrF +3,4 do +3,9 poena za sve profile (run 1 → run 2) |
| 4 | Batch sa beam search-om menja rezultat (3/24 u run 1, 1/24 u run 2) | Efekat paddinga u batch beam search-u | Provider šalje jedan ulaz po pozivu | Ponovljivo: batch == pojedinačno |
| 5 | Lažna vodeća crtica („-Ulazi u auto“) | Artefakt modela | Uklanja se kad je izvor nema | — |
| 6 | Lokalizacija: high-confidence predlog „otoku → ostrvu“ za bosanski | Heuristika u termbase-u | Koncept „island“ prebačen na `soft` (samo predlog za pregled) | Regresioni test dodat |

## 4. Automatske metrike (pomoćni pokazatelj, nije ocena kvaliteta)

chrF (0–100) prema **jednom** referentnom prevodu (nacrt, nije pregledan od izvornih govornika). Mnogi tačni prevodi dobijaju niži chrF jer se razlikuju od reference.

| Kandidat (profil · ruta) | Koraci | chrF | Svakodn. | Humor | Sarkazam | Emocije | Akcija | Sleng | Idiomi | Dvosmisl. | Duge | Film |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **hr · hrv** | model | **70.2** | 77.6 | 70.6 | 66.5 | 88.1 | 86.8 | 38.0 | 38.0 | 51.3 | 74.5 | 78.0 |
| **sr-Latn · srp_Latn** | model + mojibake | **70.1** | 73.9 | 67.2 | 65.2 | 85.5 | 83.3 | 38.4 | 41.0 | 58.1 | 78.3 | 75.6 |
| sr-Latn · srp_Cyrl→lat | model + translit. | 68.3 | 72.4 | 68.1 | 60.2 | 86.0 | 82.5 | 34.9 | 40.9 | 60.5 | 75.1 | 74.0 |
| **sr-Cyrl · srp_Latn→ćir** | model + mojibake + translit. | **70.1** | (isto kao sr-Latn) |||||||||| 
| sr-Cyrl · srp_Cyrl | model | 68.3 | 72.4 | 68.1 | 60.2 | 86.0 | 82.5 | 34.9 | 40.9 | 60.5 | 75.1 | 74.0 |
| **bs · bos_Latn** | model | **69.2** | 69.7 | 68.8 | 62.4 | 89.9 | 83.4 | 37.8 | 41.0 | 55.2 | 74.5 | 78.3 |
| bs · hrv + lokalizacija | model + lokalizacija* | 69.1 | 66.6 | 69.9 | 62.6 | 85.6 | 86.7 | 34.7 | 41.6 | 55.6 | 76.4 | 75.9 |
| **neutral · bos_Latn** | model | **69.3** | 69.9 | 69.9 | 62.4 | 87.5 | 83.4 | 44.7 | 40.9 | 55.2 | 73.2 | 78.3 |
| neutral · hrv + lokalizacija | model + lokalizacija* | 69.8 | 61.3 | 69.4 | 62.6 | 86.8 | 86.7 | 41.5 | 41.5 | 55.6 | 78.1 | 75.9 |

\* Automatski prihvaćeni samo predlozi „high confidence“ (bs: 7, neutral: 5), **isključivo za analizu**. U aplikaciji su to predlozi koje korisnik odobrava.
**Podebljano = ruta koju aplikacija koristi.** Razlike manje od ~1 chrF poena su u granicama šuma za 100 rečenica.

Automatske oznake (konačne rute): mojibake 0; cifre umesto reči u 1–2 stavke („10 godina“, „20 godina“); pogrešan jat u `bos_Latn` u 5 stavki (hleb, mleko, nedelje, cela, poslednji); prazni i neprevedeni izlazi 0.

## 5. Performanse (izmereno na mašini iz tačke 2)

| Metrika | Node (benchmark run 2) | Browser (Edge, WASM, kroz UI) |
|---|---|---|
| Uspešno / neuspešno | 400 / 0 (4 tokena × 100) | 4 / 0 u svakom od 2 pokretanja (test projekat), identičan izlaz |
| Učitavanje modela | 9,0 s (5,9–11,7 s u drugim pokretanjima) | **44–60 s** (2 pokretanja) |
| Vreme do prvog rezultata | 11,0 s | — |
| Latencija po titlu (svi tokeni) | prosek 224 ms · medijana 192 ms · p95 496 ms | 1,0–2,9 s (4 titla za 4,2 s, odnosno 11,6 s; velika varijacija zbog premeštanja memorije na disk) |
| Brzina | 141–175 izvornih znakova/s | — |
| Ukupno (400 prevoda) | 100,8 s | — |
| Vršna memorija | 721 MB RSS (Node proces, uključuje ONNX Runtime) | nepouzdano: Windows je zbog nedostatka RAM-a premeštao memoriju na disk (merenja 601–743 MB working set) |
| CPU | ≈ 2,4 od 4 logičke niti u proseku | nije mereno |
| GPU | nije korišćen (CPU execution provider) | nije korišćen (WASM) |
| Model na disku | 398 MB | isti fajlovi |

Procena za ceo film (~1.200 titlova) na ovoj mašini: oko 4,5 min u Node-u, a u browseru 20–60 min. Ovo je ekstrapolacija, ne merenje.

## 6. Analiza kvaliteta po kategorijama (preliminarno, nije ljudska ocena)

**Najbolje:** emotivni dijalozi (85–90), kratke komande (83–87), dijalog iz filmova (74–78).
**Najslabije:** sleng (35–45) i idiomi (38–42), zatim dvosmislenost (51–60) i sarkazam (60–67).

### Kandidati za kritičnu grešku (`critical_error`, potrebna ljudska potvrda)

| ID | Original | Izlaz modela (hr) | Problem | Predložena korekcija |
|---|---|---|---|---|
| SAR-04 | Really, I couldn't have failed without you. | Stvarno, ne bih uspio bez tebe. | **Obrnuto značenje** (sarkazam: „bez tebe ne bih uspio da zabrljam“) | Stvarno, bez tebe ne bih uspio zabrljati. |
| SLG-03 | He totally ghosted me. | Totalno me je ulovio. | Pogrešno značenje (sr-Cyrl: „зачарао“) | Skroz me ignorirao, nestao je bez riječi. |
| SLG-04 | That's so cringe. | To je tako crvenkasto. | Besmisleno (bs/sr: „zanosno“, sr-Cyrl: „цринге“) | Baš je neugodno. |
| SLG-01 | That party was lit. | Ta zabava je bila prava. | Slabo značenje | Tulum je bio brutalan. |
| IDI-01 | It's raining cats and dogs. | Pada kiša, mačke i psi. | Doslovno, besmisleno | Lije kao iz kabla. |
| IDI-02 | Break a leg! | Slomi nogu! | Doslovno, suprotna poruka | Sretno! |
| IDI-06 | He spilled the beans. | Prosuo je grah. | Doslovno | Izlanuo se. |
| IDI-09 | It costs an arm and a leg. | Košta ruku i nogu. | Doslovno | Košta kao svetog Petra kajgana. |
| HUM-02 | My diet starts tomorrow. It always does. | … Uvijek se dogodi. | Pogrešno značenje druge rečenice | … Kao i uvijek. |
| FLM-02 | Back up. You did what? | Natrag. Što si učinio? | Frazalni glagol pogrešno („vrati malo“) | Vrati malo. Što si napravio? |
| FLM-05 | Don't you dare hang up on me! | Ne spuštaj mi slušalicu! | Izgubljena pretnja („don't you dare“); sr-Cyrl: „Не буди усуђен…“ (negramatično) | Da se nisi usudio spustiti mi slušalicu! |
| SAR-04 (bs, sr-Cyrl) | Thanks for the help. Really, … | „Hvala na pomoći. **Ne.** Stvarno…“ | **Halucinirana reč** | — |
| IDI-04 (srp_Cyrl) | That's a piece of cake. | „То је торба.“ | Besmisleno (samo `srp_Cyrl`, zato se ta ruta ne koristi) | То је мачји кашаљ. |

Za hrvatsku rutu to je otprilike **10 od 100** stavki sa kandidatom za kritičnu grešku, od čega su skoro sve sleng i idiomi. **Kriterijum „nema kritičnih grešaka u ključnim testovima“ NIJE ispunjen.**

### Ostali uočeni obrasci
- **Rod govornika:** bez konteksta model bira ženski rod („Tako si mi nedostajala“, „Ispričala sam“, „volela bih“). Ovo nije greška modela nego nedostatak informacije, i rešava se kontekstom i ručnom proverom.
- **Brojevi:** „ten years“ → „10 godina“. Za titlove je to prihvatljivo, ali odstupa od uobičajenog stila (brojevi do 10 slovima).
- **Dužina:** model često skraćuje, što je za titlove dobro (npr. „Sure, because that worked so well last time“ → „Naravno, jer je to prošlo tako dobro“), ali ponekad izgubi deo smisla („last time“).
- **Izvor koji nije engleski** (test u browseru: „Đorđe: Šta ćeš? Љубав!“) daje halucinaciju („Шташ? Жвакови!“). Aplikacija treba da upozori da izvor nije engleski (planirano).

## 7. Regionalni profili

| Profil | Ruta | Šta model daje | Šta radi lokalizacija | Ocena (preliminarno) |
|---|---|---|---|---|
| Croatian | `>>hrv<<` | Dosledan hrvatski standard (kruh, vlak, tjedan, što, tko), ijekavica, futur „nazvat ću“ | 0 predloga na 100 izlaza | Najstabilniji profil |
| Serbian Latin | `>>srp_Latn<<` + mojibake popravka | Ekavica, srpska leksika (hleb, voz, nedelja), „da“ konstrukcije, futur „zvaću“ | 1 predlog (grah → pasulj, ispravan) | Dobar posle popravke |
| Serbian Cyrillic | isto + transliteracija | Kao Serbian Latin; native `srp_Cyrl` token je testiran i odbačen (68,3 chrF, halucinacije „торба“, „Од.“, „Шта?“) | Transliteracija je deterministička | Dobar |
| Bosnian | `>>bos_Latn<<` | Uglavnom ijekavica i bosanska leksika (voz, šta, ko), ali **ekavski oblici u 5 stavki** (hleb, mleko, nedelje, cela, poslednji) i srpski futur („Zvaću“, „Objasniću“) | Jat i termbase predlozi to hvataju (hleb → hljeb, mleko → mlijeko…) | Upotrebljiv uz obavezan pregled |
| ExYu Neutral (ijekavski) | `>>bos_Latn<<` | Isto kao bosanski | Jat predlozi; većinski oblici | **Nevalidirano.** Ruta `hrv` + lokalizacija je u granicama šuma (69,8 prema 69,3) |
| — | `>>hbs<<` | „[4]“, „1.).“ (neupotrebljivo; vidi se i na model card-u) | — | Nikad se ne koristi |

**Direktan prevod sr ↔ hr ↔ bs:** model to ne podržava (izvor je samo engleski).

### Šta se pouzdano može primeniti automatski (kao predlog za odobrenje)
- Jat za poznate reči sa liste (hleb ↔ hljeb, mleko ↔ mlijeko, gde ↔ gdje…), uz potvrdu korisnika.
- Leksički parovi bez drugog značenja, u svim padežnim oblicima (voz ↔ vlak, hiljada ↔ tisuća, pozorište ↔ kazalište).
- Popravka mojibake-a (bez rizika).
- Transliteracija latinica ↔ ćirilica.

### Šta zahteva kontekst (samo predlog, „review“)
- nedelja (sedmica / dan), ko (= „kao“ u razgovoru), promet (saobraćaj / prodaja), otok / ostrvo u BiH, porodica / familija, reči napisane velikim slovom usred rečenice (moguće ime).

### Šta se nikad ne menja automatski
- Futur (zvaću ↔ zvat ću): pravilo bi pogađalo „kuću“, „sreću“, „veću“; potreban je leksikon glagola.
- „da“ + prezent ↔ infinitiv (moram da idem ↔ moram ići): samo savet za hrvatski.
- Rod govornika, registar (ti/Vi), vlastita imena, nazivi mesta i institucija.
- Ručno uređeni, zaključani i odobreni segmenti (engine ih ne dira; pokriveno testovima).

## 8. Šta se može popraviti i kako

| Problem | Lokalizacija | Terminologija | Kontekst | Bolji model | Čovek |
|---|---|---|---|---|---|
| Mojibake, pismo, jat (poznate reči) | ✔ | | | | |
| Regionalna leksika (voz/vlak…) | ✔ | ✔ | | | |
| Terminologija projekta (imena, žargon) | | ✔ | | | |
| Rod govornika, ti/Vi | | | ✔ | ✔ | ✔ |
| Idiomi i sleng | | delimično (fraze) | | ✔ | ✔ |
| Sarkazam, ironija, dvosmislenost | | | ✔ | ✔ | ✔ |
| Halucinacije, obrnuto značenje | | | | ✔ | ✔ |

## 9. Kriterijumi prihvatanja — trenutno stanje

| Oblast | Kriterijum | Stanje |
|---|---|---|
| Pokretanje | Stvarna lokalna inference operacija | ✅ Node + browser |
| Privatnost | Nema slanja teksta na cloud | ✅ `allowRemoteModels=false`; mreža se koristi samo za lokalni `/models/` |
| Stabilnost | 100/100 ili evidentirane greške | ✅ 400/400 (run 2), 400/400 (run 1) |
| Ponavljanje | Isti benchmark se može ponovo izvršiti | ✅ fiksirane revizije, SHA-256, verzionisan dataset; determinističan izlaz (test) |
| Značenje | Nema kritičnih grešaka u ključnim testovima | ❌ ~10 kandidata (preliminarno) |
| Kvalitet ≥ 4/5 | Ljudska ocena | ⏳ **Not evaluated** |
| Prirodnost ≥ 4/5 | Ljudska ocena | ⏳ **Not evaluated** |
| Regionalna podrška | Svaki profil posebno | ◐ automatski i preliminarno; bez ljudske ocene |
| Performanse | Izmerene na konkretnoj mašini | ✅ (mašina ispod minimalnih 8 GB iz specifikacije projekta) |
| Licenca | Prihvatljiva za distribuciju | ⏳ **Pending legal review** (`docs/MODEL_LICENSE_REVIEW.md`) |
| Testovi | Postojeći i novi prolaze | ✅ |
| Build | Produkcijski build prolazi | ✅ |

**Dodeljen status: `Experimental`.** Za `Beta` je potrebno: ljudska ocena ≥ 4/5 za bar jedan profil, nijedna kritična greška u ključnim kategorijama posle korekcija, sopstvena (zvanična) ONNX konverzija i pravna provera.

## 10. Kako dovršiti ljudsku evaluaciju

1. Otvoriti `benchmark/results/2026-11-10T20-05-28-674Z-opus-q8-b4/eval-<profil>.csv` u Excel-u.
2. Za svaku stavku popuniti ocene 1–5: accuracy, naturalness, grammar, tone, slang_idioms, subtitle_suitability, regional_naturalness, kao i `critical_error_yes_no` i napomene.
3. Svaki profil ocenjuje **izvorni govornik te varijante**; za ExYu Neutral najbolje po jedan ocenjivač iz svake zemlje.
4. Sačuvati popunjen fajl pod novim imenom (`eval-…-rater-<inicijali>.csv`), bez prepisivanja originala.

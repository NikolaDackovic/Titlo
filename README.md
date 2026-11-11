# Titlo

**Subtitle & Localization Studio** · *Your words. Every language. Perfectly timed.*

Titlo (ranije „ExYu Titl Studio“) je lokalni alat za titlove filmova, serija, podkasta i YouTube videa: pretvaranje govora u titlove (Whisper), prevod sa engleskog, regionalna lokalizacija i kontrola kvaliteta za srpski (latinica i ćirilica), hrvatski, bosanski i ExYu Neutral. Interfejs je na srpskom (latinica), uz izbor engleskog.

- **Privatnost:** projekti, titlovi i mediji ostaju na računaru. Nema cloud API-ja, naloga ni telemetrije.
- **Kontrola:** nijedna sumnjiva Whisper transkripcija ne postaje titl neprimetno. Upozorenja objašnjavaju šta je izmereno, ništa se ne briše automatski, a ručne izmene se ne prepisuju bez potvrde ([docs/TRANSCRIPTION_QUALITY_CONTROL.md](docs/TRANSCRIPTION_QUALITY_CONTROL.md)).
- **Iskrenost:** test provider je jasno označen, a nedostajući model se prijavljuje kao nedostajući. Ne prikazuju se lažni rezultati, lažni player ni izmišljena statistika.

## Pokretanje

Potrebno: Node.js 20+ (testirano na 22.19), Windows 10/11, Microsoft Edge ili Chrome.

```bash
npm install
npm run dev          # http://localhost:5173
```

Produkcijski build i lokalno pokretanje builda:

```bash
npm run build        # tsc -b && vite build → dist/
npm run preview      # http://localhost:4173 (servira i lokalni models/ folder)
```

Ostale komande:

```bash
npm test                  # 242 testa (unit + integration + pokrivenost srpskog prevoda UI-ja + performanse sa 2.000 titlova)
npm run test:unit         # brzi unit testovi
npm run test:integration  # SQLite perzistencija
npm run lint              # oxlint

npm run model:install          # jednom: lokalni prevodilački model (~400 MB, provera SHA-256, bez Pythona)
npm run model:install:whisper  # jednom: modeli za govor → tekst (whisper-small ~250 MB, whisper-base ~77 MB)
npm run model:install:sh-en    # jednom: srpski/hrvatski/bosanski → engleski (~366 MB)
npm run model:smoke:sh-en      # dokaz stvarnog prevoda sr → en
npm run model:smoke       # dokaz stvarne lokalne inference operacije
npm run test:model        # testovi sa stvarnim modelom
npm run benchmark         # 100 rečenica × 4 jezička tokena → benchmark/results/
```

Aplikacija radi i bez modela: uvoz, uređivanje, lokalizacija, QC, transliteracija i izvoz rade odmah. Za transkripciju: `npm run model:install:whisper`. Za mašinski prevod: `npm run model:install`, zatim u aplikaciji **Modeli → Učitaj model sada** ([docs/MODELS.md](docs/MODELS.md)).

## Workflow

1. **Početna → Video ili podkast → titlovi.** Izaberite video/audio (MP4, MKV, MOV, WEBM, MP3, WAV, M4A, OGG, AAC, FLAC) i jezik govora. Posle „Napravi i transkribuj“ Studio automatski pokreće lokalni Whisper; titlovi dobijaju vremena i dele se na najviše 2 reda × 42 znaka.
   Ili **Imam fajl sa titlovima:** SRT, VTT ili ASS. Kodiranje se prepoznaje (UTF-8, UTF-16, Windows-1250, Windows-1251). Sve što nije uvezeno navodi se sa brojem reda.
2. Izbor jezika izvora, ciljnog profila (ExYu Neutral, srpski latinica/ćirilica, hrvatski, bosanski) i, za Neutral, jata (ijekavica/ekavica).
3. **Studio:** lista titlova, video sa titlom preko slike, talasni oblik na vremenskoj liniji, editor, kontrola kvaliteta.
   **Pregled transkripcije:** svaki original ima status (nepregledano, proveriti original, provereno, izmenili ste, original odobren), odvojen od statusa prevoda. Kvalitet → Transkripcija prikazuje sumnjive delove (tekst na tišini, ponavljanje, malo zvuka, govor bez titla); klik vodi na segment, ▶ pušta ga uz 1,5 s pre i posle, ✓ ga označava kao proveren.
4. **Prevod:** ako original nije pregledan, prvo se pita (sve / samo provereni i odobreni / nastavi / nazad na pregled). Kad se original promeni posle prevoda, prevod se čuva i označava kao **zastareo**. Ručno izmenjen prevod se nikad ne zamenjuje bez potvrde. Engleski izvor se prevodi na srpski/hrvatski/bosanski, a srpski/hrvatski/bosanski izvor na **engleski** (izaberite profil „Engleski“). Engleski izvor se prevodi modelom (ceo projekat ili izabrani titlovi; pauza, nastavak, otkazivanje, ponovni pokušaj). Srpski/hrvatski/bosanski izvor se **prilagođava**: original se kopira u ciljni profil kao polazna tačka (označeno „Za pregled“), a predlozi dolaze u sledećem koraku.
5. **Regionalni predlozi:** predlozi regionalnih izmena (npr. `vozom → vlakom`, `hleb → kruh`, jat, hrvatska sintaksa). Ništa se ne menja bez odobrenja.
6. **Alati:** generisanje srpske ćirilice iz latinice, kopiranje izvora za adaptaciju (sr→hr/bs), pomeranje timinga.
7. **Kontrola kvaliteta:** greške, upozorenja i predlozi, uz filter i skok na segment.
8. **Izvoz (Ctrl+E):** SRT, VTT, ASS, TXT; prevod, original ili dvojezično; jedan ili svi profili; CRLF/LF; UTF-8 sa BOM-om ili bez njega.

Prečice su navedene u Podešavanja → Prečice na tastaturi (Ctrl+S, Ctrl+Z/Y, Ctrl+F, Alt+↑/↓, Ctrl+Enter, Ctrl+L, Ctrl+Shift+S, Ctrl+M, Ctrl+Space, Ctrl+E).

## Status funkcija

| Oblast | Status | Napomena |
|---|---|---|
| SRT/VTT/ASS import, parsing, validacija | **Implemented** | Višelinijski tekst, tagovi, BOM, CRLF, legacy encoding; ASS stilovi i VTT podešavanja se čuvaju. Testirano. |
| Export SRT/VTT/ASS/TXT, dvojezični, svi profili | **Implemented** | Validacija timinga, UTF-8 (+BOM), konverzija tagova SRT↔ASS. Testirano (unit + E2E). |
| TTML/IMSC export | Planned | Registar formata je spreman (`EXPORT_FORMATS`). |
| Studio kao video editor (gornja traka, levi paneli, pregled, inspektor, vremenska linija sa trakama Titlovi/Zvuk/Video, pomeranje i menjanje dužine titlova prevlačenjem, zum/uklopi, podesiva visina) | **Implemented** | Testirano u E2E (Edge) na 6 rezolucija i sa 2.000 titlova (vremenska linija crta samo vidljive titlove). |
| Video preview | **Implemented** (browser) | HTML5 playback, sinhronizacija i overlay. MKV/HEVC zavise od podrške browsera; posle restarta fajl se ponovo bira. |
| TranslationProvider arhitektura, batch, kontekst, keš, retry, cancel/pause/resume, statusi | **Implemented** | Testirano sa mock providerima. |
| OPUS-MT lokalni prevod (en→hr/sr/bs) | **Implemented — Experimental** (Requires external model) | Stvarni model radi lokalno (Node: 400/400 benchmark prevoda; browser: pravi prevod kroz UI). Kvalitet: **Not evaluated** (ljudska ocena nije urađena); preliminarno slab na slengu i idiomima. Instalacija: `npm run model:install`. Vidi `docs/TRANSLATION_QUALITY_REPORT.md`. |
| Prevod srpski/hrvatski/bosanski → engleski (`opus-mt-tc-big-sh-en`) | **Implemented — Experimental** (Requires external model) | Stvarni lokalni prevod, proveren u Node-u i u browseru (vidi `docs/MODELS.md`). Kvalitet nije ocenjen od strane ljudi. |
| Lokalni LLM (llama.cpp/Ollama/LM Studio) | **Partially implemented** | Protokol i validacija testirani sa mock serverom; kvalitet za sr/bs nije dokumentovan ni izmeren. |
| TEST provider | Samo za razvoj/testove | Više se ne nudi u aplikaciji. Sačuvan izbor se automatski prebacuje na OPUS-MT, a stari `[TEST]` izlaz se uvek ponovo prevodi. |
| Cloud provider | Planned (onemogućen) | `FutureCloudTranslationProvider` je uvek nedostupan. |
| Lokalizacija: profili, termbase (52 koncepta sa padežnim oblicima), jat, HR sintaksa, izuzeci, konflikti | **Implemented** | Termbase je početni skup i treba ga pregledati izvorni govornik. |
| Transliteracija latinica ⇄ ćirilica | **Implemented** | lj/nj/dž, velika slova, izuzeci (nadživeti, injekcija…), zaštita markupa, URL-ova i stranih reči. Testirano. |
| Terminologija (ranije „Glosar“): liste termina, preporučeni i alternativni prevodi, kategorija, kontekst, napomena, CRUD, CSV/JSON, prioritet, dodela projektu, konflikti | **Implemented** | CSV sa `,` ili `;` (Excel). QC razlikuje preporučeni prevod, prihvatljivu alternativu i nedoslednu upotrebu. Mašinski prevod koji preskoči preporučeni termin dobija status „Za pregled“ (OPUS-MT ne može da primi termine). |
| Whisper kontrola kvaliteta (tišina/audio aktivnost, halucinacije, ponavljanje, neobični segmenti, govor bez titla) | **Implemented** | Heuristike, ne pouzdanost modela; bez procenata. Pragovi provereni na sintetičkim signalima i Windows TTS snimcima, ne na ljudskom govoru. Ništa se ne briše automatski. |
| Statusi originala (unreviewed / needs-review / verified / manually-edited / approved), zastareli prevodi, zaštita ručnog rada pri novoj transkripciji | **Implemented** | Migracija baze v2 samo dodaje kolone; stari projekti se otvaraju normalno. Testirano (migracija v1 → v2 sa podacima). |
| QC (timing, CPS/WPM, redovi, overlap, interpunkcija, pismo, jat, terminologija, formatiranje, profili) | **Implemented** | Ne menja tekst. Pragovi su konvencije, ne zvanični standard. |
| SQLite, migracije, repozitorijumi, autosave, backup, recovery, migracija iz localStorage | **Implemented** | sql.js + IndexedDB (browser). Testirano, uključujući reload i oporavak od oštećenja. |
| Tauri 2 desktop (native dijalozi, fajl baze na disku, Windows installer) | **Blocked** ovde / Planned | Nema Rust toolchain-a za proveru; plan je u `docs/ARCHITECTURE.md`. |
| Transkripcija govora (Whisper, lokalno u browseru) | **Implemented — Experimental** (Requires external model) | Web Audio dekodiranje → mono 16 kHz → blokovi ~90 s sečeni na tišini → Whisper u Web Worker-u (WASM) → titlovi sa vremenima, ćirilica → latinica za sr/hr/bs. Sumnjivi redovi se više ne brišu tiho, već se označavaju za pregled. Otkazivanje odmah prekida worker. Ograničenje browser verzije: fajl do 700 MB i kodek koji browser ume da dekodira. Tačnost je merena samo na sintetičkom engleskom (vidi `docs/ASR_MODEL_COMPARISON.md`); za sr/hr/bs WER još nema (nema snimaka sa referencom). |
| Automatsko prepoznavanje jezika govora | **Implemented** | Prava detekcija (Whisper jezički tokeni + no-speech), grupa sr/hr/bs, ručni izbor kad nije pouzdano. Provereno na 27 uzoraka × 2 modela (engleski, tišina, šum, muzika, vaši videi). Hrvatski i bosanski govor nisu testirani (nema snimaka). |
| Speech benchmark (WER/CER strogo i normalizovano, RTF, RAM, CPU, detekcija) | **Implemented** | Radi u istom runtime-u kao aplikacija. Dataset v1: 49 sintetičkih engleskih uzoraka (Windows TTS). Vidi `benchmark/speech/README.md`. |
| FFmpeg + whisper.cpp (desktop, dugi filmovi, svi kodeci) | Planned (Faza G) | Interfejsi `MediaProcessor`/`TranscriptionEngine` su spremni. |
| Benchmark v2 (100 rečenica, 10×10 kategorija, stvarni model, latencija p50/p95, RAM/CPU, chrF, obrasci za ljudsku ocenu) | **Implemented** | Pokrenut na stvarnom modelu (`benchmark/results/`). Reference su nacrti; ljudska ocena nije urađena. |
| Interfejs na srpskom (latinica) + engleski | **Implemented** | Podrazumevano srpski; SR/EN prekidač u bočnoj traci i u Podešavanjima. Prevedene su i QC poruke, napomene pri uvozu, razlozi lokalizacije i poruke modela. Test proverava da svaki tekst ima srpski prevod i iste `{promenljive}`. Hrvatski/bosanski UI: Planned. |
| Responsive dizajn | **Implemented** | Bočna traka se skuplja na tabletu, Studio prelazi u jednu kolonu na telefonu. |

## Struktura projekta

```
src/
  app/            bootstrap, servisi (DI), podešavanja, ErrorBoundary, App shell
  domain/         tipovi, jezici i profili, timecode
  formats/        srt.ts, vtt.ts, ass.ts, encoding.ts, markup.ts, exporter.ts
  localization/   transliterate.ts, termbase.ts, yat.ts, matching.ts, engine.ts
  glossary/       Terminologija: types.ts, io.ts (CSV/JSON), rules.ts (pravila, konflikti); interno ime ostaje "glossary"
  qc/             profiles.ts, checks/{timing,readability,language,terminology,formatting}.ts
  translation/    types.ts, engine.ts, registry.ts, modelRegistry.ts, providers/{opusMt,marian.worker,workerRuntime,localLlm,testProvider,futureCloud}.ts
  persistence/    database.ts, migrations.ts, snapshotStore.ts, legacy.ts, seed.ts, repositories/
  state/          segmentOps.ts, history.ts, useProjectEditor.ts, useTranslationJob.ts, useTranscription.ts
  media/          audio.ts (dekodiranje, talasni oblik), transcription.ts (blokovi, segmentacija), whisper.worker.ts, browserWhisper.ts
  i18n/           index.ts (t, useT, setLocale), sr.ts (srpski prevodi)
  platform/       otvaranje/čuvanje fajlova
  benchmark/      sentences.ts (dataset v1), chrf.ts
  ui/             dashboard/, studio/ (+dock/), glossary/, models/, settings/, components/
  styles/         base, components, layout, studio
scripts/                install-model.ts, install-whisper.ts, model-smoke.ts, lib/{nodeMarian,hfFiles}.ts, run-benchmark-v1.ts
benchmark/              datasets/ (v2), scripts/run-benchmark.ts, results/, README.md
tests/model/            testovi sa stvarnim modelom · tests/e2e/ browser testovi (ručno)
build/modelsPlugin.ts   servira lokalne modele na /models/ (zaštita od path traversal-a)
build/modelsDir.ts      lokacija modela (EXYU_MODELS_DIR → %LOCALAPPDATA%\ExYuTitlStudio\models → ./models; tehnički nazivi su zadržani radi kompatibilnosti)
docs/                   ARCHITECTURE, MODELS, MODEL_LICENSE_REVIEW, TRANSLATION_QUALITY_REPORT
```

## Lokalni modeli — ukratko

- **Prevod:** `Helsinki-NLP/opus-mt-tc-base-en-sh` (CC-BY-4.0, 74 M parametara, 398 MB na disku), status **Experimental**. Radi potpuno lokalno preko Transformers.js / ONNX Runtime (u aplikaciji: WASM u Web Worker-u). Izmereno na Ryzen 3 3200U sa 3,4 GB RAM-a: ~190 ms po titlu u Node-u, 1–3 s u browseru; učitavanje 6–12 s (Node) i 44–60 s (browser). ONNX fajlovi su konverzija trećeg lica, pa pre komercijalne distribucije treba uraditi sopstvenu konverziju i pravnu proveru (`docs/MODEL_LICENSE_REVIEW.md`).
- **NLLB-200 je isključen** (CC-BY-NC, nekomercijalna licenca). Gemma ima posebnu licencu. Za EuroLLM, Qwen i MADLAD podrška za srpski i bosanski nije potvrđena na model card-ovima.
- **Govor → tekst:** `onnx-community/whisper-small` (podrazumevano, bolji za srpski/hrvatski/bosanski) ili `whisper-base` (brži), q8 kvantizacija, status **Experimental**. Originalne Whisper težine (OpenAI) su pod MIT licencom; ONNX konverzije su delo trećeg lica (`docs/MODEL_LICENSE_REVIEW.md`).
- Detalji, tabela licenci i uputstvo za instalaciju: [docs/MODELS.md](docs/MODELS.md).

## Poznata ograničenja

- Kvalitet mašinskog prevoda nije ocenjen od strane ljudi. Preliminarno: sleng i idiomi se često prevode pogrešno (oko 10/100 kandidata za kritičnu grešku), a bosanski izlaz povremeno meša ekavicu. Prevod je nacrt koji se obavezno pregleda.
- Model ne vidi susedne replike, pa bez konteksta pogađa rod govornika.
- OPUS-MT prevodi samo sa engleskog i ne koristi kontekst susednih replika. Za sr↔hr↔bs nema potvrđenog besplatnog lokalnog modela; koristi se lokalizacioni engine uz ručnu reviziju.
- ExYu Neutral je heuristika (bosanski token za ijekavicu i srpski za ekavicu, plus „većinski“ oblici iz termbase-a). Benchmark ne razlikuje ovu rutu od alternative (razlika je u granicama šuma), pa je potrebna ljudska ocena.
- Browser verzija: baza je u IndexedDB (lokalno, po browser profilu). Ne radi u privatnom režimu. Brisanje podataka sajta briše i projekte, pa redovno koristi Settings → Download database file. Desktop (Tauri) verzija će bazu čuvati kao fajl.
- Pristup video fajlu ne može da se zadrži posle restarta (bezbednosno ograničenje browsera).
- Transkripcija u browseru radi na procesoru: na slabijem laptopu traje otprilike 2–4× dužine snimka (whisper-small; izmereno: 89 s snimka za 326 s na Ryzen 3 3200U). Ceo zvuk se dekodira u memoriju, pa su dugi filmovi (preko 700 MB) za desktop verziju. Imena, sleng i preklapanje govornika treba ručno proveriti.
- OPUS-MT prevodi samo sa engleskog. Za snimak na srpskom aplikacija ne „prevodi“ nego prilagođava tekst ciljnoj varijanti preko regionalnih predloga.
- Jedan prozor u isto vreme (drugi prozor se namerno blokira).
- Termbase i referentni prevodi u benchmarku su nacrti i treba ih pregledati izvorni govornici.

## Licence i navođenje autora

OPUS-MT modeli © Language Technology Research Group, University of Helsinki, CC-BY-4.0. Whisper © OpenAI, MIT. Transformers.js (Apache-2.0), ONNX Runtime (MIT), sql.js (MIT), SQLite (public domain), React (MIT), Vite (MIT), Framer Motion (MIT), Lucide (ISC). Aplikacija ne zaobilazi DRM i ne preuzima sadržaj sa streaming servisa: radi samo sa lokalnim fajlovima za koje korisnik ima prava.

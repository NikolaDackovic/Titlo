# Arhitektura (Titlo)

Proizvod se zove **Titlo** (ranije „ExYu Titl Studio“). Interni identifikatori su namerno zadržani radi kompatibilnosti sa postojećim podacima i instaliranim modelima: IndexedDB baza `exyu-titl-studio`, ključevi u localStorage (`exyu-titl-studio-projects`, `exyu.timelineHeight`), Web Lock `exyu-titl-studio-database`, ID profila `exyu-neutral`, promenljiva `EXYU_MODELS_DIR` i folder `%LOCALAPPDATA%\ExYuTitlStudio\models`, ime npm paketa. Funkcija „Glosar“ se u interfejsu zove **Terminologija**; kod i tabele i dalje koriste `glossary`.

## Slojevi

```
UI (React)            src/ui/**           — prikaz i interakcija, bez poslovne logike
Stanje / hookovi      src/state/**        — undo/redo, autosave, posao prevođenja, čiste operacije nad segmentima
Servisi aplikacije    src/app/**          — bootstrap, DI kontejner (Services), podešavanja, error boundary
Domen                 src/domain/**       — tipovi, jezici/profili, timecode
Formati               src/formats/**      — SRT/VTT/ASS parseri i serializeri, encoding, markup, exporter
Lokalizacija          src/localization/** — transliteracija, termbase, jat, engine predloga
Terminologija         src/glossary/**     — tipovi, CSV/JSON, pravila, konflikti (interno ime: glossary)
QC                    src/qc/**           — profili + nezavisne provere (transcription, timing, readability, language, terminology, formatting)
Prevod                src/translation/**  — TranslationProvider interfejs, engine (job), provideri, keš, registar modela
Perzistencija         src/persistence/**  — SQLite (sql.js), migracije, repozitorijumi, snapshot store, backup, legacy migracija
Platforma             src/platform/**     — otvaranje/čuvanje fajlova (browser sada, Tauri kasnije)
Media                 src/media/**        — dekodiranje zvuka, audio aktivnost (RMS/ZCR), Whisper transkripcija (browser), interfejsi za FFmpeg/whisper.cpp (Faza G)
i18n                  src/i18n/**         — t()/useT(), srpski prevodi (ključ = engleski tekst)
```

Pravila: komponente pozivaju hookove i servise. Logika je u čistim funkcijama koje se testiraju bez React-a. Nijedan modul ispod `ui/` ne zavisi od React-a, osim `state/use*`.

## Ključne odluke

**SQLite preko sql.js (WebAssembly), a ne Tauri plugin.** Tauri nije bio prisutan, a na mašini nema Rust toolchain-a, pa Tauri build ne može da se proveri. sql.js daje pravi SQLite (isti SQL, migracije, transakcije) već sada. Ceo `.sqlite` fajl se atomski snima u IndexedDB (debounce 600 ms, plus odmah pri `pagehide`/skrivanju prozora). U desktop verziji `SnapshotStore` dobija implementaciju koja piše fajl u app-data folder. SQL, migracije i repozitorijumi ostaju isti.

**Šema** (`persistence/migrations.ts`): projects, media_files, subtitle_tracks, subtitle_segments, **segment_translations**, glossaries, glossary_terms, project_glossaries, processing_jobs, translation_cache, application_settings, app_logs, schema_migrations.
Migracija **v2** samo dodaje kolone (`subtitle_segments.source_status`, `source_origin`; `segment_translations.source_snapshot`; `glossary_terms.alternatives`, `category`). Postojeći redovi, ID-jevi i tekstovi se ne menjaju; segmenti projekata bez uvezenog fajla, a sa završenim poslom transkripcije, dobijaju `source_origin = 'whisper'`. Detalji: `docs/TRANSCRIPTION_QUALITY_CONTROL.md`.
Odstupanje od predloga: `translated_text`/`is_locked`/`translation_status` nisu kolone u `subtitle_segments`, nego u `segment_translations` (jedan red po segmentu i jezičkom profilu, vezan za `subtitle_tracks` tipa `translation`). Tako jedan projekat drži sve varijante (Neutral, SR lat/ćir, HR, BS) sa zajedničkim vremenskim oznakama, a „Export all variants“ je stvaran.

**Pouzdanost podataka.**
- Transakcije sa SAVEPOINT-ima, pa nema delimičnih upisa.
- `PRAGMA integrity_check` pri otvaranju. Oštećen fajl se čuva kao backup, a učitava se najnoviji ispravan backup.
- Do 12 backup-ova: dnevni, pre brisanja projekta, pre migracije, pre restore-a. Moguć je ručni download/restore `.sqlite` fajla.
- Web Locks API sprečava da dva prozora istovremeno pišu u bazu.
- Poslovi koji su ostali „running“ posle gašenja aplikacije označavaju se kao „interrupted“. Već prevedeni segmenti su snimljeni, a ponovno pokretanje nastavlja od neprevedenih.
- Migracija iz v0.1 localStorage: prvo backup, originalni podaci se **ne brišu**, nepromenjen demo projekat se preskače, a stari „prevodi“ (koje je pravio test provider zamenom reči) uvoze se kao *Needs review* sa poreklom `test`.

**Prevod (translation/engine.ts).**
- Svaki segment je zaseban element sa sopstvenim `id`-jem. Provider mora da vrati tačno te id-jeve, inače se batch odbacuje i segmenti se prevode pojedinačno. Zato prevod jednog segmenta ne može da obriše ili spoji drugi, a vremenske oznake se nikad ne menjaju.
- Kontekst: susedni segmenti (podesivo 0–4) idu kao *read-only* kontekst providerima koji ga podržavaju.
- Batch po broju segmenata i karakterima, retry sa eksponencijalnim čekanjem, pa izolacija segmenta koji pada. Postoje pause, resume (između batch-eva) i cancel (završeni batch-evi ostaju).
- Keš (SQLite `translation_cache`) po provideru, modelu, profilu, jatu, kontekstu i tekstu. TEST izlaz se ne kešira.
- Preskaču se zaključani, odobreni i ručno menjani segmenti, osim na eksplicitan zahtev („Also overwrite my manual edits“). Ako korisnik izmeni segment dok posao traje, rezultat posla se odbacuje za taj segment.
- Markup (`<i>`, `{\an8}`) se skida pre slanja modelu i vraća posle. Ako je bio usred teksta, segment ide na *Needs review*.
- Statusi: Not translated, Translated, Needs review, Approved, Failed, plus Locked (zastavica). Poreklo teksta: manual, machine, test, transliteration.
- Svaki prevod pamti original od kog je nastao (`sourceText`). Kad se original kasnije promeni, prevod je **zastareo** (izvedeno, bez posebnog statusa): tekst prevoda ostaje, a UI nudi ponovni prevod (ručni prevod tek posle potvrde).
- Pre pokretanja prevoda Studio proverava status originala (`needsSourceReview`) i nudi izbor; ništa se ne blokira (`TranslationGate.tsx`).
- Terminologija: OPUS-MT ne prima termine, pa se mašinski prevod koji preskoči preporučeni termin označava *Needs review* (`missedTerms`); tekst se ne menja.

**Lokalizacija.** Engine nikad ne menja tekst sam. Vraća predloge (pozicija, original, zamena, razlog, high/review), a korisnik ih prihvata pojedinačno ili „sve high-confidence“. Primena ide kroz undo istoriju. Izvori predloga, po prioritetu: glossary pravila > termbase (poravnati padežni oblici, usmerena pravila, dvosmislenosti) > sintaksa (HR: „moram da idem“ → savet, bez automatske zamene) > jat (samo detekcija + poznati parovi). Markup i URL-ovi se nikad ne diraju.

**QC.** Čiste funkcije bez sporednih efekata, sa podesivim profilima (Standard, Online, Conservative). Pragovi su uobičajene konvencije, ne zvanični standard. Kategorija **Transkripcija** (`qc/checks/transcript.ts`) proverava Whisper original uz audio aktivnost (`media/audioActivity.ts`): tekst na tišini, ponavljanje, malo zvuka, neobični segmenti, govor bez titla. Opis: `docs/TRANSCRIPTION_QUALITY_CONTROL.md`.

## Lokalni prevodilački model (faza 3)

Tok jednog titla kroz `OpusMtProvider` (`src/translation/providers/opusMt.ts`):

```
segment.source
  → engine: skida markup (<i>, {\an8}), daje čist tekst
  → splitForModel: replike dijaloga („- A\n- B“) i rečenice → delovi
  → za svaki deo, posebno: runtime.translate(">>token<< deo")       (jedan ulaz po pozivu)
  → repairMojibake (æ→ć, è→č, ð→đ)
  → spajanje (crtice dijaloga vraćene, lažne crtice uklonjene)
  → engine: prelom na 2 reda, ćirilica (deterministička transliteracija), vraćanje markupa
  → SegmentUpdate (editor odbacuje ako je segment u međuvremenu zaključan ili ručno menjan)
```

- **Runtime iza interfejsa `MarianRuntime`:** browser = `WorkerMarianRuntime` (Web Worker, onnxruntime-web WASM); Node = `scripts/lib/nodeMarian.ts` (onnxruntime-node). Smoke test, test sa modelom i benchmark koriste isti provider kao aplikacija.
- **Zamena modela:** model id i dtype dolaze iz podešavanja. Novi Marian model traži samo instalaciju u isti raspored fajlova (`config.json`, `generation_config.json`, `tokenizer.json`, `onnx/encoder_model[_quantized].onnx`, `onnx/decoder_model_merged[_quantized].onnx`). Rute tokena su u `opusTargetToken()`.
- **Lokacija modela:** `build/modelsDir.ts` → `EXYU_MODELS_DIR`, zatim `%LOCALAPPDATA%\ExYuTitlStudio\models`, zatim `./models`. Dev i preview server ih servira na `/models/` (zaštita od path traversal-a). Model se ne pakuje u build.
- **Status modela** (`src/services/modelStatus.ts`): *not-installed / available / loading / ready / error*, isključivo iz stvarnih događaja (provera fajlova, poruke worker-a). Prikaz je na stranici Models (dugme „Load model now“) i u Translation panelu.
- **Privatnost:** `env.allowRemoteModels = false`, `local_files_only: true`. Jedini mrežni zahtevi idu ka lokalnom `/models/`.

### Testovi

| Komanda | Šta pokriva | Model |
|---|---|---|
| `npm test` | sve ispod osim modela (122 testa) | mock |
| `npm run test:unit` | brzi unit testovi (bez `*.integration.test.ts`) | mock |
| `npm run test:integration` | SQLite perzistencija i migracije | — |
| `npm run test:model` | stvarna inference operacija, determinizam, tokeni, rečenice, mojibake, job + izvoz | **stvarni** (preskače se uz poruku ako nije instaliran) |
| `npm run model:smoke` | brz dokaz rada + JSON u `benchmark/results/` | **stvarni** |
| `npm run benchmark` | 100 rečenica × 4 tokena, metrike, obrasci za ljudsku ocenu | **stvarni** |
| `tests/e2e/*.e2e.mjs` | UI u Edge-u (ručno, vidi `tests/e2e/README.md`) | TEST i stvarni |

Mock runtime u unit testovima je eksplicitno označen (`MOCK(...)` izlaz) i nikad se ne koristi van testova.

## Desktop (Tauri 2) — plan

Status: **Planned / Blocked na ovoj mašini** (nema Rust toolchain-a, pa build ne može da se proveri; neprovereni Rust kod namerno nije dodat).

1. `npm create tauri-app` u postojećem projektu (`src-tauri/`), `beforeDevCommand: npm run dev`, `devUrl: http://localhost:5173`. Vite workflow ostaje nepromenjen.
2. Pluginovi: `tauri-plugin-dialog` (native open/save), `tauri-plugin-fs` (scope: app-data, models, korisnički izabrani folderi), `tauri-plugin-log`, `tauri-plugin-shell` (sidecar FFmpeg/whisper.cpp).
3. Implementacije koje se dodaju (interfejsi već postoje):
   - `SnapshotStore` → fajl `%APPDATA%/ExYuTitlStudio/projects.sqlite` (atomski: upis u `.tmp` + rename; folder zadržava staro tehničko ime).
   - `platform/files.ts` → dialog + fs plugin (pamti native putanju medija).
   - `ModelFileCheck` + serviranje `models/` preko asset protokola ili lokalnog Rust handlera.
   - `MediaProcessor` / `TranscriptionEngine` → Rust komande koje pokreću sidecar procese, sa progresom kroz event-e i otkazivanjem preko kill-a.
4. Windows build: `npm run tauri build` → MSI/NSIS. WebView2 je prisutan na Windows 10/11.

## FFmpeg + whisper.cpp (Faza G) — plan

Interfejsi: `src/media/types.ts`. Tok: FFmpeg sidecar (`-i in -vn -ac 1 -ar 16000 -f wav tmp.wav`), pa whisper.cpp sidecar (`-m ggml-<size>.bin -l auto|sr|hr|bs -ojf`, parsiranje progresa iz stderr-a), pa `TranscribedSegment[]`, pa postojeći tok (segmenti, prevod, lokalizacija, QC). Privremeni fajlovi idu u app temp folder i brišu se posle posla. GPU je opcion (CUDA/Vulkan build whisper.cpp), a CPU je podrazumevani. Modeli se preuzimaju tek na zahtev, uz prikazanu veličinu.

Browser verzija može da pusti video radi pregleda (HTML5). Nakon restarta mora ponovo da se izabere fajl, jer browser ne može da zadrži pristup lokalnom fajlu.

## Transkripcija u browser verziji (implementirano)

`BrowserWhisperEngine` (`src/media/browserWhisper.ts`) implementira `TranscriptionEngine`:

1. `decodeToMono16k` (`audio.ts`): Web Audio `decodeAudioData` u `AudioContext`-u od 16 kHz (browser resempluje pri dekodiranju) → mono. Limit 700 MB, jer se ceo zvuk drži u memoriji.
2. **Jezik.** Ako je izabrano „Prepoznaj automatski“, engine prvo radi detekciju (`languageDetection.ts` + poruka `detect` u workeru), jer Transformers.js 4.3 bez jezika **tiho uzima engleski**. Detekcija bira do 3 prozora od 30 s sa najviše zvuka, radi jedan korak dekodera posle `<|startoftranscript|>` i uzima softmax nad jezičkim tokenima, uz Whisperovu no-speech verovatnoću (`<|nocaptions|>`). Srpski, hrvatski i bosanski su jedna grupa: varijanta iz modela je samo nagoveštaj (za srpski govor Whisper najčešće kaže „hr“), pa se za transkripciju koristi jezik projekta ako je sr/hr/bs (izmereni uticaj tokena varijante na tekst je mali, vidi `docs/SPEECH_ACCURACY_REPORT.md`). Ako odluka nije pouzdana (tišina, šum/muzika, < 2 s govora, nepodržan jezik, verovatnoća < 60 %), transkripcija se ne pokreće (`LanguageNotDetected`), a korisnik bira jezik ručno.
3. `planBlocks` (`transcription.ts`): blokovi ~90 s, sečeni na najtišem mestu u poslednjih nekoliko sekundi, da reči ne budu presečene.
4. `whisper.worker.ts`: Transformers.js `automatic-speech-recognition` (q8, WASM), chunk 30 s, `return_timestamps`. Jedan blok po poruci; glavna nit je slobodna.
5. `chunksToSegments`: spaja/deli tekst na titlove (≤ 84 znaka, ≤ 7 s, ≥ 1 s), prelama na 42 znaka po redu, ćirilica → latinica za sr/hr/bs. **Ništa što je Whisper napisao se ne briše** (od ove verzije ni špica titlova ni ponovljeni redovi): QC ih označava, korisnik odlučuje.
6. Iz istih dekodiranih uzoraka računaju se talasni oblik i audio aktivnost (`analyzeActivity`, 20 ms okviri, ~2 bajta po okviru); uzorci se zatim oslobađaju.
7. `useTranscription` upisuje titlove kroz editor (jedan undo korak „transcription“) sa statusom `unreviewed` i poreklom `whisper`; segmenti sa QC upozorenjem dobijaju `needs-review`. Pri ponovnoj transkripciji korisnik bira „Zadrži moj rad“ (provereni, izmenjeni i odobreni originali ostaju, novi segmenti koji se vremenski preklapaju s njima se ne dodaju) ili „Zameni sve“. Talasni oblik i aktivnost idu u sesiju, jezik izvora se ažurira, a posao se beleži u `processing_jobs`.

Otkazivanje gasi worker odmah (ONNX Runtime ne može da prekine inferencu iznutra); model se učitava ponovo pri sledećem pokretanju.

Podešavanja runtime-a i dekodiranja su na jednom mestu (`src/media/whisperConfig.ts`); speech benchmark ih upisuje u svaki rezultat. Benchmark pokreće ovaj isti kod u headless Edge-u (`benchmark/speech/`).

## Jezik interfejsa

`src/i18n`: ključevi su engleski izvorni tekstovi, `t(key, vars)` menja `{ime}` promenljive. Srpski je podrazumevan (`settings.uiLanguage`). Ne-React moduli (QC, parseri, lokalizacija, provideri) zovu `t` u trenutku generisanja poruke; QC i regionalni predlozi se ponovo računaju kad se promeni jezik. Poruke iz worker-a (bez pristupa jeziku) prevode se u `modelStatus` po poznatim obrascima. `i18n/coverage.test.ts` skenira izvorni kod i podatke (profili, provideri, QC profili, termbase napomene) i pada ako neki tekst nema srpski prevod ili ako se `{promenljive}` razlikuju.

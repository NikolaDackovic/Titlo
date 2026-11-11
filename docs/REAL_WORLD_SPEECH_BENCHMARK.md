# Real-World Speech Benchmark (Titlo)

Merenje tačnosti Whisper transkripcije na **stvarnom ljudskom govoru** na srpskom, hrvatskom i bosanskom.

**Status: infrastruktura je spremna, benchmark još NIJE izvršen.** Dataset `real-world` je prazan, jer još
nije dodat nijedan snimak sa proverenim tekstom. Zato ovde nema nijednog rezultata za sr/hr/bs.
Infrastruktura je proverena na jednom sintetičkom TTS snimku u privremenom folderu, što nije rezultat
(vidi „Provera infrastrukture“).

## Sintetičko i stvarno: dve odvojene stvari

| | Sintetički (`asr-synthetic-en-v1`) | Stvarni (`real-world`) |
|---|---|---|
| Govor | Windows TTS (Zira, David), engleski | ljudi, srpski / hrvatski / bosanski |
| Referenca | tačna po konstrukciji (tekst → TTS) | otkucala ili proverila osoba (`--confirm-reference`) |
| Šta meri | da li cela cev radi; poređenje modela na lakom govoru | stvarnu tačnost za korisnike Titla |
| U izveštaju | tabela „Sintetički / ostali“, oznaka „(sint.)“ | tabele „Stvarni snimci“; polje `realWorld: true` |

Rezultati se nikad ne spajaju: izveštaj ih prikazuje u odvojenim tabelama.

## Šta se meri (za svaki snimak i model)

| Merenje | Napomena |
|---|---|
| WER i CER, strogo | tačan zapis: velika slova, interpunkcija, **pismo**, dijakritici, brojevi |
| WER i CER, normalizovano | uklanja samo velika slova, interpunkciju, varijante navodnika/crtica i razliku ćirilica/latinica |
| Zamene / izostavljene / dodate reči (S / D / I) | iz normalizovanog poravnanja |
| Vreme transkripcije, RTF | RTF = vreme obrade / trajanje snimka |
| Model i revizija | `onnx-community/whisper-base@27a07b4b…`, `whisper-small@36050c46…`, uz SHA-256 ONNX fajlova u `run.json` |
| Jezik koji je naveo korisnik | iz dataseta; Whisper transkribuje **tim** jezikom (isto za oba modela) |
| Jezik koji je Whisper prepoznao | posebna detekcija (`--detect`): jezik, verovatnoća, verovatnoća grupe sr/hr/bs |
| Razlika referenca → izlaz | `[ref→hyp]` zamena, `[-ref-]` izostavljeno, `[+hyp+]` dodato; normalizovano i strogo |
| QC upozorenja | iste provere i pragovi kao u Studiju (`qc/checks/transcript.ts`), na netaknutom Whisper izlazu |
| Kandidati za „propušten problem“ | segmenti sa ≥ 3 greške i ≥ 30 % grešaka u rečima, a bez QC upozorenja |

**Normalizacija ne sakriva** (provereno testovima u `src/benchmark/speech/realWorld.test.ts` i `metrics.test.ts`):

- ekavicu i ijekavicu (`mleko` ≠ `mlijeko`),
- razlike srpskog, hrvatskog i bosanskog (`voz` ≠ `vlak`),
- brojeve (`15` ≠ `50`; „9:30“ ≠ „devet i trideset“),
- dijakritike (`kuca` ≠ `kuća`; posebno se broje u `diacriticOnlyErrors`),
- ćirilicu i latinicu. Ovu razliku normalizovani WER ne broji, ali je **strogi WER broji**, a izveštaj je
  posebno prikazuje u koloni „Pismo se razlikuje“ (`scriptDiffers`). Titlo transkript za sr/hr/bs uvek
  piše latinicom, pa ćirilična referenca daje visok strogi WER, što je namerno i vidljivo.

Agregati su **korpusni** (zbir grešaka / zbir referentnih reči), a ne prosek procenata. Uz svaki agregat
stoje broj uzoraka i ukupno trajanje audija.

## Kako se dodaje snimak

1. Snimak od 30 s do 2 min (WAV, MP3, M4A, AAC, OGG, FLAC, WEBM, MP4, MOV, MKV, tj. sve što aplikacija
   ume da dekodira) za koji imate pravo korišćenja.
2. **Tekst otkucajte sami dok slušate**, ili proverite reč po reč. Zapišite ga u `.txt` (UTF-8), tačno kako
   je izgovoreno: dijalekat, ekavica/ijekavica, ponavljanja i poštapalice („ovaj“, „mislim“) ako se čuju.
   Brojeve pišite kako biste ih napisali u titlu. Nerazumljive delove izbacite iz snimka ili ih opišite
   u `--notes`.
3. Dodajte snimak:

```powershell
npm run benchmark:speech:add -- --id sr-podcast-01 --language sr `
  --audio "D:\snimci\podcast-01.mp3" --reference-file "D:\snimci\podcast-01.txt" `
  --quality "podcast mikrofon, tiha soba, bez muzike" --content-type podcast `
  --source "sopstveni snimak" --license "sopstveni snimak" --notes "dva govornika" `
  --confirm-reference --copy
```

| Opcija | |
|---|---|
| `--id` | jedinstven naziv (slova, cifre, `.`, `_`, `-`) |
| `--language` | `sr`, `hr` ili `bs` (jezik koji se govori; vi ga navodite) |
| `--audio` | putanja do fajla |
| `--reference-file` / `--reference-text` | referentni tekst iz fajla ili direktno |
| `--quality` | opis kvaliteta snimka (mikrofon, prostorija, šum, muzika…) |
| `--content-type` | podcast, intervju, vlog, film, vesti, sopstveni-snimak… |
| `--source`, `--license`, `--notes` | poreklo, osnov za korišćenje, napomene |
| `--confirm-reference` | **vi potvrđujete** da je tekst proverila osoba. Bez ove opcije snimak se čuva kao „nepotvrđen“ i za njega se **ne računa** WER |
| `--copy` | kopira snimak u `benchmark/speech/audio/real-world/` (folder je u `.gitignore`, ne ide u git) |
| `--replace` | menja postojeći snimak istog ID-ja (prethodna verzija dataseta ostaje u `datasets/history/`) |

Zaštite:

- **Whisper izlaz nikad ne može biti referenca.** Komanda poredi referencu sa svim ranijim Whisper
  izlazima za isti fajl (po SHA-256 zvuka) ili isti ID, i odbija je ako je identična ili skoro identična
  (normalizovani WER ≤ 2 %).
- Svaka izmena podiže verziju dataseta (`0.1.0`, `0.2.0`…), a stara verzija se čuva u `datasets/history/`.
- SHA-256 zvuka se upisuje u dataset. Ako se fajl kasnije promeni, runner odbija da radi.
- Trajanje WAV fajla se čita iz zaglavlja. Za ostale formate meri ga browser tokom runa.

## Kako se pokreće

```powershell
npm run dev                                   # u posebnom terminalu
npm i --no-save puppeteer-core@24             # jednom
npm run benchmark:speech:real                 # base pa small, detekcija jezika, QC
```

Isto, ručno: `npx tsx benchmark/speech/scripts/run-asr-benchmark.ts --datasets real-world --detect --qc --label real-world`.
Samo jedan model: `--models onnx-community/whisper-small`. Samo neki snimci: `--only "^hr-"`.

Rezultat je novi folder `benchmark/speech/results/<datum>-asr-real-world/`. Postojeći folderi se nikad ne
prepisuju.

| Fajl | Sadržaj |
|---|---|
| `report.md` | tabele po jeziku × modelu, ukupno, po snimku; razlike; QC upozorenja; kandidati za propušteno |
| `samples.json` | sve po snimku: referenca (kopija), izlaz, segmenti sa vremenima, strogi i normalizovani WER/CER, S/D/I, diff, detekcija, QC, revizija modela, SHA-256 zvuka |
| `samples.csv`, `detection.csv` | isto, za Excel |
| `run.json` | hardver, verzije (Edge, Transformers.js, onnxruntime-web), modeli i revizije, konfiguracija dekodiranja, SHA-256 dataseta, memorija po modelu, komanda |
| `qc-review.csv` | šablon za ručnu ocenu QC upozorenja |

## Ručna ocena QC upozorenja

Otvorite `qc-review.csv` (Excel, zarez ili tačka-zarez) i u koloni `rating` upišite:

| Ocena | Kada |
|---|---|
| `correct` (ili `tačno`) | upozorenje je opravdano |
| `false` (ili `lažno`) | lažno upozorenje |
| `missed` (ili `propušteno`) | stvarni problem koji QC nije označio (za redove `missed-candidate` ili sopstvene redove sa `kind = missed`) |
| `n/a` | nije moguće proceniti |

Zatim:

```powershell
npm run benchmark:speech:qc-summary -- <run-id>
```

Komanda pravi **nove** fajlove `qc-review-summary-<vreme>.json/.md`: broj tačnih i lažnih upozorenja, udeo
tačnih među ocenjenim, propuštene probleme i podelu po vrsti provere. **QC pragovi se ne menjaju** na
osnovu ovoga. Za to je potrebno mnogo više snimaka i ocena.

## Ponovljivost i memorija

- Oba modela dobijaju **isti fajl** (provera SHA-256) i **iste postavke**: jezik je onaj koji je naveo
  korisnik, greedy dekodiranje, `chunk_length_s 30`, `stride 5`, blokovi od ~90 s, q8, WASM
  (`src/media/whisperConfig.ts`). Sve se upisuje u `run.json`.
- Modeli rade **jedan za drugim**, nikad istovremeno. Posle svakog modela stranica (i Web Worker sa
  modelom) se zatvara, a oslobađanje memorije se meri. Pre svakog modela proverava se slobodna
  memorija: ispod 1.500 MB model se preskače i razlog se upisuje.
- Ako slobodan RAM padne ispod 200 MB, run dobija oznaku `memoryPressure`: vremena tada uključuju swap.
- Svaki snimak se dekodira dva puta (detekcija, pa transkripcija), što je isto kao u aplikaciji. Za snimke
  do 2 min to je oko 1 s i nekoliko MB.
- Nema mreže: audio i tekst ne napuštaju računar.

## Provera infrastrukture (nije rezultat)

Cela cev je proverena 2026-11-11 na jednom **sintetičkom** snimku (TTS engleski govor + 35 s tišine, referenca
tačna po konstrukciji), sa rezultatima u privremenom folderu van projekta:

- Oba modela su radila jedan za drugim; posle zatvaranja svakog modela Edge je spao na oko 335–370 MB.
- Napravljeni su `report.md`, `samples.json`, `detection.csv` i `qc-review.csv` (7 upozorenja), a
  `qc-summary` je napravio sažetak.
- Komanda za dodavanje snimka je proverena u izolovanom folderu: odbija nepotpune podatke, postojeći ID
  bez `--replace` i referencu jednaku ranijem Whisper izlazu; čuva staru verziju dataseta.

Ti brojevi (base 9,1 % WER, small 0 % na 22 reči sintetičkog engleskog) **ne govore ništa** o srpskom,
hrvatskom i bosanskom.

## Ograničenja

- Pet snimaka (predlog za početak) daje grubu sliku, ne statistički pouzdan rezultat. Uz svaki broj
  stoji koliko je uzoraka i audija iza njega.
- Referenca je onoliko dobra koliko je pažljivo otkucana. Greške u referenci izgledaju kao greške modela.
- WER ne razlikuje sitnu od ozbiljne greške. Zato postoje diff i ručna ocena.
- Whisper ne razlikuje pouzdano srpski, hrvatski i bosanski (prethodna faza: srpski govor → „hr“).
  Detekcija se samo beleži, a transkripcija koristi jezik koji je naveo korisnik.
- Vremena na ovom računaru (3,38 GB RAM, često swap) su pesimistična.
- Kandidati za „propušten problem“ su samo lista za proveru. Odluku donosi osoba.
- Benchmark interfejs je komandna linija. UI aplikacije nije menjan.

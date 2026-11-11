# Speech Accuracy Report (ASR) — Titlo

Faza: Speech Accuracy Lab, deo 1. Datum: **2026-11-11**.
Poređenje modela: `docs/ASR_MODEL_COMPARISON.md`. Metodologija i komande: `benchmark/speech/README.md`.

## 1. Šta je ovde stvarno izmereno (i šta nije)

| Vrsta | Šta | Važi kao |
|---|---|---|
| **Stvarni WER/CER** | 46 sintetičkih engleskih uzoraka (Windows TTS Zira/David), referenca tačna po konstrukciji | Prepoznavanje **sintetičkog engleskog**. Ne važi za ljudski govor ni za sr/hr/bs |
| **Detekcija jezika** | 27 uzoraka × 2 modela: engleski TTS, šum, muzika, kontrole bez govora, vaša 2 videa | Stvarni rezultati; srpski samo na jednom snimku, hrvatski i bosanski **nisu testirani** |
| **Demonstracija** | `eng-video.mp4`, `srp-video.mp4` (CapCut glas) | Prikazan izlaz; **nema WER-a**, jer nema proverene reference |
| Nije izmereno | Srpski/hrvatski/bosanski WER, ljudski glasovi, više govornika, filmovi, snimci od 10/30/60 min, odstupanje vremenskih oznaka | Potrebni su snimci sa referencom (odeljak 8) |

## 2. Hardver i runtime

AMD Ryzen 3 3200U (2 jezgra / 4 niti), **3,38 GB RAM**, Radeon Vega 3 (512 MB deljene memorije, ne koristi se),
Windows 10 Home 19045 x64. Edge 157 (headless), Transformers.js 4.3.2, onnxruntime-web 1.31.0-dev (WASM, CPU,
jedna nit jer stranica nije `crossOriginIsolated`). Modeli: `onnx-community/whisper-base` @`27a07b4b`,
`onnx-community/whisper-small` @`36050c46`, int8. Dekodiranje: greedy.

Tokom svih merenja radili su VS Code i Chrome. Dostupan RAM bio je **15–120 MB**, pa su sva vremena merena **uz
swap** (svaki run nosi oznaku `memoryPressure`). Na rasterećenom računaru brzina bi bila bolja; tačnost ne zavisi od toga.

## 3. Automatsko prepoznavanje jezika

**Problem (potvrđen u kodu Transformers.js 4.3.2):** ako jezik nije zadat, `_retrieve_init_tokens` ispiše
„No language specified - defaulting to English“ i stavi `<|en|>`. Opcija „Prepoznaj automatski“ je zato srpski
govor obrađivala kao engleski.

**Rešenje** (`src/media/languageDetection.ts`, poruka `detect` u `whisper.worker.ts`):

1. Do 3 prozora od 30 s sa najviše zvuka (preskače tišinu i uvod).
2. Isto što radi originalni Whisper: jedan korak dekodera posle `<|startoftranscript|>`, softmax nad jezičkim
   tokenima, i no-speech verovatnoća iz tokena `<|nocaptions|>`.
3. Prosek prozora (težina = udeo zvuka), pa odluka:
   - `no-speech`: nema zvuka iznad −40 dBFS, ili no-speech > 60 %;
   - `uncertain`: < 2 s govora, nepodržan jezik ili verovatnoća pobedničke grupe < 60 %;
   - `detected`: engleski, ili grupa **srpski + hrvatski + bosanski**.
4. Kad nije `detected`, transkripcija se **ne pokreće**. Studio prikazuje razlog, verovatnoće modela i dugme
   „Transkribuj kao: …“, a korisnik može izabrati jezik ručno.

Pragovi (60 %, 2 s, −40 dBFS) su početne vrednosti. Provereni su na uzorcima ispod, ali ne na velikom skupu.

### Rezultati detekcije (run `2026-11-11T12-37-41-129Z-asr-detect`)

| Uzorci | base | small |
|---|---|---|
| Engleski TTS, čist (8) | 8/8 `en` (96–99 %) | 8/8 `en` (99–100 %) |
| Engleski TTS sa šumom 10 dB / muzikom 6 dB (12) | 12/12 `en` (95–100 %) | 12/12 `en` (97–100 %) |
| „Yes.“, 0,4–0,5 s govora (2) | 2/2 `uncertain` (premalo govora), ispravno | 2/2 `uncertain`, ispravno |
| Tišina 10 s | `no-speech` (bez poziva modela) | `no-speech` |
| Beli šum 10 s | `no-speech` (model: 87 % bez govora) | `no-speech` (77 %) |
| Sintetička muzika 10 s | `no-speech` (87 %) | `no-speech` (81 %) |
| `eng-video.mp4` | `en` 99,6 % | `en` 99,7 % |
| `srp-video.mp4` | grupa sr/hr/bs **67 %** | grupa sr/hr/bs **88 %** |
| **Ukupno ispravno** | **25/27**, 0 pogrešnih jezika | **25/27**, 0 pogrešnih jezika |

Preostala 2 od 27 su „Yes.“ uzorci, gde je `uncertain` namerno ponašanje. Vreme detekcije: prosečno 8 s (base) i
19 s (small) po snimku, uz swap.

**Važan nalaz za srpski.** Na `srp-video.mp4` Whisper daje: hr 46–56 %, bs 15–23 %, **sr samo 6–9 %**, a ostatak
ide na slovenački i albanski. Kao grupa je pouzdano prepoznat, ali sam token „sr“ bi bio pogrešan izbor. Base je
blizu praga (67 %). Zato:

- detekcija odlučuje o **grupi**, a ne o varijanti;
- ako je projekat već sr/hr/bs, transkripcija koristi **jezik projekta**, a ne Whisperov nagoveštaj
  (`TranscriptionOptions.shVariant`);
- uporedni izlaz za „croatian“ i „serbian“ je u odeljku 5: razlika je mala.

## 4. Tačnost na sintetičkom engleskom (run `2026-11-11T12-53-39-778Z-asr-explicit`)

| | base | small |
|---|---|---|
| WER normalizovano / strogo | 9,8 % / 11,7 % | **7,6 % / 9,2 %** |
| CER normalizovano / strogo | 6,5 % / 6,9 % | **6,1 % / 6,4 %** |
| Bez kategorije `numbers`: WER / CER (normalizovano) | 5,7 % / 2,1 % | **3,4 % / 1,5 %** |
| Zamene / izostavljene / dodate reči | 27 / 22 / 2 | 21 / 19 / 0 |
| Greške samo u dijakriticima | 0 | 0 (engleski) |

Šta su greške, konkretno:

- **Brojevi** (24 greške kod oba modela): Whisper piše „9.30“, „14 March“, „$29.99“, „42“. Svi brojevi su
  tačni, ali zapisani ciframa. WER to namerno broji kao grešku.
- **Imena:** base „Djokovic“ → „Zhokovic“ / „Novak-Jokovic“, „Jokic“ → „Nikolayjakik“; small samo „Jokic“ → „Djokovic“.
- **Retka reč:** „chatbot“ → „chopper“ / „chocolate“ / „chat but“ (brz govor i šum).
- **Spajanje reči:** „Log in to“ → „Log into“ / „Login to“.

„Hello, I am your AI assistant.“ je prepoznata **bez greške** na oba TTS glasa, i uz šum i „muziku“.

## 5. Demonstracija na vašim videima (bez reference, bez WER-a)

Runovi `2026-11-11T13-16-09-763Z-asr-demo-auto` (Whisper bira varijantu) i
`…-asr-demo-auto-srvariant` (varijanta = jezik projekta, „serbian“). Videi traju 89 s.

**`eng-video.mp4`** (oba modela, jezik prepoznat automatski kao engleski):

- base: „Hello, **I'm Yuri I Assistant**. …“, „paste it **until** your website“, „**you're** working hours“,
  „**days free** … **dot** try it“;
- small: „Hello, **I'm Yuri, I assistant**. …“, „**Login** to your account“, „website **addressant**“, „Seven days
  free, no credit card required.“

Greška „I'm Yuri“ se dakle javlja kod **oba** modela na ovom CapCut glasu, a ne javlja se na Windows TTS glasovima.
Uzrok je izgovor ili naglasak tog glasa („your AI“ izgovoreno spojeno), a ne podešavanje modela.

**`srp-video.mp4`**, small, Whisper izabrao „croatian“:

> Čao, ja sam to ja je asistent. **Dobrdošo!** Ovo je **site i enokrijezgog** salonu. Mušterija postavlja pitanje,
> a bot sam **odgovor**. … Posta deset **kad salo ne radi**. … Svi termini vam stižu **ovdje**. …

Base sa „croatian“ je znatno lošiji („sajt hino krijezgu ksalona“, „Rifresuje te stranicu i boć se pojevj“).

**Uporedno, isti video sa „serbian“** (run `2026-11-11T13-29-41-628Z-asr-demo-auto-srvariant`): izlaz je **skoro
identičan**. Kod small se razlikuju samo „5 minut“ → „5 minuta“, „česta pitanje“ → „česta pitanja“ i
„pročitati“ → „prođitati“; kod base nekoliko sitnica. Ijekavsko „ovdje“ ostaje u **oba** slučaja. Pretpostavka da
token varijante vuče zapis ka hrvatskom/ijekavskom ovim merenjem **nije potvrđena** (n = 1 snimak). Pravilo „jezik
projekta umesto Whisperovog nagoveštaja“ ostaje, jer je doslednije i ne šteti, ali njegov izmereni efekat je mali.

Glavni problem srpskog transkripta nije izbor varijante nego **prepoznavanje reči** ovog glasa: „Dobrdošo“,
„kad salo ne radi“ (salon), „site i enokrijezgog salonu“ (sajt frizerskog salona), „Refresuje“, „bod se pojavlj“.
Bez reference ne možemo dati WER, ali je jasno da je srpski znatno lošiji od engleskog na istom tipu glasa.

## 6. Brzina i memorija

| | base | small |
|---|---|---|
| Učitavanje modela | 16–17 s | 12–19 s |
| RTF, kratki TTS uzorci (231 s audija) | 1,31 | 4,02 |
| RTF, video od 89 s, engleski | 1,07 | 2,30 |
| RTF, video od 89 s, srpski („croatian“) | 0,88 | 3,42 |
| RTF, video od 89 s, srpski („serbian“) | 1,12 | 2,82 |
| CPU (Edge / 4 logička jezgra) | ~25 % (jedna nit) | ~25 % |
| Najveći private bytes procesa sa modelom | 0,8–1,3 GB | 1,7 GB |
| Ukupno Edge (vrh) | 1,25–1,73 GB | 2,0–2,1 GB |
| Posle zatvaranja stranice | ~380 MB (osnovna potrošnja Edge-a) | ~380 MB |

- Na ovom računaru, uz ostale otvorene aplikacije, small treba **2,3–4 minuta po minutu** snimka, a base oko 1.
- Snimci od 10, 30 i 60 minuta **nisu testirani**. Dostupan RAM je već pri ovim kratkim snimcima padao na 15–70 MB,
  a ceo dekodiran zvuk se drži u memoriji (~3,8 MB po minutu, 60 min ≈ 230 MB plus privremeni bafer). Dugi test bi
  ovde vrlo verovatno samo merio swap. Treba ga raditi tek uz više slobodnog RAM-a (zatvorene druge aplikacije).
- UI se ne blokira: model radi u Web Workeru.
- Otkazivanje je testirano integration testom (worker se gasi odmah) i ručno je provereno u ranijoj fazi.
  Nastavak prekinute transkripcije nije podržan.

## 7. Halucinacije na delovima bez govora

Kad je jezik zadat ručno, oba modela na 10 s tišine pišu „you“, a na šumu ili muzici „.“ ili „Thank you.“.
Detekcija jezika to sprečava za snimak **bez ikakvog** govora, ali ne za tihe delove unutar snimka sa govorom.
Predlog za sledeću fazu: označiti (ne brisati) segmente čiji deo zvuka ima energiju ispod praga, kao „potrebna provera“.

**Urađeno u sledećoj fazi (Transcription Quality Control):** segmenti sa tekstom na tišini ili ujednačenom zvuku,
tipične poštapalice na muzici („you“, „Thank you.“), ponavljanja i govor bez titla sada se **označavaju**
(`needs-review` + QC upozorenje sa objašnjenjem), a ništa se ne briše. Istovremeno je uklonjeno tiho brisanje
redova sa špicom titlova i duplikata iz `chunksToSegments`. Pragovi audio aktivnosti su provereni na ovim istim
TTS snimcima i kontrolama (svih 46 TTS snimaka „nalik govoru“, tišina/šum/muzika nisu). To nije merenje na
ljudskom govoru. Detalji: `docs/TRANSCRIPTION_QUALITY_CONTROL.md`. Stari rezultati benchmarka nisu menjani.

## 8. Ograničenja i otvorena pitanja

1. **Nema srpskog, hrvatskog ni bosanskog WER-a.** Nema snimaka sa proverenom referencom. Ovo je najvažnija rupa.
2. Sintetički glasovi su lakši od ljudskih; 7,6 % WER na TTS-u ne znači 7,6 % na podkastu ili filmu.
3. **Jedna nit.** onnxruntime-web bez `crossOriginIsolated` (COOP/COEP zaglavlja) ne koristi više jezgara. Uz
   zaglavlja bi mogao da koristi 4 niti. To nije urađeno ni izmereno; treba proveriti uticaj na ostatak aplikacije.
4. **Greedy dekodiranje** (Transformers.js ignoriše `num_beams`). Nema ni ponovnog pokušaja sa višom temperaturom
   za sumnjive delove, koji originalni Whisper ima.
5. **Nema pouzdanog confidence-a po segmentu.** Pipeline ne vraća verovatnoće tokena, pa se procenat ne prikazuje.
6. Pragovi detekcije nisu kalibrisani na velikom skupu.
7. Vremenske oznake nisu merene prema ručnoj referenci.
8. `initial prompt` / glosar za Whisper: Transformers.js 4.3 ima zakomentarisan `prompt_ids` u `generate()`,
   pa vocabulary biasing **nije podržan** u ovom runtime-u.

## 9. Ponavljanje

```powershell
npm run dev
npm i --no-save puppeteer-core@24
npx tsx benchmark/speech/scripts/run-asr-benchmark.ts                                     # WER/CER base + small
npx tsx benchmark/speech/scripts/run-asr-benchmark.ts --datasets asr-synthetic-en-v1,local-demo --detect --no-transcribe --label detect
npx tsx benchmark/speech/scripts/run-asr-benchmark.ts --datasets local-demo --language auto --label demo-auto
npx tsx benchmark/speech/scripts/run-asr-benchmark.ts --datasets local-demo --only demo-srp --language auto --sh-variant sample --label demo-auto-srvariant
```

Svaki run pravi novi folder u `benchmark/speech/results/` i nikad ne prepisuje stare.

## 10. Svi runovi ove faze

| Run | Šta | Važi? |
|---|---|---|
| `2026-11-11T12-19-29-833Z-asr-smoke` | prvi pokušaj; Edge se nije pokrenuo (puppeteer.launch) | Ne, prazan |
| `2026-11-11T12-19-57-589Z-asr-smoke` | smoke, 3 uzorka; detekcija pala (`tokens_to_ids` ne postoji u TJS 4.3, ispravljeno) | Samo kao dokaz greške |
| `2026-11-11T12-22-52-682Z-asr-detect` | detekcija; stranica se srušila posle 6 uzoraka (verovatno memorija); runner tada još nije hvatao pad | Ne, prekinut |
| `2026-11-11T12-37-41-129Z-asr-detect` | detekcija, 27 × 2 | **Da** (memorija u ovom runu nije izmerena tačno, jer je praćen pogrešan PID; ispravljeno) |
| `2026-11-11T12-53-39-778Z-asr-explicit` | WER/CER, 49 × 2 | **Da** |
| `2026-11-11T13-16-09-763Z-asr-demo-auto` | vaši videi, auto jezik | **Da** (demonstracija) |
| `2026-11-11T13-29-41-628Z-asr-demo-auto-srvariant` | srpski video, varijanta projekta („serbian“) | **Da** (demonstracija) |

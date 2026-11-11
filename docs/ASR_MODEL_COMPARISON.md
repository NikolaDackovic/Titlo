# Poređenje Whisper modela (ASR)

Stanje: **2026-11-11**. Upoređena su samo dva već instalirana modela: `whisper-base` i `whisper-small`.
Tiny, medium, large-v3 i large-v3-turbo **nisu preuzimani ni testirani** (odluka korisnika zbog RAM-a; vidi dole).

## Uslovi (isti za oba modela)

| | |
|---|---|
| Računar | AMD Ryzen 3 3200U (2 jezgra / 4 niti, 2,6 GHz), **3,38 GB RAM**, Radeon Vega 3 (512 MB deljene), Windows 10 Home 19045 x64 |
| Opterećenje | Tokom svih merenja radili su VS Code (~3,3 GB private) i Chrome (~2 GB). Dostupan RAM pao je na **41–72 MB**, pa su vremena merena **uz swap** (run je označen `memoryPressure`). Na rasterećenom računaru brzina bi bila bolja |
| Runtime | Kod aplikacije (`BrowserWhisperEngine` + `whisper.worker.ts`), Transformers.js 4.3.2, onnxruntime-web 1.31.0-dev WASM, headless Edge 157, `crossOriginIsolated: false` (WASM radi bez deljene memorije između niti) |
| Modeli | `onnx-community/whisper-base` @`27a07b4b` (77 MB), `onnx-community/whisper-small` @`36050c46` (241 MB); oba int8 (q8) |
| Dekodiranje | greedy (Transformers.js 4.3 ignoriše `num_beams`), `return_timestamps`, `chunk_length_s 30`, `stride 5`, blokovi od ~90 s |
| Jezik | eksplicitno zadat (`en`) za WER run |
| Dataset | `asr-synthetic-en-v1` v1.0.0 (49 uzoraka, 231 s; SHA-256 u `run.json`) |
| Run | `benchmark/speech/results/2026-11-11T12-53-39-778Z-asr-explicit/` |

## Tačnost: sintetički engleski (Windows TTS: Zira, David)

Ovo su **stvarni WER/CER rezultati**, ali na **sintetičkom engleskom govoru**. Ne predstavljaju ljudski govor, srpski ni filmove.
46 uzoraka sa referencom, 523 referentne reči.

| | base | small |
|---|---|---|
| WER normalizovano | **9,8 %** (51/523) | **7,6 %** (40/523) |
| WER strogo | 11,7 % | 9,2 % |
| CER normalizovano | 6,5 % | 6,1 % |
| CER strogo | 6,9 % | 6,4 % |
| S / D / I (normalizovano) | 27 / 22 / 2 | 21 / 19 / 0 |
| Uzorci bez ijedne greške | 29 / 46 | 32 / 46 |
| **Bez kategorije `numbers`** (WER norm. / CER norm.) | **5,7 %** / 2,1 % (27/475) | **3,4 %** / 1,5 % (16/475) |
| Neuspele transkripcije / prazni izlazi | 0 / 0 | 0 / 0 |

Kategorija `numbers` (4 uzorka) ima 50 % WER kod **oba** modela, jer Whisper piše brojeve ciframa
(„9.30“, „14 March“, „$29.99“), a referenca ih ima slovima. To je razlika u zapisu, ne pogrešno čuven broj:
svi brojevi su tačni. Pravilo je namerno: normalizacija ne pretvara brojeve (vidi `benchmark/speech/README.md`).
Polovina svih grešaka (24/51 kod base, 24/40 kod small) potiče od toga.

### Po kategoriji (WER normalizovano, base → small)

| Kategorija | Uzoraka | base | small | Napomena |
|---|---|---|---|---|
| synthetic-clean | 18 | 4,6 % | 3,7 % | uglavnom „Log in to“ → „Log into“ (isto čuveno, drugačije zapisano) |
| names-terms | 6 | 9,4 % | **1,6 %** | base: „Djokovic“ → „Zhokovic“, „Nikolayjakik“; small: „Jokic“ → „Djokovic“ |
| numbers | 4 | 50 % | 50 % | samo zapis brojeva (vidi gore) |
| synthetic-fast (TTS brzina +5) | 4 | 5,5 % | 5,5 % | „chatbot“ → „chopper“ (oba) |
| synthetic-noise (beli šum, 10 dB SNR) | 6 | 5,8 % | **2,9 %** | base: „chatbot“ → „chocolate“ |
| synthetic-music (sintetička podloga, 6 dB SNR) | 6 | 5,8 % | **2,9 %** | |
| very-short („Yes.“) | 2 | 0 % | 0 % | |

Po glasu (normalizovano): base Zira 11,0 % / David 8,5 %; small Zira 8,3 % / David 6,9 %.

Rečenica „Hello, I am your AI assistant. Welcome aboard.“ prepoznata je **bez greške** u oba modela i sa oba glasa,
i uz šum i „muziku“. Greška „I'm Yuri, I assistant“ iz vašeg CapCut videa se dakle **ne ponavlja** na Windows TTS glasu:
zavisi od konkretnog glasa i snimka. Za nju je potreban test na tom tipu glasa sa referencom.

## Halucinacije na snimku bez govora (jezik zadat ručno)

| Kontrola | base | small |
|---|---|---|
| tišina 10 s | „you“ | „you“ |
| beli šum 10 s | „.“ | „Thank you.“ |
| sintetička muzika 10 s | „.“ | „Thank you.“ |

Kad je jezik zadat ručno, oba modela **izmišljaju tekst** na delovima bez govora. Automatska detekcija ovo
sprečava za ceo snimak (vidi detekciju), ali ne za tihe delove unutar snimka sa govorom. To je otvoren problem
(predlog u `docs/SPEECH_ACCURACY_REPORT.md`).

## Brzina i memorija (izmereno, uz swap)

| | base | small |
|---|---|---|
| Učitavanje modela | 16,7 s | 15,6 s |
| Vreme obrade 231 s audija (46 uzoraka) | 302 s | 930 s |
| **RTF** (vreme / trajanje) | **1,31** | **4,02** |
| RTF kratkih „Yes.“ uzoraka (0,5 s) | 3,6 | 13,5 |
| **RTF, vaši videi od 89 s** (en / sr „croatian“ / sr „serbian“) | **1,07 / 0,88 / 1,12** | **2,30 / 3,42 / 2,82** |
| Prosečno CPU opterećenje (svi Edge procesi / 4 logička jezgra) | 25 % | 25 % |
| Najveći private bytes jednog Edge procesa (worker sa modelom) | 810 MB | 1683 MB |
| Ukupno private bytes svih Edge procesa (vrh) | 1254 MB | 2025 MB |
| Posle zatvaranja stranice (svi Edge procesi) | 379 MB | 381 MB |
| Najmanje slobodne commit memorije tokom rada | 1678 MB | 1328 MB |

- RTF > 1 znači sporije od realnog vremena. Small na ovom računaru treba **~4 minuta po minutu snimka**, base ~1,3.
- Whisper uvek obrađuje prozor od 30 s, pa su kratki uzorci (0,5–5 s) skuplji po sekundi. RTF dugih snimaka je
  zato realniji pokazatelj; meri se na vašim videima (vidi `SPEECH_ACCURACY_REPORT.md`).
- CPU od 25 % pokazuje da radi **jedna nit**: bez `crossOriginIsolated` onnxruntime-web ne može da koristi više niti.
  To je najveća neiskorišćena rezerva brzine (vidi otvorene probleme).
- Memorija se oslobađa: posle zatvaranja stranice Edge se vraća na ~380 MB (osnovna potrošnja pregledača).

## Vaši videi (demonstracija, bez WER-a)

Na `srp-video.mp4` small je vidno bolji od base: base daje „sajt hino krijezgu ksalona“, „Rifresuje te stranicu i boć se
pojevj“, „Uluge te se na vaš nalog“, a small „Ulogujete se na vaš nalog, kopjerate jednu liniju koda“. Oba greše na
„Dobrdošo“ i „kad salo ne radi“. Na `eng-video.mp4` su slični; oba čuju „I'm Yuri“. Detalji su u
`docs/SPEECH_ACCURACY_REPORT.md`, odeljak 5.

## Odluka

**Podrazumevani model ostaje `whisper-small`.** Na istom skupu je tačniji (7,6 % prema 9,8 % WER; bez zapisa
brojeva 3,4 % prema 5,7 %), posebno na imenima i uz pozadinski zvuk, ali je ~3× sporiji i troši ~2× više RAM-a.

`whisper-base` ostaje ponuđen kao brža opcija (npr. za dug, jasan engleski govor na slabom računaru).

Ovi rezultati važe za **sintetički engleski**. Za srpski/hrvatski/bosanski WER još **ne postoji** (nema snimaka sa
referencom), pa izbor modela za te jezike još nije potvrđen merenjem.

## Modeli koji nisu testirani

| Model | Veličina (int8, proverena na HF) | Zašto nije testiran |
|---|---|---|
| tiny | 41 MB | Dozvoljeno tek posle osnovnih rezultata; nije preuzet u ovoj fazi |
| medium (`Xenova/whisper-medium`) | 776 MB | Zabranjeno preuzimanje (RAM) |
| large-v3-turbo | 1085 MB (q4: 759 MB) | Zabranjeno preuzimanje (RAM) |
| large-v3 | 1,5–1,8 GB | Zabranjeno; nerealno za 3,38 GB RAM-a |

Na osnovu izmerenog (small: ~1,7 GB private za worker), turbo bi verovatno zahtevao više od 2,5 GB i ne bi bio
stabilan na ovom računaru uz ostale otvorene aplikacije. To je procena, nije izmereno.

## Veći modeli preko whisper.cpp (test van aplikacije, 2026-11-11)

Na zahtev korisnika, posle lošeg Small rezultata na `srp-video.mp4`. **Demonstracija, nema WER-a**: snimak je
CapCut AI glas na srpskom (89 s), bez proverene reference. Isti zvuk kao u aplikaciji (dekodiran njenim
dekoderom, 16 kHz mono). whisper.cpp v1.9.5 (build b5454, `whisper-bin-x64.zip`), 4 niti, CPU, jezik `sr`.
Modeli sa `ggerganov/whisper.cpp` (Hugging Face), SHA-256 proveren:
`ggml-large-v3-q5_0.bin` `d75795ec…` (1.081 MB), `ggml-large-v3-turbo-q5_0.bin` `39422170…` (574 MB).
Lokacija: `%LOCALAPPDATA%\ExYuTitlStudio\tools\` i `…\models\whisper.cpp\` (van projekta i OneDrive-a).

| | Small (aplikacija, browser) | large-v3-turbo q5, beam 5 | large-v3-turbo q5, greedy | large-v3 q5, beam 5 |
|---|---|---|---|---|
| Vreme za 89 s | 251 s (RTF 2,8) | 510 s (RTF 5,7) | 447 s (RTF 5,0) | 1194 s (RTF 13,4) |
| Najveća private memorija | ~1,7 GB (worker) | 1,3 GB | 1,25 GB | **2,5 GB, slobodna commit memorija pala na 0** |
| Primer: „Prvo mu kažete šta radite…“ | „Prvom ukažete šta radete, radno vreme u svog je“ | „Prvo mu kažete šta radite. Radno vreme, usloge, cene“ | isto kao beam 5 | „Prvo mu kažete šta radite. Radno vreme, usloge, cene“ |
| Primer: „Sedam dana besplatno“ | „7 dano bezpotno“ | „Sedam dana bespotno“ | „Sedam dana bespletno“ | „Sedam dana besplatno“ |

Sva merenja su rađena dok je slobodan fizički RAM bio 83–357 MB (VS Code, Chrome), uz rad preko diska:
vremena su pesimistična. Zaključak: **large-v3 nije upotrebljiv na ovom računaru** (memorija), a
**large-v3-turbo jeste**: tekst je blizu large-v3 i mnogo bolji od Small, uz 1,3 GB RAM-a, ali je oko 2× sporiji
od Small. U aplikaciju još nije ugrađen.

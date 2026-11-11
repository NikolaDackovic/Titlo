# Speech benchmark (ASR) — Titlo

Merenje tačnosti prepoznavanja govora (Whisper) **u istom runtime-u koji koristi aplikacija**.

```
benchmark/speech/
  references/synthetic-en-texts.json   tekstovi za sintetičke uzorke (tekst = referenca)
  audio/synthetic-en/tts/              WAV iz Windows TTS-a (Zira, David) + tts-manifest.json
  audio/synthetic-en/mixed/            isti uzorci sa veštačkim šumom/„muzikom“
  audio/controls/                      tišina, samo šum, samo „muzika“ (bez govora)
  datasets/asr-synthetic-en-v1.json    dataset v1.0.0 (49 uzoraka, 231 s)
  datasets/local-demo.json             snimci korisnika (bez reference → samo demonstracija)
  scripts/tts-en.ps1                   generisanje TTS uzoraka (System.Speech, offline)
  scripts/build-datasets.ts            pravljenje dataseta (odbija da prepiše postojeći)
  scripts/run-asr-benchmark.ts         runner
  results/<run-id>/                    rezultati; nikad se ne prepisuju
```

## Zašto browser, a ne Node

Aplikacija prepoznaje govor u **Web Workeru** (`src/media/whisper.worker.ts`) preko Transformers.js-a na
**onnxruntime-web (WASM)**. Node verzija Transformers.js-a koristi drugi backend (`onnxruntime-node`, nativni
CPU kernel), pa njeni rezultati i brzina nisu direktno uporedivi sa aplikacijom.

Zato runner pokreće **pravi kod aplikacije**: otvara headless Edge na Vite dev serveru, učitava
`src/media/browserWhisper.ts` (isti `BrowserWhisperEngine` + isti worker, isto dekodiranje zvuka preko Web Audio,
isto deljenje na blokove i isto pravljenje titlova) i poziva `transcribe()` / `detectLanguage()`. Hipoteza za
WER je **konačan tekst titlova** koji bi korisnik video.

## Kako se pokreće

```powershell
npm run dev                                   # u posebnom terminalu (servira /src i /models)
npm i --no-save puppeteer-core@24             # jednom; ne ulazi u package.json
powershell -NoProfile -ExecutionPolicy Bypass -File benchmark/speech/scripts/tts-en.ps1   # samo ako pravite dataset iznova
npx tsx benchmark/speech/scripts/build-datasets.ts                                        # samo za novu verziju dataseta

# WER/CER, base + small, poznat jezik (isto: npm run benchmark:speech):
npx tsx benchmark/speech/scripts/run-asr-benchmark.ts
# samo detekcija jezika (bez transkripcije), sintetički + snimci korisnika:
npx tsx benchmark/speech/scripts/run-asr-benchmark.ts --datasets asr-synthetic-en-v1,local-demo --detect --no-transcribe --label detect
# snimci korisnika, transkripcija (demonstracija, bez WER-a):
npx tsx benchmark/speech/scripts/run-asr-benchmark.ts --datasets local-demo --label demo
```

Opcije: `--models a,b`, `--language explicit|auto`, `--detect`, `--no-transcribe`, `--only <regex>`, `--limit N`,
`--label <ime>`, `--min-free-commit-mb N` (podrazumevano 1500), `--port N`, `--app <url>`.
Ako `puppeteer-core` nije u projektu: `PUPPETEER_CORE_DIR=<folder koji sadrži node_modules/puppeteer-core>`.

## Šta jedno pokretanje čuva (`results/<run-id>/`)

| Fajl | Sadržaj |
|---|---|
| `run.json` | ID, datum, hardver (CPU, jezgra, RAM, GPU, OS), Edge verzija, Transformers.js i onnxruntime-web verzija, model (revizija, SHA-256 ONNX fajlova), konfiguracija dekodiranja, dataset (verzija, SHA-256), komanda, vreme učitavanja, memorija, sumarni rezultati po kategoriji i jeziku |
| `samples.json` / `samples.csv` | po uzorku: trajanje, vreme, RTF, CPU %, WER/CER (strogo i normalizovano), S/D/I/N, hipoteza, greška |
| `detection.csv` | po uzorku: očekivano, status, razlog, jezik, verovatnoće grupa, no-speech, ispravno |
| `samples.partial.jsonl` | upisuje se posle svakog uzorka (ostaje i ako se pokretanje prekine) |

Pre svakog modela runner proverava slobodnu commit memoriju (RAM + pagefile) i preskače model ako je ispod
praga, uz upisan razlog. Tokom rada meri (svake sekunde) working set i private bytes svih Edge procesa i
dostupan fizički RAM. Ako dostupan RAM padne ispod 200 MB, run dobija oznaku `memoryPressure`: vremena tada
uključuju swap i lošija su od onih na rasterećenom računaru.

## Metrike

Implementacija: `src/benchmark/speech/metrics.ts`, testovi sa ručno izračunatim vrednostima:
`metrics.test.ts`.

- **WER** = (S + D + I) / N po rečima; **CER** isto po karakterima (razmaci se broje). Može biti > 100 %
  (mnogo izmišljenih reči). Agregat je **korpusni** (zbir grešaka / zbir referentnih reči), ne prosek procenata.
- **Strogo**: tačan zapis (NFC, sažeti razmaci). Broje se velika/mala slova, interpunkcija, pismo, dijakritici.
- **Normalizovano** uklanja samo: velika/mala slova, interpunkciju, varijante apostrofa/navodnika/crtica,
  i razliku ćirilica/latinica (uz oznaku `scriptDiffers`).
- **Nikad se ne normalizuje**: č/ć, š, ž, đ (i „dj“), ekavica/ijekavica, padeži i nastavci, brojevi
  („9:30“ ≠ „nine thirty“ — u kategoriji `numbers` WER zato meri i način zapisa brojeva).
- `diacriticOnlyErrors`: koliko zamena se razlikuje samo po dijakriticima. To je dijagnostika, WER ostaje isti.

Ograničenja: WER ne razlikuje sitnu od ozbiljne greške („Yuri“ umesto „your AI“ i „color“/„colour“ broje se
jednako); kratki uzorci daju velike skokove procenta; sintetički glas je mnogo lakši od ljudskog.

## Tri vrste rezultata (ne mešati)

1. **Stvarni WER/CER**: samo uzorci sa pouzdanom referencom (`referenceStatus: exact-by-construction` ili
   `human-verified`, `evaluation: wer`).
2. **Demonstracija**: snimci bez reference (`evaluation: demo`): prikazuje se izlaz, bez WER-a.
3. **Detekcija**: `detection-only` kontrole (tišina, šum, „muzika“) i očekivani jezik.

Sintetički TTS uzorci mere prepoznavanje **sintetičkog engleskog** glasa. Nisu reprezentativni za ljudski
govor, srpski/hrvatski/bosanski, filmove ni podkaste.

Isti WAV fajlovi (`audio/synthetic-en/**`, `audio/controls/`) koriste se i u unit testu audio aktivnosti
(`src/media/audioActivity.test.ts`) da se proveri da heuristika tišine ne proglašava jasan (sintetički) govor
tišinom, ni šum govorom. Test se preskače ako fajlovi ne postoje.

Rezultati i tumačenje: `docs/SPEECH_ACCURACY_REPORT.md`, `docs/ASR_MODEL_COMPARISON.md`,
`docs/TRANSCRIPTION_QUALITY_CONTROL.md`.

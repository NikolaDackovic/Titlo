# Benchmark prevoda

```
benchmark/
  datasets/exyu-translation-100.json   dataset v2.0.0 (100 rečenica, 10 kategorija × 10, reference sr/hr/bs/neutral)
  scripts/build-dataset-v2.ts          kako je dataset nastao (jednokratno; dataset se posle pokretanja ne menja)
  scripts/run-benchmark.ts             runner (stvarni model)
  results/                             svi rezultati; nikad se ne prepisuju
```

Dataset v1 (12 kategorija, `src/benchmark/sentences.ts`) ostaje nepromenjen. Runner za v1 je `npm run benchmark:v1`.

## Komande koje su stvarno izvršene (2026-11-10)

```bash
npm run model:install                      # preuzimanje + SHA-256 provera + tokenizer.json (398 MB)
npm run model:smoke                        # dokaz stvarne inference operacije
npx tsx benchmark/scripts/build-dataset-v2.ts
npm run benchmark -- --limit 5             # kratka proba
npm run benchmark                          # run 1 (bez podele na rečenice)
npm run benchmark                          # run 2 (sa podelom na rečenice; konačna ruta)
npm run test:model                         # 6/6 prolazi
```

Opcije runnera: `--beams N` (podrazumevano 4), `--dtype q8|fp32` (fp32 traži `npm run model:install -- --fp32`), `--limit N`, `--tokens ">>hrv<<,>>srp_Latn<<"`, `--dataset <path>`.

## Šta runner radi

1. **Stage 1, sirov izlaz modela:** za svaki jezički token (`hrv`, `bos_Latn`, `srp_Latn`, `srp_Cyrl`) prevodi svih 100 stavki, jednu po pozivu, posle posebnog zagrevanja. Meri latenciju po stavci.
2. **Stage 1b:** proverava da li batch (8 stavki) daje isti izlaz kao pojedinačni pozivi.
3. **Stage 2, kandidati po profilu (bez novog prevođenja):** popravka mojibake-a, transliteracija, lokalizacioni engine. Svaki kandidat beleži `steps`, pa se izlaz modela i naknadna obrada nikad ne mešaju.
4. Automatske metrike: chrF (korpus, po kategoriji, po rečenici) i automatske oznake (empty, garbage, untranslated, english-left, mojibake, digits-introduced, too-long/short, wrong-yat, pogrešno pismo).

## Sadržaj jednog rezultata (`results/<run-id>/`)

| Fajl | Sadržaj |
|---|---|
| `run.json` | datum, OS, CPU, RAM, GPU, runtime verzije, model (revizije, SHA-256 ONNX fajlova i `tokenizer.json`), verzija i heš dataseta, konfiguracija, vremena (učitavanje, prvi rezultat, prosek, medijana, p95), RSS, CPU, batch konzistentnost, metrike po tokenu i kandidatu, greške |
| `raw-outputs.csv` | sirov izlaz modela po tokenu |
| `eval-<kandidat>.csv` | obrazac za **ljudsku** ocenu (7 kriterijuma 1–5 + `critical_error`); kolone ocena su prazne |
| `checksums.json` | SHA-256 dataset fajla |

## Pokretanja

| Folder / fajl | Opis | Važeće? |
|---|---|---|
| `smoke-2026-11-10T19-55-15-334Z.json` | prvi smoke test | **Ne**: napravljen pre ispravke tokenizera (jezički token se cepao). Čuva se kao dokaz problema. |
| `2026-11-10T20-01-07-369Z-opus-q8-b4` | kratka proba, 5 stavki | Ne za poređenje: latencija prvog poziva uključuje učitavanje |
| `2026-11-10T20-01-48-711Z-opus-q8-b4` | **run 1**, 100 stavki, bez podele na rečenice | Da (osnova za poređenje) |
| `2026-11-10T20-05-28-674Z-opus-q8-b4` | **run 2**, 100 stavki, sa podelom na rečenice | **Da: konačni rezultati** |
| `smoke-2026-11-10T20-20-08-637Z.json` | smoke test sa konačnim provider kodom | Da |
| `browser-real-model-2026-11-10.json`, `…-run2.json` | pravi model u Edge-u kroz UI (`tests/e2e/real-model.e2e.mjs`), 2 pokretanja | Da |
| `../../benchmark-results/` | stari v1 rezultati TEST providera (faza 2) | Samo provera pipeline-a |

Tumačenje rezultata: `docs/TRANSLATION_QUALITY_REPORT.md`.

## Reproduktivnost na drugoj mašini

1. `npm ci`, pa `npm run model:install`. Fajlovi se proveravaju po SHA-256/git hešu, pa je model bit-identičan.
2. `npm run benchmark`. Dataset heš se upisuje u `run.json`.
3. Rezultati zavise od hardvera samo u delu performansi. Izlazi su deterministični za istu verziju runtime-a i istu konfiguraciju.

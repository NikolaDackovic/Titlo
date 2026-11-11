# Lokalni modeli — izbor, instalacija, ograničenja

Nijedan model se ne preuzima automatski. Prevod se izvršava isključivo lokalno.
Licence: `docs/MODEL_LICENSE_REVIEW.md` · Kvalitet: `docs/TRANSLATION_QUALITY_REPORT.md` · Benchmark: `benchmark/README.md`.

## 1. Izabrani model — status `Experimental`

| Stavka | Vrednost |
|---|---|
| Model | `Helsinki-NLP/opus-mt-tc-base-en-sh` (Marian transformer, 74 M parametara, izdanje 2021-04-20) |
| Revizija originala | HF commit `8a5d73fe1fbfa392a1d754f89fce0bfb8335d4ab` |
| ONNX | `TigreGotico/opus-mt-tc-base-en-sh-onnx` @ `83f8ae0fd714891f84e237b4fc32fda7620f2b1d` (konverzija trećeg lica, int8 encoder + merged decoder) |
| Licenca | CC-BY-4.0 (navođenje autora + oznaka izmena); distribucija: *Pending legal review* |
| Runtime | Transformers.js 4.3.2 → ONNX Runtime (Node: onnxruntime-node 1.30.0, CPU; browser: onnxruntime-web WASM u Web Worker-u) |
| Na disku | 398 MB (`%LOCALAPPDATA%\ExYuTitlStudio\models\Helsinki-NLP\opus-mt-tc-base-en-sh`) |
| Memorija (izmereno) | 0,47–0,72 GB vršni RSS (Node) |
| Brzina (izmereno, Ryzen 3 3200U) | ~190 ms medijana po titlu (Node); 1–2,9 s po titlu u browseru; učitavanje 6–12 s (Node) i 44–60 s (browser) |

### Jezička podrška — šta je dokumentovano, šta je potvrđeno, šta je pretpostavka

| Pitanje | A. Dokumentacija (model card) | B. Potvrđeno testom | C. Nepotvrđeno |
|---|---|---|---|
| EN → hrvatski | ✔ `>>hrv<<` | ✔ dosledan hrvatski (kruh, vlak, što, tko, futur „nazvat ću“) | kvalitet po ljudskoj oceni |
| EN → srpski latinica | ✔ `>>srp_Latn<<` | ✔ ekavica i srpska leksika, **ali** mojibake (æ za ć…) u 35/100 rečenica → aplikacija ga popravlja | — |
| EN → srpska ćirilica | ✔ `>>srp_Cyrl<<` | ✔ daje ćirilicu, ali sa halucinacijama („То је торба“); aplikacija zato koristi latinicu + transliteraciju | — |
| EN → bosanski | ✔ `>>bos_Latn<<` | ◐ ijekavica uz ekavske „klizeve“ u ~5% rečenica i srpski futur | — |
| EN → `hbs` (opšti) | ✔ naveden | ✘ neupotrebljiv („[4]“, „1.).“) | — |
| sr ↔ hr ↔ bs direktno | ✘ (izvor je samo engleski) | — | — |
| Kontekst više replika | ✘ (model radi na nivou rečenice) | potvrđeno: više rečenica odjednom → model gubi rečenice | — |
| ExYu Neutral | ✘ ne postoji takav token | ruta `bos_Latn` + lokalizacija radi, ali kvalitet nije validiran | da li je to „prirodan neutralni“ jezik |
| Morfologija, padeži, dijakritici | — | dijakritici ispravni (posle popravke), padeži uglavnom ispravni; greške u slaganju u pojedinim dugim rečenicama (`srp_Cyrl`, LNG-04) | sistematska ocena |

### Ispravke koje aplikacija mora da primeni (sve su u kodu i pokrivene testovima)

1. **`tokenizer.json` sa jezičkim tokenima kao `added_tokens`.** Bez toga Transformers.js v4 cepa `>>hrv<<` na delove i varijanta se ne bira. Generator: `src/translation/marianTokenizer.ts`. To je verna kopija zvanične Transformers.js 3.7.6 `marian.py`, uz još dve ispravke: pravi `unk_id` (47908 umesto konstante 2) i jezički tokeni.
2. **Podela na rečenice i replike** pre prevoda (`splitForModel`). Bez toga se rečenice gube (+3,4–3,9 chrF).
3. **Popravka mojibake-a** za `srp_Latn` (`repairMojibake`).
4. **Jedan ulaz po pozivu** (beam search u batch-u nije determinističan).
5. **`>>hbs<<` se nikad ne koristi.**

## 2. Instalacija (stvarno korišćen postupak, bez Pythona)

```bash
npm run model:install          # ~400 MB; svaki fajl se proverava po SHA-256 / git hešu
npm run model:smoke            # dokazuje stvarnu inference operaciju, rezultat ide u benchmark/results/
npm run test:model             # 6 testova sa stvarnim modelom
```

- Podrazumevana lokacija je **`%LOCALAPPDATA%\ExYuTitlStudio\models`**, a ne folder projekta, jer je projekat u OneDrive folderu i stotine MB bi se inače slale u cloud. Lokacija se menja promenljivom `EXYU_MODELS_DIR` ili sa `npm run model:install -- --dir <putanja>`. Dev i preview server i skripte koriste isto pravilo (`build/modelsDir.ts`).
- `--fp32` dodatno preuzima fp32 encoder/decoder (~540 MB) za poređenje kvaliteta.
- Posle instalacije u folderu postoji `MODEL_INFO.json`: izvori, revizije, SHA-256 svakog fajla, veličina, licenca, navođenje autora i opis izmena.
- U aplikaciji: **Models & Providers → Check availability / Load model now**.

### Opcija B — sopstvena zvanična konverzija (obavezno pre komercijalne distribucije)

ONNX težine iz opcije A nisu nezavisno verifikovane. Pre distribucije treba ih napraviti sami i uporediti izlaze na benchmarku:

```powershell
# Python 3.11 (python.org, "Install for current user" — admin nije potreban)
py -3.11 -m venv .venv-convert
.venv-convert\Scripts\activate
git clone --depth 1 --branch 3.7.6 https://github.com/huggingface/transformers.js
pip install -r transformers.js/scripts/requirements.txt    # ~2–3 GB (PyTorch)
cd transformers.js
python -m scripts.convert --quantize --model_id Helsinki-NLP/opus-mt-tc-base-en-sh
```

Posle toga `tokenizer.json` treba zameniti onim iz `npm run model:install` (ispravka jezičkih tokena), pa ponoviti `npm run benchmark` i uporediti `raw-outputs.csv`. Ovaj postupak **nije izvršen** na razvojnoj mašini (nema Pythona, a ima 3,4 GB RAM-a).

## 3. Ostali kandidati

| Model | Jezici (model card) | Licenca | Odluka |
|---|---|---|---|
| Helsinki-NLP/opus-mt-en-zls | EN → bos_Latn, hrv, srp_Latn, srp_Cyrl, bul, mkd, slv | Apache-2.0 | Rezerva; nije testiran. Isti provider radi uz drugi model id i instalaciju. |
| Helsinki-NLP/opus-mt-en-sla | EN → 19 slovenskih jezika, uklj. bos_Latn, hrv, srp_* | Apache-2.0 | Nije testiran; veći skup ciljeva, ista arhitektura |
| google/madlad400-3b-mt | „400+ jezika“, sr/hr/bs nisu izlistani | Apache-2.0 | 3 B parametara, ~1,65 GB q4; **preveliki za mašinu sa 3,4 GB RAM-a**; jezici nepotvrđeni |
| utter-project/EuroLLM-9B-Instruct | hrvatski da; srpski i bosanski nisu navedeni | Apache-2.0 | ~5,5 GB q4; **nepokretljiv na ovoj mašini**; opciono preko Local LLM providera |
| Qwen3-8B | jezici nisu izlistani | Apache-2.0 | isto kao EuroLLM |
| facebook/nllb-200 | da | CC-BY-NC-4.0 | **isključen** (nekomercijalna licenca) |

Prvi model nije zamenjen drugim, jer razlozi za loše rezultate (sleng i idiomi) nisu specifični za ovaj model. Ostali Marian modeli iz iste porodice imaju istu arhitekturu i slične podatke. Veći modeli (MADLAD, EuroLLM) verovatno bolje rade sa idiomima, ali ih ova mašina ne može pokrenuti.

## 4. Lokalni LLM (opciono, netestirano sa stvarnim serverom)

OpenAI-kompatibilan server samo na `localhost` (llama.cpp, Ollama, LM Studio). Protokol je testiran sa mock serverom. Kvalitet za sr/hr/bs nije izmeren. Zahteva 8–16 GB RAM-a.

## 5. Govor → tekst (Whisper)

| Model | Veličina (q8) | Revizija | Upotreba |
|---|---|---|---|
| `onnx-community/whisper-small` | ~250 MB | `36050c46d777d46dc4b5f43f6d90574fc38f8732` | Podrazumevano. Bolji za srpski, hrvatski i bosanski. |
| `onnx-community/whisper-base` | ~77 MB | `27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c` | Brži, manje tačan; dobar za jasan engleski govor. |

Instalacija (jednom, samo ovaj korak koristi internet):

```bash
npm run model:install:whisper
```

Skripta preuzima tačno navedene fajlove sa fiksne revizije, proverava veličinu i SHA-256 i piše `MODEL_INFO.json` (izvor, revizija, licenca, heš svakog fajla) u folder modela (`EXYU_MODELS_DIR` → `%LOCALAPPDATA%ExYuTitlStudiomodels` → `./models`). Aplikacija nikad ne preuzima model sama; ako model nedostaje, UI to kaže i prikazuje ovu komandu.

Status: **Experimental**. Tačnost transkripcije nije sistematski merena (nema WER benchmarka). Imena, sleng, preklapanje govornika i tihi delovi traže ručnu proveru. Brzina na CPU-u (WASM) zavisi od računara; na slabijem laptopu računajte 2–4× trajanje snimka za whisper-small (izmereno: 89 s srpskog govora za 326 s na Ryzen 3 3200U, 3,4 GB RAM).

## 6. Srpski / hrvatski / bosanski → engleski

| | |
|---|---|
| Model | `Helsinki-NLP/opus-mt-tc-big-sh-en` (revizija `94d3197e…`), ~236 M parametara, CC-BY-4.0 |
| ONNX | `TigreGotico/opus-mt-tc-big-sh-en-onnx` (revizija `f03f73cb…`), int8 enkoder (137 MB) + int8 dekoder bez KV keša (223 MB) |
| Instalacija | `npm run model:install:sh-en` (SHA-256 provera svakog fajla, `MODEL_INFO.json`) |
| Provera | `npm run model:smoke:sh-en` |
| Status | **Experimental** — kvalitet nije ocenjen od strane ljudi |

Tehnička napomena: int8 izvoz nema „merged“ dekoder sa KV kešom, a Transformers.js 4.3 dekoderu uvek šalje samo poslednji token (izlaz je bio „Hi I Welcome“). `patchNoKvCache` (`src/translation/providers/opusModels.ts`) zato u svakom koraku šalje ceo dosadašnji niz. To je sporije (kvadratno u dužini rečenice), ali tačno.

Primer stvarnog izlaza (Node, int8, 2026-11-11):

| Srpski | Engleski |
|---|---|
| Ćao, ja sam vaš AI asistent. Dobrodošli. | Hi, I'm your AI assistant. Welcome aboard. |
| Ovo je sajt za frizerski salon. | This is a hair salon website. |
| Mušterija postavlja pitanje, a bot sam odgovara. | The customer asks the question, and the bot answers it himself. |
| Gdje si bio sinoć? | Where were you last night? |

**Važno za oba smera:** `generate()` u Transformers.js 4.3 za seq2seq modele trenutno radi samo pohlepno (greedy) dekodiranje, pa se podešavanje „Beam search“ ne primenjuje. Ranija benchmark merenja treba tumačiti u tom svetlu.

# Pregled licenci — lokalni modeli (prevod i govor → tekst)

**Datum provere:** 2026-11-10 · **Pregledao:** razvojni tim (AI asistent), **nije pravni savet**.
**Status komercijalne distribucije: `Pending legal review`.**

## 1. Komponente koje učestvuju u prevodu

| Komponenta | Verzija / revizija | Licenca | Izvor |
|---|---|---|---|
| Model `Helsinki-NLP/opus-mt-tc-base-en-sh` (težine, `source.spm`, `target.spm`, `vocab.json`, config) | HF commit `8a5d73fe1fbfa392a1d754f89fce0bfb8335d4ab` (izdanje 2021-04-20, port 2022-10-11) | **CC-BY-4.0** | https://huggingface.co/Helsinki-NLP/opus-mt-tc-base-en-sh |
| ONNX konverzija `TigreGotico/opus-mt-tc-base-en-sh-onnx` | HF commit `83f8ae0fd714891f84e237b4fc32fda7620f2b1d` (2026-08-03) | CC-BY-4.0 (nasleđeno, označeno u repozitorijumu) | https://huggingface.co/TigreGotico/opus-mt-tc-base-en-sh-onnx |
| `tokenizer.json` | generiše ga `scripts/install-model.ts` iz originalnih fajlova | izveden iz CC-BY-4.0 fajlova | ovaj repozitorijum |
| Transformers.js (`@huggingface/transformers`) | 4.3.2 | Apache-2.0 | npm |
| `@huggingface/tokenizers` | 0.2.0 | Apache-2.0 | npm |
| ONNX Runtime (`onnxruntime-node` / `onnxruntime-web`) | 1.30.0 / 1.31.0-dev | MIT | npm |
| Originalni okvir za treniranje Marian NMT | — (ne distribuira se) | MIT | https://marian-nmt.github.io/ |

Proverene činjenice:
- `source.spm`, `target.spm` i `vocab.json` iz TigreGotico repozitorijuma **bit su identični** originalu (SHA-256 `e21a114e…`, `5af3b120…`, git blob `01c1cb1f…`).
- `config.json` ima iste arhitekturne parametre. `generation_config.json` (num_beams 6, bad_words_ids, forced_eos) je isti.
- ONNX težine nisu nezavisno verifikovane prema PyTorch originalu na ovoj mašini (za to su potrebni Python i PyTorch). TigreGotico objavljuje parity test na 2 rečenice (greedy i beam 4: identično).

## 2. Šta CC-BY-4.0 praktično znači za komercijalni desktop softver

Tekst licence: https://creativecommons.org/licenses/by/4.0/legalcode

| Pitanje | Odgovor | Praktično za Titlo |
|---|---|---|
| Komercijalna upotreba | **Dozvoljena** (Sec. 2(a)(1)) | Plaćena verzija aplikacije sme da koristi model. |
| Redistribucija | **Dozvoljena** (deljenje u izvornom ili izmenjenom obliku) | Model sme da se isporučuje uz aplikaciju ili da se preuzima posle instalacije. |
| Izmene (konverzija u ONNX, kvantizacija, `tokenizer.json`) | **Dozvoljene**, ali se moraju **označiti** (Sec. 3(a)(1)(B)) | U „About / Licenses“ i u `MODEL_INFO.json` navesti: „Converted to ONNX and quantized to int8; tokenizer.json generated. Original: Helsinki-NLP/opus-mt-tc-base-en-sh.“ |
| Navođenje autora | **Obavezno** (Sec. 3(a)(1)(A)): autor, napomena o autorskom pravu, link na licencu, napomena o odricanju garancije, link na izvor | Ekran sa licencama: „OPUS-MT, Language Technology Research Group, University of Helsinki, CC-BY-4.0“ + link. Uz isporučeni model ide fajl `LICENSE`/`MODEL_INFO.json`. Preporučeno je i navesti ONNX konverziju (TigreGotico). Autori traže citiranje dva rada (Tiedemann & Thottingal 2020; Tiedemann 2020). |
| Dodatna ograničenja / DRM | **Zabranjeno** nametati uslove ili tehničke mere koje primaocu ograničavaju prava iz licence nad modelom (Sec. 2(a)(5)(B)) | **Model fajl se ne sme šifrovati niti zaključati licencnim ključem** tako da korisnik ne može da ga koristi pod CC-BY uslovima. Aplikacija sme da bude zatvorenog koda i plaćena; model mora ostati dostupan pod CC-BY. |
| Garancija | Nema (Sec. 5) | Kvalitet je naša odgovornost prema kupcima. |
| Endorsement | Ne sme da se sugeriše da autori podržavaju proizvod (Sec. 2(a)(6)… i 3(a)(1)(A)(i)) | Bez formulacija tipa „u saradnji sa Univerzitetom u Helsinkiju“. |

Apache-2.0 (Transformers.js, tokenizers): komercijalna upotreba i redistribucija su dozvoljene. Pri distribuciji treba priložiti tekst licence i sačuvati eventualne `NOTICE` fajlove; u paketima nije pronađen `NOTICE` fajl, samo `LICENSE`. MIT (ONNX Runtime, sql.js…): priložiti copyright i tekst licence.

## 3. Zaključak

| Upotreba | Ocena |
|---|---|
| Lična / razvojna upotreba | **Dozvoljeno** |
| Komercijalna upotreba (prevod u plaćenoj aplikaciji) | **Dozvoljeno po CC-BY-4.0**, uz navođenje autora i oznaku izmena |
| Distribucija modela uz aplikaciju | **Dozvoljeno po CC-BY-4.0**, ali status je **`Pending legal review`** zbog otvorenih pitanja ispod. Do tada se model **ne pakuje** u aplikaciju; korisnik ga instalira skriptom (`npm run model:install`). |

## 4. Otvorena pitanja (potrebna pravna provera)

1. **Podaci za treniranje.** Model je treniran na OPUS korpusima i back-translation-u (`opus+bt`). Pojedinačni OPUS korpusi imaju različite licence (npr. OpenSubtitles, korpusi sa nekomercijalnim uslovima). Autori su težine objavili pod CC-BY-4.0. Da li licence podataka utiču na komercijalnu upotrebu težina, nije pravno razjašnjeno, i to je opšte pitanje za MT modele.
2. **Poreklo ONNX konverzije.** Konverzija je delo trećeg lica. Licencno je u redu (CC-BY-4.0 dozvoljava izvedene oblike), ali tehnički integritet težina nije nezavisno potvrđen. **Pre komercijalne distribucije uraditi sopstvenu konverziju** zvaničnom skriptom (opcija B, `docs/MODELS.md`) i uporediti izlaze.
3. **Tačan oblik navođenja autora** u UI-ju i installer-u (format, mesto). Preporuka je ekran „About → Third-party licenses“ i `THIRD_PARTY_NOTICES.txt` u installer-u.
4. `onnxruntime-web` je razvojno izdanje (`1.31.0-dev`), što je tehnički, ne licencni rizik. Pre izdanja treba preći na stabilnu verziju.

## 5. Ostali kandidati (licence)

| Model | Licenca | Komercijalno | Napomena |
|---|---|---|---|
| Helsinki-NLP/opus-mt-en-zls | Apache-2.0 | Da | Treba sačuvati LICENSE/NOTICE |
| Helsinki-NLP/opus-mt-en-sla | Apache-2.0 | Da | — |
| google/madlad400-3b-mt | Apache-2.0 | Da | Spisak jezika nije potvrđen na model card-u |
| utter-project/EuroLLM-9B-Instruct | Apache-2.0 (gated pristup) | Da | Za preuzimanje se prihvataju uslovi na HF-u |
| facebook/nllb-200 | CC-BY-NC-4.0 | **Ne** | Isključen |

## 6. Whisper (govor → tekst)

Provereno 2026-11-11 preko HF API-ja (`https://huggingface.co/api/models/<repo>`, polje `cardData.license`) i GitHub repozitorijuma OpenAI-ja.

| Komponenta | Revizija | Oznaka licence | Status |
|---|---|---|---|
| Whisper kod i težine, GitHub `openai/whisper` | — | **MIT** | Komercijalna upotreba i redistribucija dozvoljene uz copyright i tekst licence |
| `openai/whisper-small` na HF (izvor small konverzije) | `973afd24` | Apache-2.0 | Na HF-u ista težina nosi Apache-2.0, a na GitHubu MIT. Obe dozvoljavaju komercijalnu upotrebu; razliku treba pravno potvrditi |
| `openai/whisper-large-v3-turbo` na HF | `41f01f3f` | MIT | Nije preuzet |
| ONNX `onnx-community/whisper-base` (instaliran) | `27a07b4b…` | Apache-2.0 | Konverzija trećeg lica |
| ONNX `onnx-community/whisper-small` (instaliran, podrazumevani) | `36050c46…` | **Bez oznake** | `Pending legal review` |
| ONNX `onnx-community/whisper-tiny` (kandidat) | `ff417702` | **Bez oznake** | Nije preuzet · `Pending legal review` |
| ONNX `Xenova/whisper-medium` (kandidat) | `8c5b9088` | Apache-2.0 | Nije preuzet (zabrana zbog RAM-a) |
| ONNX `onnx-community/whisper-large-v3-turbo` (kandidat) | `360ebcde` | **Bez oznake** | Nije preuzet (zabrana zbog RAM-a) · `Pending legal review` |

Konverzija u ONNX i kvantizacija (int8) ne menjaju poreklo težina, ali repozitorijum konverzije može imati svoje
uslove. Ako oznake nema, to ne znači automatski da važi licenca originala.

Zaključak: lokalna lična i komercijalna upotreba po licenci originalnih težina je dozvoljena. **Uključivanje modela u
komercijalni installer: `Pending legal review`** za sve konverzije bez oznake (small, tiny, turbo). Alternativa je
sopstvena konverzija iz `openai/whisper-*` (MIT/Apache-2.0) uz zapis o izmenama. Do tada korisnik instalira model
skriptom `npm run model:install:whisper`.

## 6a. Runtime, alati i podaci za speech benchmark

| Komponenta | Licenca | Uloga | Ide u aplikaciju? |
|---|---|---|---|
| Transformers.js `@huggingface/transformers` 4.3.2 | Apache-2.0 | Runtime modela (aplikacija) | Da |
| `onnxruntime-web` 1.31.0-dev | MIT | WASM izvršavanje (aplikacija) | Da |
| `puppeteer-core` 24 | Apache-2.0 | Samo pokretanje benchmarka (`--no-save`, nije u `package.json`) | Ne |
| Microsoft Edge | Vlasnički (Microsoft) | Samo za benchmark (headless) | Ne |
| Windows TTS glasovi Zira/David (SAPI 5) | Deo licence Windowsa | Generisanje sintetičkih test uzoraka | Ne |
| Sintetički WAV uzorci u `benchmark/speech/audio/` | Tekstovi pisani za projekat; zvuk napravljen Windows glasovima | Lokalno testiranje | **Ne redistribuirati javno dok se ne proveri: `Pending legal review`**. Uslovi Windowsa za javnu distribuciju zvuka napravljenog sistemskim glasovima nisu provereni |
| Snimci korisnika (`datasets/local-demo.json`) | Vlasništvo korisnika | Samo lokalna demonstracija | Ne (putanje van repozitorijuma, fajlovi se ne kopiraju) |

## 7. Srpski/hrvatski/bosanski → engleski

| Komponenta | Revizija | Licenca |
|---|---|---|
| `Helsinki-NLP/opus-mt-tc-big-sh-en` (težine, tokenizer) | `94d3197eab7df79725c8e7f59d23895092d39210` | **CC-BY-4.0** (navođenje autora, oznaka izmena) |
| ONNX `TigreGotico/opus-mt-tc-big-sh-en-onnx` | `f03f73cb195457d199f00d88df0f8ce99eb52937` | Repozitorijum nosi oznaku Apache-2.0; težine su izvedene iz CC-BY-4.0, pa važe uslovi CC-BY-4.0 |

Ista pravila kao za en→sh model (sekcije 2–4): komercijalna upotreba dozvoljena uz navođenje autora; distribucija uz aplikaciju **Pending legal review**; korisnik instalira model skriptom.

## 8. Izvori

- Model card: https://huggingface.co/Helsinki-NLP/opus-mt-tc-base-en-sh (README, `license: cc-by-4.0`)
- HF API (revizije, veličine, SHA-256): `https://huggingface.co/api/models/<repo>?blobs=true`
- ONNX konverzija: https://huggingface.co/TigreGotico/opus-mt-tc-base-en-sh-onnx
- CC-BY-4.0 legal code: https://creativecommons.org/licenses/by/4.0/legalcode
- Transformers.js konverziona skripta (referenca za `tokenizer.json`): https://github.com/huggingface/transformers.js/blob/3.7.6/scripts/extra/marian.py
- OPUS: https://opus.nlpl.eu/ · Tatoeba Challenge: https://github.com/Helsinki-NLP/Tatoeba-Challenge

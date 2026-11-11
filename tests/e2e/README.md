# Browser E2E testovi (Edge)

Nisu deo `npm test`. Treba im `puppeteer-core`, koji se namerno ne dodaje u `package.json` (koristi se samo za ručne provere):

```powershell
npm i --no-save puppeteer-core@24
npm run dev
# zaseban Edge sa novim profilom i DevTools portom 9333:
Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList "--headless=new","--remote-debugging-port=9333","--user-data-dir=$env:TEMP\exyu-e2e-$(Get-Date -Format HHmmss)","about:blank"
node tests/e2e/app.e2e.mjs          # 27 provera celog UI toka (TEST provider)
node tests/e2e/real-model.e2e.mjs   # stvarni model u browseru (traži npm run model:install)
```

Skripte očekuju `test.srt` u istom folderu i pišu snimke ekrana pored sebe. Svaki test pokrenuti sa **novim** Edge profilom, jer baza ostaje u IndexedDB-u tog profila.

## Kontrola kvaliteta transkripcije (Titlo)

```powershell
npx tsx tests/e2e/make-qc-wav.ts      # sintetički snimak: TTS govor + 35 s tišine + TTS govor
node tests/e2e/qc-review.e2e.mjs      # pokreće sopstveni headless Edge (port 9336, novi profil) i zatvara ga na kraju
```

28 provera: ime Titlo, stranica Terminologija, Whisper base transkripcija, QC upozorenja, klik na upozorenje
(selekcija, playhead, fokus), ▶ sa 1,5 s konteksta, ručna izmena → „Izmenili ste“, „Provereno“, upozorenje
pre prevoda, prevod (OPUS-MT), zastareo prevod, sačuvan ručni prevod i 5 širina (1920/1440/1024/768/390).
Traži instaliran Whisper base i OPUS-MT model.

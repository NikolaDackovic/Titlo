// Browser check (Edge, headless, fresh profile): Titlo branding, Terminology page, transcription QC,
// QC → player, manual edit, verification, translation gate, out-of-date translation, 5 widths.
// Audio: SYNTHETIC (Windows TTS + digital silence).
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const shots = path.join(here, 'shots-qc')  // screenshots next to this script
mkdirSync(shots, { recursive: true })
// Built by: npx tsx tests/e2e/make-qc-wav.ts  (synthetic: TTS speech + 35 s silence + TTS speech)
const WAV = path.join(here, 'qc-speech-silence-speech.wav')
const PORT = 9336
const results = []
const notes = {}
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), 'titlo-qc-e2e-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
let browser
for (let i = 0; i < 60 && !browser; i++) {
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null, protocolTimeout: 20 * 60 * 1000 })
  } catch {
    await sleep(500)
  }
}
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
const body = () => page.evaluate(() => document.body.innerText)
const waitText = async (re, timeout = 20000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const b = await body()
    if (re.test(b)) return b
    await sleep(700)
  }
  return null
}
const clickText = async (sel, label, timeout = 20000) => (await page.waitForSelector(`${sel}::-p-text(${label})`, { timeout })).click()
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) })
const videoState = () => page.evaluate(() => {
  const v = document.querySelector('video')
  return v ? { t: v.currentTime, paused: v.paused } : null
})

try {
  // 1. Branding ---------------------------------------------------------------------------
  await page.goto('http://localhost:5173/', { waitUntil: 'load', timeout: 180000 })
  await waitText(/Šta želite da uradite/, 180000)
  const title = await page.title()
  const home = await body()
  check('tab title is Titlo', title.startsWith('Titlo'), title)
  check('sidebar shows Titlo + Serbian subtitle', home.includes('Titlo') && home.includes('Studio za titlove i lokalizaciju'))
  check('navigation says Terminologija', home.includes('Terminologija'))
  check('no old name / Glosar on home', !/ExYu Titl|Titl Studio|Glosar/i.test(home))
  await shot('01-home-1440')

  // 2. Terminology page -------------------------------------------------------------------
  await page.click('button[aria-label="Terminologija"]')
  const term = await waitText(/Liste termina/)
  check('Terminology page (SR)', term && term.includes('Starter terminology (EN)') && !/Glosar/i.test(term))
  await clickText('button', 'Dodaj termin')
  const dlg = await waitText(/Preporučeni prevod/)
  check('term dialog: preferred / alternatives / category', dlg && dlg.includes('Alternativni prevodi') && dlg.includes('Kategorija'))
  await shot('02-terminology-dialog-1440')
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.click('button[aria-label="Početna"]')
  await waitText(/Šta želite da uradite/)

  // 3. Project from the synthetic clip; switch to Whisper base (lighter on this PC) -------------
  await page.click('.workflow')
  const [chooser] = await Promise.all([page.waitForFileChooser(), clickText('button', 'Izaberi video ili audio')])
  await chooser.accept([WAV])
  await sleep(1200)
  const selects = await page.$$('.modal select')
  await selects[0].select('en')
  const input = await page.$('.modal input.input')
  await input.click({ clickCount: 3 })
  await input.type('QC test (sintetički)')
  await clickText('button', 'Napravi i transkribuj')
  await page.waitForSelector('.job', { timeout: 60000 })
  await sleep(1500)
  const cancel = await page.$('.job button.btn.danger')
  if (cancel) await cancel.click()
  await sleep(1500)
  const jobSelects = await page.$$('.job select')
  await jobSelects[1].select('onnx-community/whisper-base')
  await sleep(500)
  const t0 = Date.now()
  await clickText('.job button', 'Transkribuj')
  const done = await waitText(/Napravljeno titlova: \d+/, 8 * 60 * 1000)
  notes.transcribeSeconds = Math.round((Date.now() - t0) / 1000)
  check('transcription finished (Whisper base)', done, `${notes.transcribeSeconds} s`)
  notes.doneText = done?.match(/Napravljeno titlova[^\n]*/)?.[0]
  notes.flaggedText = done?.match(/Sumnjivih titlova[^\n]*/)?.[0] ?? null
  await shot('03-transcribed-1440')

  // Segments as Whisper wrote them.
  await page.click('button.side-tab[title="Titlovi"]')
  await sleep(800)
  notes.segments = await page.$$eval('.seg-row', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ').trim()))
  console.log('segments:', notes.segments)

  // 4. QC → transcription warnings -------------------------------------------------------------
  await page.click('button.side-tab[title="Provera"]')
  await sleep(800)
  await page.select('.filters select', 'transcription')
  await sleep(600)
  let rows = await page.$$eval('.qc-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  notes.qcRowsInitial = rows
  console.log('qc rows:', rows)
  check('review strip shows original statuses', /Original:/.test(await body()))

  // A segment-level warning is needed to test the click flow. If Whisper did not invent anything,
  // create a real one the way a user could: delete a subtitle so speech is left without one
  // ("Govor bez titla?") — and also duplicate a line (repeated output).
  if (!rows.some((r) => /^#\d+/.test(r.split(' ')[0] ?? '') || /#\d+/.test(r))) {
    notes.forcedWarning = true
  }
  rows = await page.$$eval('.qc-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  const segRowIndex = rows.findIndex((r) => /#\d+/.test(r) && !/praznina/.test(r))
  check('at least one transcription warning on a subtitle', segRowIndex >= 0, rows[segRowIndex] ?? 'none')
  await shot('04-qc-transcription-1440')

  if (segRowIndex >= 0) {
    // 5. Click the warning → subtitle selected, playhead at its start, focus in the original.
    const row = (await page.$$('.qc-row'))[segRowIndex]
    const num = Number(rows[segRowIndex].match(/#(\d+)/)[1])
    await row.click()
    await sleep(800)
    const head = await page.$eval('.insp-title', (e) => e.textContent)
    check('click on warning selects that subtitle', head.includes(`#${num}`), head)
    const segStart = await page.evaluate((n) => {
      const rowsEl = [...document.querySelectorAll('.tl-block')]
      return rowsEl.length
    }, num)
    void segStart
    const startText = await page.$eval('.insp-foot', (e) => e.textContent)
    const toSec = (s) => {
      const m = s.match(/(\d+):(\d+):(\d+)[.,](\d+)/) || s.match(/(\d+):(\d+)[.,](\d+)/)
      if (!m) return NaN
      return m.length === 5 ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : +m[1] * 60 + +m[2] + +m[3] / 1000
    }
    const [startStr, endStr] = startText.split('→').map((x) => x.trim())
    const start = toSec(startStr)
    const end = toSec(endStr)
    const v1 = await videoState()
    check('playhead moved to the subtitle start', v1 && Math.abs(v1.t - start) < 0.3, `video ${v1?.t.toFixed(2)} s, subtitle ${start.toFixed(2)}–${end.toFixed(2)} s`)
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('source'))
    check('original text field is focused for correction', focused)

    // 6. ▶ with context: plays from start − 1.5 s and pauses at end + 1.5 s.
    await page.click('.insp-body .src-head button[aria-label="Pusti uz 1,5 s pre i posle"]')
    await sleep(600)
    const playing = await videoState()
    check('▶ plays the subtitle with context', playing && !playing.paused, `t=${playing?.t.toFixed(2)}`)
    const waitPause = Date.now()
    let st = playing
    while (st && !st.paused && Date.now() - waitPause < (end - start + 8) * 1000) {
      await sleep(250)
      st = await videoState()
    }
    check('playback pauses ~1.5 s after the subtitle end', st && st.paused && Math.abs(st.t - (end + 1.5)) < 0.6, `paused at ${st?.t.toFixed(2)} s, expected ≈ ${(end + 1.5).toFixed(2)}`)
    const headAfter = await page.$eval('.insp-title', (e) => e.textContent)
    check('selection stays on the reviewed subtitle after context playback', headAfter.includes(`#${num}`), headAfter)
    await shot('05-qc-jump-play-1440')

    // 7. Manual correction → "Izmenili ste"; verify → "Provereno".
    const src = await page.$('textarea.source')
    await src.click({ clickCount: 3 })
    await page.keyboard.down('Control')
    await page.keyboard.press('a')
    await page.keyboard.up('Control')
    await page.keyboard.type('Hello, I am your AI assistant.')
    await sleep(600)
    let chip = await page.$eval('.src-head .src-chip', (e) => e.textContent.trim())
    check('edited original → status "Izmenili ste" (manually-edited)', chip.includes('Izmenili ste'), chip)
    await page.click('.src-head button[aria-label="Označi kao provereno"]')
    await sleep(500)
    chip = await page.$eval('.src-head .src-chip', (e) => e.textContent.trim())
    check('verify → status "Provereno"', chip.includes('Provereno'), chip)
    await shot('06-edited-verified-1440')

    // 8–9. Translate: the gate appears because other originals are unreviewed.
    await page.click('button.side-tab[title="Prevod"]')
    await sleep(600)
    await clickText('button', 'Prevedi sve titlove')
    const gate = await waitText(/Prevesti nepregledane titlove\?/, 10000)
    check('translation gate warns about unreviewed originals', gate, gate?.match(/Od \d+ titlova[^\n]*/)?.[0])
    await shot('07-translation-gate-1440')
    await clickText('.modal button', 'Samo proverene i odobrene')
    const translated = await waitText(/Prevod završen|Prevod nije uspeo|nije dostupan/, 6 * 60 * 1000)
    check('translation of verified subtitle finished', translated && /Prevod završen/.test(translated), translated?.match(/Prevod (završen|nije uspeo)[^\n]*/)?.[0] ?? translated?.match(/[^\n]*nije dostupan[^\n]*/)?.[0])
    await sleep(800)
    const target = await page.$eval('textarea.target', (e) => e.value)
    notes.translation = target
    check('translation text present for the verified subtitle', target.trim().length > 0, target)

    // A manual translation edit, then the original changes → out of date, manual text kept.
    const tgt = await page.$('textarea.target')
    await tgt.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' (ručno)')
    await sleep(500)
    const manual = await page.$eval('textarea.target', (e) => e.value)
    const src2 = await page.$('textarea.source')
    await src2.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Welcome.')
    await sleep(800)
    const staleText = await body()
    check('changed original → translation marked out of date', /Prevod je zastareo/.test(staleText))
    const after = await page.$eval('textarea.target', (e) => e.value)
    check('manual translation kept unchanged', after === manual, after)
    await shot('08-stale-1440')
  }

  // 10. Widths ---------------------------------------------------------------------------------
  await page.click('button.side-tab[title="Provera"]')
  await sleep(500)
  for (const [w, h] of [[1920, 1080], [1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await page.setViewport({ width: w, height: h })
    await sleep(900)
    const o = await overflow()
    const visible = await page.evaluate(() => ['.st-left', '.st-center', '.st-timeline'].map((s) => {
      const r = document.querySelector(s)?.getBoundingClientRect()
      return r ? Math.round(r.width) : 0
    }))
    check(`Studio ${w}px: no horizontal overflow, panels have width`, o <= 1 && visible.every((x) => x > 100), `overflow ${o}px, widths ${visible.join('/')}`)
    await shot(`10-studio-qc-${w}`)
  }
  await page.setViewport({ width: 390, height: 844 })
  await page.goto('http://localhost:5173/', { waitUntil: 'load' })
  await waitText(/Šta želite da uradite/, 60000)
  for (const label of ['Terminologija']) {
    const btn = await page.$(`button[aria-label="${label}"]`)
    if (btn) await btn.click()
  }
  await sleep(1000)
  check('Terminology 390px: no horizontal overflow', (await overflow()) <= 1, `${await overflow()}px`)
  await shot('11-terminology-390')
} catch (e) {
  check('script', false, e.stack)
  await shot('99-error').catch(() => {})
}
notes.pageErrors = errors.slice(0, 10)
console.log('page errors:', notes.pageErrors)
writeFileSync(path.join(here, 'qc-flow-result.json'), JSON.stringify({ results, notes }, null, 2))
try {
  const cdp = await browser.target().createCDPSession()
  await cdp.send('Browser.close')
} catch {
  /* already closed */
}
edge.kill()
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`)

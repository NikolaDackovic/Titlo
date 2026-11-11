// Browser (Edge, headless) end-to-end test with the REAL local model through the app UI.
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const shots = path.join(here, 'shots-real')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const edgeMemoryMb = (profileHint) => {
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${profileHint}*' } | Measure-Object -Property WorkingSetSize -Sum).Sum"`, { encoding: 'utf8' })
    return Math.round(Number(out.trim()) / 1024 / 1024)
  } catch {
    return null
  }
}

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null })
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 950 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const waitText = async (needle, timeout = 10000) => {
  try {
    await page.waitForFunction((n) => document.body.innerText.toLowerCase().includes(n.toLowerCase()), { timeout, polling: 500 }, needle)
    return true
  } catch {
    return false
  }
}
const clickText = async (sel, label) => (await page.waitForSelector(`${sel}::-p-text(${label})`, { timeout: 10000 })).click()

const report = { date: new Date().toISOString(), runtime: 'browser: Transformers.js + onnxruntime-web (WASM) in a Web Worker, Edge headless' }
try {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await waitText('Quick actions')
  await clickText('button', 'New project')
  const [chooser] = await Promise.all([page.waitForFileChooser(), clickText('button', 'Choose subtitle file')])
  await chooser.accept([path.join(here, 'test.srt')])
  await waitText('4 subtitles')
  const selects = await page.$$('.modal select')
  await selects[2].select('sr-Cyrl')
  const name = await page.$('.modal input.input')
  await name.click({ clickCount: 3 })
  await name.type('Real model test')
  await clickText('button', 'Create project')
  await waitText('Segment #1')

  // Load the model through the Models page
  await page.click('.rail-btn[aria-label="Models & Providers"]')
  await waitText('Load model now')
  const before = edgeMemoryMb('9333')
  const t0 = Date.now()
  await clickText('button', 'Load model now')
  check('UI shows "Loading model…"', await waitText('Loading model', 20000))
  const ready = await waitText('Model ready', 400000)
  report.browserModelLoadMs = Date.now() - t0
  check('Model loads in the browser worker', ready, `${(report.browserModelLoadMs / 1000).toFixed(1)} s`)
  report.edgeWorkingSetMbBefore = before
  report.edgeWorkingSetMbAfterLoad = edgeMemoryMb('9333')
  await page.screenshot({ path: path.join(shots, '01-models-ready.png') })

  // Translate the project
  await page.click('.rail-btn[aria-label="Translation Studio"]')
  await waitText('Segment #1')
  await clickText('button.tab', 'Translation')
  check('Panel says translation runs locally', await waitText('Runs locally on this computer'))
  const t1 = Date.now()
  await clickText('button', 'Translate project')
  const finished = await waitText('Translation finished', 400000)
  report.browserTranslateMs = Date.now() - t1
  check('Real translation job finishes in the browser', finished, `${(report.browserTranslateMs / 1000).toFixed(1)} s for 4 subtitles`)
  report.edgeWorkingSetMbAfterTranslate = edgeMemoryMb('9333')
  const rows = await page.$$eval('.seg-row .text', (els) => els.map((e) => e.textContent))
  report.outputs = rows
  console.log('Outputs:', rows)
  check('Outputs are Cyrillic model translations (no TEST marker, no source text)', rows.length === 4 && rows.every((r) => /[Ѐ-ӿ]/.test(r) && !r.includes('TEST')), JSON.stringify(rows))
  await clickText('button.tab', 'Quality control')
  await page.screenshot({ path: path.join(shots, '02-studio-translated.png') })
} catch (error) {
  check('Script ran without exceptions', false, error.message)
  await page.screenshot({ path: path.join(shots, 'error.png') })
} finally {
  check('No uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  report.checks = results
  writeFileSync(path.join(here, 'real-model-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ load: report.browserModelLoadMs, translate: report.browserTranslateMs, mem: [report.edgeWorkingSetMbBefore, report.edgeWorkingSetMbAfterLoad, report.edgeWorkingSetMbAfterTranslate] }))
  await browser.close()
  process.exit(results.some((r) => !r.ok) ? 1 : 0)
}

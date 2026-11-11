// End-to-end test of Titlo in Microsoft Edge (headless) via puppeteer-core.
import puppeteer from 'puppeteer-core'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const URL = 'http://localhost:5173/'
const shots = path.join(here, 'shots')
const downloads = path.join(here, 'downloads')
const profileDir = path.join(here, `edge-profile-${Date.now()}`)
rmSync(downloads, { recursive: true, force: true })

mkdirSync(shots, { recursive: true })
mkdirSync(downloads, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Edge is started separately (PowerShell) with --remote-debugging-port=9333 and a fresh profile.
void EDGE
void profileDir
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null })
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 950 })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(`console: ${m.text()}`))
page.on('response', (r) => r.status() === 404 && !r.url().includes('/models/') && errors.push(`404: ${r.url()}`))
const cdp = await browser.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })

// Force the download path for exports (no native save dialog in headless) and seed a v0.1 project once.
await page.evaluateOnNewDocument(() => {
  delete window.showSaveFilePicker
  if (!localStorage.getItem('e2e-seeded')) {
    localStorage.setItem('e2e-seeded', '1')
    localStorage.setItem('exyu-titl-studio-projects', JSON.stringify([
      { id: 'project-demo', name: 'Demo Film Localisation', segments: [{ sourceText: 'The car is waiting outside.' }, { sourceText: 'We need to see the apartment tonight.' }, { sourceText: 'The train leaves at sunrise.' }] },
      { id: 'old1', name: 'Stari projekat', languageProfile: 'Croatian', sourceLanguage: 'en', contentType: 'Movie', fileName: 'old.srt', segments: [{ startTime: 0, endTime: 1500, sourceText: 'Hello', translatedText: 'Bok', isLocked: false }] },
    ]))
  }
})

const text = () => page.evaluate(() => document.body.innerText)
const clickText = async (selector, label) => {
  const el = await page.waitForSelector(`${selector}::-p-text(${label})`, { timeout: 8000 })
  await el.click()
  return el
}
const waitText = async (needle, timeout = 8000) => {
  try {
    await page.waitForFunction((n) => document.body.innerText.toLowerCase().includes(n.toLowerCase()), { timeout }, needle)
    return true
  } catch {
    return false
  }
}
const translationArea = () => page.$$eval('.editor textarea', (els) => els[1]?.value ?? null)

try {
  // 1. Boot + legacy migration
  await page.goto(URL, { waitUntil: 'networkidle0' })
  check('App boots to dashboard', await waitText('Quick actions', 3000))
  check('v0.1 localStorage project migrated (demo skipped)', await waitText('Projects migrated to SQLite'), (await text()).includes('Stari projekat (v0.1)') ? 'Stari projekat (v0.1) listed' : 'not listed')
  check('Demo project not migrated', !(await text()).includes('Demo Film Localisation'))
  await page.screenshot({ path: path.join(shots, '01-dashboard.png') })

  // 2. New project with SRT import
  await clickText('button', 'New project')
  const [chooser] = await Promise.all([page.waitForFileChooser(), clickText('button', 'Choose subtitle file')])
  await chooser.accept([path.join(here, 'test.srt')])
  check('SRT parsed (4 valid cues)', await waitText('4 subtitles'))
  check('Invalid block reported, not silently dropped', await waitText('Invalid timing'))
  await page.screenshot({ path: path.join(shots, '02-new-project.png') })
  const nameInput = await page.$('.modal input.input')
  await nameInput.click({ clickCount: 3 })
  await nameInput.type('E2E film')
  await page.select('.modal select:nth-of-type(1)', 'movie').catch(() => {})
  const selects = await page.$$('.modal select')
  await selects[2].select('sr-Latn')
  await clickText('button', 'Create project')
  check('Studio opens with 4 segments', await waitText('Segment #1'), `${(await page.$$('.seg-row')).length} rows`)
  check('Multi-line source preserved', (await page.$$eval('.editor textarea', (els) => els[0].value)) === 'You know what?\nI never trusted him.')

  // 3. Manual edit + autosave
  await page.click('.editor textarea:nth-of-type(1)').catch(() => {})
  const areas = await page.$$('.editor textarea')
  await areas[1].click()
  await areas[1].type('Znaš šta, Ljubo?\nNikad mu nisam verovao.')
  await sleep(1500)
  check('Autosave indicator shows Saved', (await text()).includes('Saved'))

  // 4. Honest provider check: OPUS-MT not installed
  await clickText('button.tab', 'Translation')
  await clickText('button', 'Translate project')
  check('Missing model reported honestly', await waitText('Model files not found'))
  await page.screenshot({ path: path.join(shots, '03-studio-missing-model.png') })

  // 5. QC shows overlap and missing translations
  await clickText('button.tab', 'Quality control')
  check('QC detects overlap', await waitText('Overlapping subtitles'))

  // 6. Generate Cyrillic from Latin, switch profile
  await clickText('button.tab', 'Tools')
  await clickText('button', 'Generate from Serbian Latin')
  await page.select('.studio-toolbar select', 'sr-Cyrl')
  await sleep(300)
  const cyr = await translationArea()
  check('Cyrillic transliteration (lj→љ, š→ш)', cyr === 'Знаш шта, Љубо?\nНикад му нисам веровао.', JSON.stringify(cyr))

  // 7. Export SRT Cyrillic
  await page.keyboard.down('Control'); await page.keyboard.press('KeyE'); await page.keyboard.up('Control')
  await waitText('Export subtitles')
  await page.screenshot({ path: path.join(shots, '04-export.png') })
  await clickText('.modal-foot button', 'Export')
  await sleep(1500)
  const files = readdirSync(downloads).filter((f) => f.endsWith('.srt'))
  check('SRT file exported', files.length === 1, files.join(', '))
  if (files[0]) {
    const content = readFileSync(path.join(downloads, files[0]), 'utf8')
    check('Export is UTF-8 Cyrillic with original timing', content.startsWith('1\r\n00:00:01,000 --> 00:00:03,500\r\nЗнаш шта, Љубо?\r\nНикад му нисам веровао.\r\n'), JSON.stringify(content.slice(0, 90)))
    check('Export keeps formatting tags and renumbers', content.includes('2\r\n00:00:03,400 --> 00:00:05,000\r\n<i>Not even once.</i>') && content.includes('\r\n4\r\n00:00:10,500'))
    check('Export keeps Cyrillic/diacritics from source fallback', content.includes('Đorđe: Šta ćeš? Љубав!'))
  }

  // 8. Localization proposals on Croatian
  await page.select('.studio-toolbar select', 'hr')
  await page.keyboard.down('Alt'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Alt')
  await sleep(200)
  const a2 = await page.$$('.editor textarea')
  await a2[1].click()
  await a2[1].type('Voz kasni, kupi hleb.')
  await clickText('button.tab', 'Localization')
  check('Localization proposes voz→Vlak', await waitText('Vlak'))
  await page.screenshot({ path: path.join(shots, '05-localization.png') })
  await page.$$eval('button', (bs) => Array.from(bs).find((b) => b.textContent.includes('high-confidence')).click())
  await sleep(300)
  const hr = await translationArea()
  check('Accepted proposals applied (vlak, kruh)', hr === 'Vlak kasni, kupi kruh.', JSON.stringify(hr))
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control')
  await sleep(200)
  check('Undo reverts localization', (await translationArea()) === 'Voz kasni, kupi hleb.', JSON.stringify(await translationArea()))
  await page.keyboard.down('Control'); await page.keyboard.press('KeyY'); await page.keyboard.up('Control')
  await sleep(1200)

  // 9. Reload → persistence
  await page.reload({ waitUntil: 'networkidle0' })
  await waitText('Recent projects')
  await clickText('td strong', 'E2E film')
  await waitText('Segment #1')
  await page.select('.studio-toolbar select', 'sr-Cyrl').catch(() => {})
  await sleep(300)
  check('After reload: Cyrillic translation persisted', (await translationArea()) === 'Знаш шта, Љубо?\nНикад му нисам веровао.')
  await page.select('.studio-toolbar select', 'hr')
  await page.keyboard.down('Alt'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Alt')
  await sleep(300)
  check('After reload: Croatian edit persisted (redo applied)', (await translationArea()) === 'Vlak kasni, kupi kruh.', JSON.stringify(await translationArea()))

  // 10. TEST provider run
  await page.click('.rail-btn[aria-label="Models & Providers"]')
  await clickText('button.quick-btn', 'TEST provider')
  await page.click('.rail-btn[aria-label="Translation Studio"]')
  await waitText('Segment #1')
  await clickText('button.tab', 'Translation')
  await clickText('button', 'Translate project')
  check('TEST job completes', await waitText('Translation finished', 15000))
  check('TEST output visibly marked', (await text()).includes('[TEST→hr]'))
  await clickText('button.tab', 'Quality control')
  check('QC flags TEST output as error', await waitText('Test provider output'))
  check('Manual edits were not overwritten by batch job', (await page.$$eval('.seg-row .text', (els) => els.map((e) => e.textContent))).some((t) => t.includes('Vlak kasni')))
  await page.screenshot({ path: path.join(shots, '06-studio-test-provider.png') })

  // 11. Other pages
  await page.click('.rail-btn[aria-label="Terminology"]')
  // A fresh profile seeds "Starter terminology (EN)"; databases seeded earlier keep "Starter glossary (EN)".
  check('Terminology page with starter term list', (await waitText('Starter terminology (EN)')) && (await text()).includes('Apartment'))
  await page.screenshot({ path: path.join(shots, '07-glossary.png') })
  await page.click('.rail-btn[aria-label="Settings"]')
  check('Settings lists automatic backups', await waitText('before migrating v0.1'))
  await page.click('.rail-btn[aria-label="Models & Providers"]')
  await waitText('Researched models')
  await page.screenshot({ path: path.join(shots, '08-models.png'), fullPage: true })
} catch (error) {
  check('E2E script ran without exceptions', false, error.message)
  await page.screenshot({ path: path.join(shots, 'error.png') })
} finally {
  const relevant = errors.filter((e) => !e.includes('favicon'))
  check('No uncaught page errors', relevant.length === 0, relevant.slice(0, 5).join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}

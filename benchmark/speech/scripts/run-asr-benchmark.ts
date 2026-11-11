/**
 * Speech benchmark: runs the app's OWN transcription engine (BrowserWhisperEngine + whisper.worker,
 * Transformers.js on onnxruntime-web WASM) inside headless Edge, i.e. the production runtime.
 * No separate Node/Python ASR is used, so results apply directly to the app.
 *
 * Requirements: `npm run dev` running (serves the source modules and /models/), Edge installed,
 * puppeteer-core available (`npm i --no-save puppeteer-core@24`, or PUPPETEER_CORE_DIR=<folder
 * that contains node_modules/puppeteer-core>).
 *
 *   npx tsx benchmark/speech/scripts/run-asr-benchmark.ts                       # base + small, synthetic EN
 *   npx tsx benchmark/speech/scripts/run-asr-benchmark.ts --detect              # + language detection per sample
 *   npx tsx benchmark/speech/scripts/run-asr-benchmark.ts --datasets local-demo --detect --models onnx-community/whisper-small
 *
 * Every run writes a NEW folder benchmark/speech/results/<run-id>/ (never overwritten).
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveModelsDir } from '../../../build/modelsDir'
import { aggregate, scoreSample, type ErrorCounts, type SampleScore } from '../../../src/benchmark/speech/metrics'
import type { LanguageDetection } from '../../../src/media/languageDetection'
import { BLOCK_TARGET_SEC, WHISPER_DECODE_OPTIONS, WHISPER_RUNTIME } from '../../../src/media/whisperConfig'
import type { SpeechDataset, SpeechSample } from './lib/types'

// ---------- arguments ----------
const argv = process.argv.slice(2)
const arg = (name: string, fallback: string) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback)
const flag = (name: string) => argv.includes(`--${name}`)
const datasets = arg('datasets', 'asr-synthetic-en-v1').split(',')
const models = arg('models', 'onnx-community/whisper-base,onnx-community/whisper-small').split(',')
const languageMode = arg('language', 'explicit') as 'explicit' | 'auto'
const detect = flag('detect')
/** With --language auto: 'sample' passes the sample's own sr/hr/bs label as the project variant (what the app does); 'none' lets Whisper's guess decide. */
const shVariantMode = arg('sh-variant', 'none') as 'none' | 'sample'
const transcribe = !flag('no-transcribe')
const limit = Number(arg('limit', '0'))
const only = arg('only', '')
const appUrl = arg('app', 'http://localhost:5173')
const label = arg('label', languageMode === 'auto' ? 'auto' : 'explicit')
const minFreeCommitMb = Number(arg('min-free-commit-mb', '1500'))
const EDGE = arg('edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')

const root = path.resolve('benchmark/speech')
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-asr-${label}`
const outDir = path.join(root, 'results', runId)
if (existsSync(outDir)) throw new Error(`${outDir} exists; results are never overwritten`)

// ---------- helpers ----------
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const ps = (command: string) => execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim()
const round = (x: number | null | undefined, d = 4) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d)

function systemMemory() {
  const out = ps('$o = Get-CimInstance Win32_OperatingSystem; "$($o.FreePhysicalMemory) $($o.FreeVirtualMemory) $($o.TotalVirtualMemorySize) $($o.TotalVisibleMemorySize)"')
  const [freePhys, freeVirt, totalVirt, totalPhys] = out.split(/\s+/).map((v) => Math.round(Number(v) / 1024))
  return { availablePhysicalMb: freePhys, freeCommitMb: freeVirt, commitLimitMb: totalVirt, totalPhysicalMb: totalPhys }
}

function hardware() {
  const cpu = os.cpus()
  const gpu = ps('(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + \' (\' + [math]::Round($_.AdapterRAM/1MB) + \' MB)\' }) -join \'; \'')
  const cores = ps('(Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum')
  const osName = ps('$o = Get-CimInstance Win32_OperatingSystem; "$($o.Caption) $($o.Version) $($o.OSArchitecture)"')
  return { cpu: cpu[0]?.model.trim(), physicalCores: Number(cores), logicalCores: cpu.length, gpu, os: osName, ...systemMemory() }
}

/** Samples working set / private bytes of the given processes and system memory every second. */
function startSampler(browserPid: number) {
  const script = `while ($true) { $ids = @(${browserPid}) + @((Get-CimInstance Win32_Process -Filter "ParentProcessId=${browserPid}").ProcessId); $p = Get-Process -Id $ids -ErrorAction SilentlyContinue; $o = Get-CimInstance Win32_OperatingSystem; $ws = ($p | Measure-Object WorkingSet64 -Sum).Sum; $pr = ($p | Measure-Object PrivateMemorySize64 -Sum).Sum; $rows = ($p | ForEach-Object { "$($_.Id):$($_.WorkingSet64):$($_.PrivateMemorySize64)" }) -join ','; Write-Output "$ws $pr $($o.FreePhysicalMemory) $($o.FreeVirtualMemory) $rows"; Start-Sleep -Milliseconds 1000 }`
  const child = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'] })
  const samples: Array<{ ws: number; priv: number; avail: number; freeCommit: number; perPid: Record<number, { ws: number; priv: number }> }> = []
  let buf = ''
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      const [ws, priv, avail, freeCommit, rows = ''] = line.split(' ')
      if (!ws || Number.isNaN(Number(ws))) continue
      const perPid: Record<number, { ws: number; priv: number }> = {}
      for (const r of rows.split(',').filter(Boolean)) {
        const [pid, w, p] = r.split(':').map(Number)
        perPid[pid] = { ws: w / 2 ** 20, priv: p / 2 ** 20 }
      }
      samples.push({ ws: Number(ws) / 2 ** 20, priv: Number(priv) / 2 ** 20, avail: Number(avail) / 1024, freeCommit: Number(freeCommit) / 1024, perPid })
    }
  })
  return {
    mark: () => samples.length,
    stats(from = 0, to = samples.length) {
      const s = samples.slice(from, to)
      if (!s.length) return null
      const max = (f: (x: (typeof s)[number]) => number) => Math.round(Math.max(...s.map(f)))
      const min = (f: (x: (typeof s)[number]) => number) => Math.round(Math.min(...s.map(f)))
      const pidPeak: Record<number, number> = {}
      for (const x of s) for (const [pid, v] of Object.entries(x.perPid)) pidPeak[Number(pid)] = Math.max(pidPeak[Number(pid)] ?? 0, Math.round(v.priv))
      return { samples: s.length, peakWorkingSetMb: max((x) => x.ws), peakPrivateMb: max((x) => x.priv), minAvailablePhysicalMb: min((x) => x.avail), minFreeCommitMb: min((x) => x.freeCommit), peakPrivateByPidMb: pidPeak }
    },
    stop: () => child.kill(),
  }
}

/**
 * The subset of puppeteer-core this runner uses. puppeteer-core is intentionally NOT a project
 * dependency (`npm i --no-save`), so it is imported by name at run time and typed here.
 */
interface BenchPage {
  evaluate<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>, ...args: A): Promise<R>
  on(event: 'pageerror' | 'error', handler: (error: unknown) => void): void
  goto(url: string): Promise<unknown>
  setDefaultTimeout(ms: number): void
  close(): Promise<void>
}
interface BenchBrowser {
  readonly connected: boolean
  newPage(): Promise<BenchPage>
  close(): Promise<void>
  version(): Promise<string>
  target(): { createCDPSession(): Promise<{ send(method: string): Promise<{ processInfo: Array<{ type: string; id: number; cpuTime: number }> }> }> }
}
interface PuppeteerLike {
  connect(options: { browserURL: string; defaultViewport: null; protocolTimeout: number }): Promise<BenchBrowser>
}

async function loadPuppeteer(): Promise<PuppeteerLike> {
  const name = 'puppeteer-core'
  try {
    return (await import(/* @vite-ignore */ name)).default as PuppeteerLike
  } catch {
    const dir = process.env.PUPPETEER_CORE_DIR
    if (!dir) throw new Error('puppeteer-core not found: run "npm i --no-save puppeteer-core@24" or set PUPPETEER_CORE_DIR')
    const resolved = createRequire(path.join(dir, 'noop.js')).resolve('puppeteer-core')
    return (await import(pathToFileURL(resolved).href)).default as PuppeteerLike
  }
}

const modelInfo = (modelId: string) => {
  const file = path.join(resolveModelsDir(), ...modelId.split('/'), 'MODEL_INFO.json')
  if (!existsSync(file)) return null
  const info = JSON.parse(readFileSync(file, 'utf8')) as { revision: string; totalBytes: number; files: Array<{ path: string; sha256: string }> }
  return { revision: info.revision, totalBytes: info.totalBytes, onnx: info.files.filter((f) => f.path.endsWith('.onnx')).map((f) => ({ path: f.path, sha256: f.sha256 })) }
}

const pkgVersion = (name: string) => JSON.parse(readFileSync(path.resolve('node_modules', name, 'package.json'), 'utf8')).version as string

// ---------- dataset ----------
const loaded = datasets.map((name) => {
  const file = path.join(root, 'datasets', `${name}.json`)
  return { file, sha256: sha256(file), data: JSON.parse(readFileSync(file, 'utf8')) as SpeechDataset }
})
let samples: Array<SpeechSample & { dataset: string }> = loaded.flatMap((d) => d.data.samples.map((s) => ({ ...s, dataset: `${d.data.name}@${d.data.version}` })))
if (only) samples = samples.filter((s) => new RegExp(only).test(s.id))
if (limit) samples = samples.slice(0, limit)
for (const s of samples) {
  const file = path.resolve(s.audio)
  if (!existsSync(file)) throw new Error(`Missing audio: ${s.audio}`)
  if (sha256(file) !== s.sha256) throw new Error(`Audio changed since the dataset was built (sha256 mismatch): ${s.audio}`)
}

// ---------- run ----------
interface SampleResult {
  model: string
  id: string
  dataset: string
  language: string | null
  category: string
  evaluation: string
  expectedLanguage: string
  audioMs: number
  transcribeMs: number | null
  rtf: number | null
  cpuPercent: number | null
  hypothesis: string | null
  segments: number | null
  usedLanguage: string | null
  error: string | null
  score: SampleScore | null
  detection: LanguageDetection | null
  detectMs: number | null
  detectionError: string | null
}

const puppeteer = await loadPuppeteer()
mkdirSync(outDir, { recursive: true })
const partialFile = path.join(outDir, 'samples.partial.jsonl')
const env = {
  runId,
  date: new Date().toISOString(),
  hardwareAtStart: hardware(),
  node: process.version,
  edge: null as string | null,
  runtime: { transformersJs: pkgVersion('@huggingface/transformers'), onnxruntimeWeb: pkgVersion('onnxruntime-web'), backend: 'onnxruntime-web WASM (CPU) in a Web Worker, headless Edge' },
  config: { languageMode, shVariantMode, detect, transcribe, decode: WHISPER_DECODE_OPTIONS, runtime: WHISPER_RUNTIME, blockTargetSec: BLOCK_TARGET_SEC, decoding: 'greedy (Transformers.js 4.3 ignores num_beams)', minFreeCommitMb },
  datasets: loaded.map((d) => ({ name: d.data.name, version: d.data.version, file: path.relative(process.cwd(), d.file), sha256: d.sha256, samples: d.data.samples.length })),
  selectedSamples: samples.length,
  command: `npx tsx benchmark/speech/scripts/run-asr-benchmark.ts ${argv.join(' ')}`.trim(),
}
console.log(`Run ${runId}: ${samples.length} samples × ${models.length} model(s); language=${languageMode}${detect ? ' + detection' : ''}`)

// Edge is started directly with a DevTools port (puppeteer.launch hands off to a running Edge on Windows).
const port = Number(arg('port', '9334'))
const edgeProcess = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), 'exyu-asr-bench-'))}`, '--no-first-run', '--disable-extensions', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' })
let browserURL = ''
for (let i = 0; i < 60 && !browserURL; i += 1) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`)
    if (r.ok) browserURL = `http://127.0.0.1:${port}`
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}
if (!browserURL) throw new Error('Edge did not start with a DevTools port')
const browser = await puppeteer.connect({ browserURL, defaultViewport: null, protocolTimeout: 30 * 60 * 1000 })
// Never leave the benchmark's own Edge running: on any crash close it through DevTools (Browser.close).
// (Killing the spawned msedge.exe is not enough: on Windows it can hand off to another process.)
const closeBrowser = async () => {
  try {
    if (browser.connected) await browser.close()
  } catch {
    /* already gone */
  }
  edgeProcess.kill()
}
for (const event of ['uncaughtException', 'unhandledRejection'] as const)
  process.on(event, async (error) => {
    console.error(error)
    await closeBrowser()
    process.exit(1)
  })
process.on('SIGINT', async () => {
  await closeBrowser()
  process.exit(130)
})
env.edge = await browser.version()
const cdp = await browser.target().createCDPSession()
const processInfo = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo
// The spawned msedge.exe can hand off to another process: take the real browser PID from DevTools.
const browserPid = (await processInfo()).find((p) => p.type === 'browser')?.id ?? edgeProcess.pid ?? 0

const results: SampleResult[] = []
const modelRuns: Array<Record<string, unknown>> = []

for (const modelId of models) {
  const before = systemMemory()
  const info = modelInfo(modelId)
  const run: Record<string, unknown> = { modelId, modelInfo: info, memoryBefore: before }
  modelRuns.push(run)
  if (!info) {
    run.skipped = 'Model is not installed (no MODEL_INFO.json).'
    console.log(`SKIP ${modelId}: not installed`)
    continue
  }
  if (before.freeCommitMb < minFreeCommitMb) {
    run.skipped = `Free commit memory ${before.freeCommitMb} MB < ${minFreeCommitMb} MB required for a stable run.`
    console.log(`SKIP ${modelId}: ${run.skipped}`)
    continue
  }
  const pageErrors: string[] = []
  const openPage = async () => {
    const p = await browser.newPage()
    p.setDefaultTimeout(30 * 60 * 1000)
    p.on('pageerror', (e: unknown) => pageErrors.push(String((e as Error).message ?? e)))
    p.on('error', (e: unknown) => pageErrors.push(`page crashed: ${(e as Error).message}`))
    // A static file of the dev server: same origin as the app, without booting the app UI.
    await p.goto(`${appUrl}/favicon.svg`)
    return p
  }
  const loadModel = (p: Awaited<ReturnType<typeof openPage>>) =>
    p.evaluate(async (id: string) => {
      const t = performance.now()
      await (globalThis as unknown as { __asr: { warmUp: (m: string) => Promise<void> } }).__asr.warmUp(id)
      return performance.now() - t
    }, modelId)
  const setupEngine = (p: Awaited<ReturnType<typeof openPage>>) => p.evaluate(async (id: string) => {
    // Served by the Vite dev server: the app's own modules (paths are runtime strings on purpose).
    const enginePath = '/src/media/browserWhisper.ts'
    const filesPath = '/src/translation/providers/workerRuntime.ts'
    const engineModule = (await import(/* @vite-ignore */ enginePath)) as typeof import('../../../src/media/browserWhisper')
    const files = (await import(/* @vite-ignore */ filesPath)) as typeof import('../../../src/translation/providers/workerRuntime')
    const engine = new engineModule.BrowserWhisperEngine(files.httpModelFiles)
    ;(globalThis as unknown as { __asr: unknown }).__asr = engine
    const check = await engine.checkModel(id)
    return { available: check.available, message: check.message, crossOriginIsolated: globalThis.crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency }
  }, modelId)
  let page = await openPage()
  const setup = await setupEngine(page)
  run.page = setup
  if (!setup.available) {
    run.skipped = `Model check failed in the browser: ${setup.message}`
    await page.close()
    continue
  }
  const sampler = startSampler(browserPid)
  await new Promise((r) => setTimeout(r, 1500))
  const loadStart = sampler.mark()
  const loadMs = await loadModel(page)
  await new Promise((r) => setTimeout(r, 1200))
  run.loadMs = Math.round(loadMs)
  run.memoryAfterLoad = sampler.stats(loadStart)
  console.log(`\n== ${modelId}: loaded in ${(loadMs / 1000).toFixed(1)} s`)
  const runStart = sampler.mark()
  const t0 = Date.now()
  let crashes = 0
  let browserLost = false

  for (const s of samples) {
    const bytes = readFileSync(path.resolve(s.audio)).toString('base64')
    const cpuBefore = (await processInfo()).reduce((sum, p) => sum + p.cpuTime, 0)
    const wall0 = Date.now()
    const language = languageMode === 'auto' ? 'auto' : (s.language ?? 'en')
    let out: Record<string, unknown>
    try {
      out = await page.evaluate(
      async (b64: string, name: string, opts: { modelId: string; language: string; shVariant?: string; detect: boolean; transcribe: boolean }) => {
        const engine = (globalThis as unknown as { __asr: any }).__asr // eslint-disable-line @typescript-eslint/no-explicit-any
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        const file = new File([bin], name)
        const r: Record<string, unknown> = {}
        if (opts.detect) {
          const t = performance.now()
          try {
            r.detection = await engine.detectLanguage(file, opts.modelId, new AbortController().signal)
          } catch (e) {
            r.detectionError = `${(e as Error).name}: ${(e as Error).message}`
          }
          r.detectMs = performance.now() - t
        }
        if (opts.transcribe) {
          const t = performance.now()
          try {
            const res = await engine.transcribe(file, { modelId: opts.modelId, language: opts.language, shVariant: opts.shVariant }, new AbortController().signal, () => {})
            r.text = res.segments.map((x: { text: string }) => x.text.replace(/\n/g, ' ')).join(' ')
            r.segments = res.segments.length
            r.durationMs = res.durationMs
            r.usedLanguage = res.language
            if (res.detection) r.detection = res.detection
          } catch (e) {
            r.error = `${(e as Error).name}: ${(e as Error).message}`
            const d = (e as { detection?: unknown }).detection
            if (d) r.detection = d
          }
          r.transcribeMs = performance.now() - t
        }
        return r
      },
      bytes,
      path.basename(s.audio),
      { modelId, language, shVariant: shVariantMode === 'sample' && s.language && s.language !== 'en' ? s.language : undefined, detect, transcribe },
    )
    } catch (error) {
      // Renderer crash (often: out of memory) or lost browser. Record it, reopen, continue.
      crashes += 1
      const message = `Page crashed during this sample: ${(error as Error).message}`
      results.push({ model: modelId, id: s.id, dataset: s.dataset, language: s.language, category: s.category, evaluation: s.evaluation, expectedLanguage: s.expectedLanguage, audioMs: s.durationMs, transcribeMs: null, rtf: null, cpuPercent: null, hypothesis: null, segments: null, usedLanguage: null, error: message, score: null, detection: null, detectMs: null, detectionError: detect ? message : null })
      appendFileSync(partialFile, `${JSON.stringify(results.at(-1))}\n`)
      console.log(`  ${s.id.padEnd(32)} CRASH ${message}`)
      if (!browser.connected) {
        browserLost = true
        break
      }
      await page.close().catch(() => {})
      page = await openPage()
      await setupEngine(page)
      await loadModel(page)
      continue
    }
    const wall = Date.now() - wall0
    const cpuAfter = (await processInfo()).reduce((sum, p) => sum + p.cpuTime, 0)
    const audioMs = (out.durationMs as number | undefined) ?? s.durationMs
    const hypothesis = (out.text as string | undefined) ?? null
    const score = s.evaluation === 'wer' && s.reference !== null && hypothesis !== null ? scoreSample(s.reference, hypothesis) : null
    const transcribeMs = (out.transcribeMs as number | undefined) ?? null
    const result: SampleResult = {
      model: modelId,
      id: s.id,
      dataset: s.dataset,
      language: s.language,
      category: s.category,
      evaluation: s.evaluation,
      expectedLanguage: s.expectedLanguage,
      audioMs,
      transcribeMs: transcribeMs === null ? null : Math.round(transcribeMs),
      rtf: transcribeMs !== null && audioMs ? round(transcribeMs / audioMs, 3) : null,
      cpuPercent: round((100 * (cpuAfter - cpuBefore)) / ((wall / 1000) * os.cpus().length), 1),
      hypothesis,
      segments: (out.segments as number | undefined) ?? null,
      usedLanguage: (out.usedLanguage as string | undefined) ?? null,
      error: (out.error as string | undefined) ?? null,
      score,
      detection: (out.detection as LanguageDetection | undefined) ?? null,
      detectMs: out.detectMs === undefined ? null : Math.round(out.detectMs as number),
      detectionError: (out.detectionError as string | undefined) ?? null,
    }
    results.push(result)
    appendFileSync(partialFile, `${JSON.stringify(result)}\n`)
    const w = score ? `WER ${(100 * (score.normalized.wer.rate ?? 0)).toFixed(0)} %` : s.evaluation
    const d = result.detection ? ` · detect ${result.detection.status}/${result.detection.language ?? '-'} ${(100 * result.detection.probability).toFixed(0)} %` : ''
    console.log(`  ${s.id.padEnd(32)} ${w.padEnd(12)} RTF ${result.rtf ?? '-'}${d}${result.error ? ` · ${result.error}` : ''}`)
    if (hypothesis !== null && s.evaluation !== 'wer') console.log(`      → ${hypothesis.slice(0, 160)}`)
  }
  run.wallMs = Date.now() - t0
  run.crashes = crashes
  run.memoryDuringRun = sampler.stats(runStart)
  const minAvail = (run.memoryDuringRun as { minAvailablePhysicalMb?: number } | null)?.minAvailablePhysicalMb ?? null
  // Measured, not estimated: if free physical RAM dropped this low, Windows was paging and timings are pessimistic.
  run.memoryPressure = minAvail !== null && minAvail < 200 ? `yes: available physical RAM fell to ${minAvail} MB during the run; timings include paging` : 'no'
  run.pageErrors = pageErrors
  if (browserLost) {
    run.aborted = 'Browser connection lost; remaining samples of this model were not run.'
    sampler.stop()
    break
  }
  await page.close()
  await new Promise((r) => setTimeout(r, 3000))
  const releaseMark = sampler.mark()
  await new Promise((r) => setTimeout(r, 2500))
  run.memoryAfterClose = sampler.stats(releaseMark)
  sampler.stop()
}
await closeBrowser()

// ---------- aggregate ----------
type View = 'strict' | 'normalized'
const group = (rows: SampleResult[], key: (r: SampleResult) => string) => {
  const map = new Map<string, SampleResult[]>()
  for (const r of rows) map.set(key(r), [...(map.get(key(r)) ?? []), r])
  return map
}
const summarize = (rows: SampleResult[]) => {
  const scored = rows.filter((r) => r.score)
  const pick = (view: View, kind: 'wer' | 'cer') => aggregate(scored.map((r) => r.score![view][kind]))
  const fmt = (c: ErrorCounts) => ({ ...c, rate: round(c.rate) })
  const timed = rows.filter((r) => r.transcribeMs !== null && !r.error)
  const audio = timed.reduce((s, r) => s + r.audioMs, 0)
  const time = timed.reduce((s, r) => s + (r.transcribeMs ?? 0), 0)
  return {
    samples: rows.length,
    scored: scored.length,
    failed: rows.filter((r) => r.error).length,
    emptyOutputs: rows.filter((r) => r.hypothesis !== null && !r.hypothesis.trim()).length,
    strict: { wer: fmt(pick('strict', 'wer')), cer: fmt(pick('strict', 'cer')) },
    normalized: { wer: fmt(pick('normalized', 'wer')), cer: fmt(pick('normalized', 'cer')) },
    diacriticOnlyErrors: scored.reduce((s, r) => s + r.score!.diacriticOnlyErrors, 0),
    audioSeconds: round(audio / 1000, 1),
    transcribeSeconds: round(time / 1000, 1),
    rtf: audio ? round(time / audio, 3) : null,
    meanCpuPercent: round(timed.reduce((s, r) => s + (r.cpuPercent ?? 0), 0) / (timed.length || 1), 1),
  }
}
const detectionCorrect = (r: SampleResult) => {
  const d = r.detection
  if (!d) return null
  if (r.expectedLanguage === 'no-speech') return d.status === 'no-speech'
  if (d.status !== 'detected') return false
  return r.expectedLanguage === 'en' ? d.language === 'en' : d.language !== 'en'
}
const summary = models.map((m) => {
  const rows = results.filter((r) => r.model === m)
  const det = rows.filter((r) => r.detection)
  return {
    model: m,
    overall: summarize(rows),
    byCategory: Object.fromEntries([...group(rows, (r) => r.category)].map(([k, v]) => [k, summarize(v)])),
    byLanguage: Object.fromEntries([...group(rows, (r) => r.language ?? 'none')].map(([k, v]) => [k, summarize(v)])),
    detection: det.length
      ? {
          samples: det.length,
          correct: det.filter((r) => detectionCorrect(r) === true).length,
          wrongLanguageDetected: det.filter((r) => r.detection!.status === 'detected' && detectionCorrect(r) === false).length,
          notDecided: det.filter((r) => r.detection!.status !== 'detected' && r.expectedLanguage !== 'no-speech').length,
          meanDetectMs: Math.round(det.reduce((s, r) => s + (r.detectMs ?? 0), 0) / det.length),
        }
      : null,
  }
})

const report = { ...env, hardwareAtEnd: systemMemory(), models: modelRuns, summary }
writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(report, null, 2))
writeFileSync(path.join(outDir, 'samples.json'), JSON.stringify(results, null, 2))
const csv = (rows: unknown[][]) => rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n') + '\n'
writeFileSync(
  path.join(outDir, 'samples.csv'),
  csv([
    ['model', 'id', 'language', 'category', 'evaluation', 'audio_ms', 'transcribe_ms', 'rtf', 'cpu_percent', 'strict_wer', 'norm_wer', 'strict_cer', 'norm_cer', 'S', 'D', 'I', 'N', 'diacritic_only', 'used_language', 'hypothesis', 'error'],
    ...results.map((r) => [r.model, r.id, r.language, r.category, r.evaluation, r.audioMs, r.transcribeMs, r.rtf, r.cpuPercent, round(r.score?.strict.wer.rate), round(r.score?.normalized.wer.rate), round(r.score?.strict.cer.rate), round(r.score?.normalized.cer.rate), r.score?.normalized.wer.substitutions, r.score?.normalized.wer.deletions, r.score?.normalized.wer.insertions, r.score?.normalized.wer.n, r.score?.diacriticOnlyErrors, r.usedLanguage, r.hypothesis, r.error]),
  ]),
)
if (results.some((r) => r.detection || r.detectionError))
  writeFileSync(
    path.join(outDir, 'detection.csv'),
    csv([
      ['model', 'id', 'expected', 'status', 'reason', 'language', 'probability', 'p_en', 'p_sr_hr_bs', 'p_other', 'other_code', 'no_speech_prob', 'speech_seconds', 'windows', 'detect_ms', 'correct', 'error'],
      ...results.map((r) => {
        const d = r.detection
        return [r.model, r.id, r.expectedLanguage, d?.status, d?.reason, d?.language, round(d?.probability), round(d?.groups.en), round(d?.groups.sh), round(d?.groups.other), d?.groups.otherCode, round(d?.noSpeechProb), round(d?.speechSeconds, 1), d?.windows, r.detectMs, detectionCorrect(r), r.detectionError]
      }),
    ]),
  )
console.log(`\nResults: ${path.relative(process.cwd(), outDir)}`)
for (const s of summary) {
  const o = s.overall
  console.log(`${s.model}: norm WER ${o.normalized.wer.rate ?? '-'} · strict WER ${o.strict.wer.rate ?? '-'} · norm CER ${o.normalized.cer.rate ?? '-'} · RTF ${o.rtf ?? '-'} · failed ${o.failed}${s.detection ? ` · detection ${s.detection.correct}/${s.detection.samples}` : ''}`)
}

/**
 * Performance guard for large projects (2,000 subtitles, a 2-hour audio activity track).
 * Limits are generous (slow laptop, shared CI): they catch accidental O(n²) work, not tune speed.
 * Measured values are printed so they can be reported.
 */
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { newId, type Segment } from '../domain/types'
import { analyzeActivity, FRAME_MS, type AudioActivity } from '../media/audioActivity'
import { AppDatabase } from '../persistence/database'
import { ProjectRepository } from '../persistence/repositories/projects'
import { MemorySnapshotStore } from '../persistence/snapshotStore'
import { checkTranscript } from './checks/transcript'
import { speechLike, SR } from '../test/syntheticAudio'
import { getQcProfile, runQc } from '.'

const COUNT = 2000
const HOURS_MS = 2 * 3600 * 1000

function bigProject(): Segment[] {
  const step = HOURS_MS / COUNT
  return Array.from({ length: COUNT }, (_, i) => ({
    id: newId(),
    start: Math.round(i * step),
    end: Math.round(i * step + step * 0.8),
    source: i % 50 === 0 ? 'you' : `Line number ${i} with a few words of dialogue.`,
    sourceOrigin: 'whisper' as const,
    sourceStatus: 'unreviewed' as const,
    translations: { 'sr-Latn': { text: `Red broj ${i} sa nekoliko reči dijaloga.`, status: 'translated' as const, origin: 'machine' as const, locked: false, updatedAt: '', sourceText: `Line number ${i} with a few words of dialogue.` } },
  }))
}

/** 2 h activity track built directly (decoding 2 h of audio in a unit test would need ~460 MB). */
function twoHourActivity(): AudioActivity {
  const frames = HOURS_MS / FRAME_MS
  const db = new Int8Array(frames)
  const zcr = new Uint8Array(frames)
  for (let f = 0; f < frames; f += 1) {
    const inSyllable = f % 12 < 8 && Math.floor(f / 250) % 4 !== 3 // speech with pauses
    db[f] = inSyllable ? -20 - (f % 5) : -70
    zcr[f] = inSyllable ? (f % 3 === 0 ? 120 : 20) : 0
  }
  return { frameMs: FRAME_MS, db, zcr, durationMs: HOURS_MS }
}

const time = (fn: () => void) => {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}

describe('performance with 2,000 subtitles', () => {
  it('runs all QC checks (with audio) fast enough to stay interactive', () => {
    const segments = bigProject()
    const audio = twoHourActivity()
    const input = { segments, profile: 'sr-Latn' as const, sourceLanguage: 'en' as const, neutralYat: 'ijekavian' as const, qcProfile: getQcProfile('standard'), termbase: [], terminology: [], localizationRules: [], audio }
    runQc(input) // warm-up (JIT)
    const transcriptMs = time(() => checkTranscript(input))
    const allMs = time(() => runQc(input))
    console.info(`[perf] 2000 segments, 2 h audio: transcript QC ${transcriptMs.toFixed(0)} ms, all QC ${allMs.toFixed(0)} ms`)
    expect(transcriptMs).toBeLessThan(1500)
    expect(allMs).toBeLessThan(3000)
  })

  it('analyses audio activity in one fast pass', () => {
    const fiveMinutes = speechLike(300)
    const ms = time(() => analyzeActivity(fiveMinutes, SR))
    console.info(`[perf] analyzeActivity: 5 min of 16 kHz audio in ${ms.toFixed(0)} ms (≈${((ms * 24) / 1000).toFixed(1)} s for 2 h)`)
    expect(ms).toBeLessThan(2000)
  })

  it('saves and reloads 2,000 subtitles with statuses in the local database', async () => {
    const SQL = await initSqlJs()
    const { db } = await AppDatabase.open(SQL, new MemorySnapshotStore(), 5)
    const repo = new ProjectRepository(db)
    const doc = repo.create({ name: 'Big', contentType: 'movie', sourceLanguage: 'en', activeProfile: 'sr-Latn', neutralYat: 'ijekavian', sourceFormat: null, sourceFileName: null, formatHeader: null }, bigProject())
    const saveMs = time(() => repo.save(doc))
    let loaded: ReturnType<ProjectRepository['getDoc']> = null
    const loadMs = time(() => (loaded = repo.getDoc(doc.project.id)))
    console.info(`[perf] autosave of 2000 segments ${saveMs.toFixed(0)} ms, load ${loadMs.toFixed(0)} ms`)
    expect(loaded!.segments).toHaveLength(COUNT)
    expect(loaded!.segments[1].sourceOrigin).toBe('whisper')
    expect(saveMs).toBeLessThan(3000)
  })
})

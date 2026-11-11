/** Real local inference check for Serbian/Croatian/Bosnian → English (npm run model:smoke:sh-en). */
import { createNodeMarianRuntime } from './lib/nodeMarian'
import { OPUS_SH_EN_MODEL_ID, OpusMtProvider } from '../src/translation/providers/opusMt'
import { buildTarget } from '../src/translation/engine'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveModelsDir } from '../build/modelsDir'

const runtime = createNodeMarianRuntime()
const dir = resolveModelsDir()
const provider = new OpusMtProvider(runtime, { exists: async (p) => existsSync(path.join(dir, p)) }, { device: 'cpu', dtype: 'q8', numBeams: 4 })
const target = buildTarget('en', 'ijekavian')
const lines = [
  'Ćao, ja sam vaš AI asistent. Dobrodošli.',
  'Ovo je sajt za frizerski salon.',
  'Mušterija postavlja pitanje, a bot sam odgovara.',
  'Ulogujete se na svoj nalog, kopirate jednu liniju koda i nalepite je na svoj sajt.',
  'Moram ići kući, kasno je.',
  'Gdje si bio sinoć?',
]
const t0 = Date.now()
console.log('availability', await provider.checkAvailability({ sourceLanguage: 'sr', target }))
const out = await provider.translateBatch({ items: lines.map((text, i) => ({ id: String(i), text, before: [], after: [] })), sourceLanguage: 'sr', target, glossary: [], contentType: 'youtube', signal: new AbortController().signal })
lines.forEach((l, i) => console.log(`${l}\n  → ${out[i].text}`))
console.log(`model ${OPUS_SH_EN_MODEL_ID}, ${lines.length} lines in ${((Date.now() - t0) / 1000).toFixed(1)} s (incl. load)`)
runtime.dispose()

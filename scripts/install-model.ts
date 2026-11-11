/**
 * Installs the local translation model (one-time, needs internet only for the download).
 *
 *   npm run model:install                 # int8 encoder (default, ~400 MB)
 *   npm run model:install -- --fp32       # additionally fp32 encoder/decoder (~540 MB)
 *   npm run model:install -- --dir D:\models
 *
 * Every file comes from a pinned Hugging Face revision and is verified (SHA-256 for LFS
 * files, git blob SHA-1 for small files) before it is used. Nothing is overwritten
 * unless it fails verification. A MODEL_INFO.json manifest records sources, revisions,
 * checksums, sizes, licence and the modifications made (required by CC-BY-4.0).
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { defaultInstallDir } from '../build/modelsDir'
import { buildMarianTokenizerJson } from '../src/translation/marianTokenizer'

const EN_SH_ORIGINAL = { repo: 'Helsinki-NLP/opus-mt-tc-base-en-sh', revision: '8a5d73fe1fbfa392a1d754f89fce0bfb8335d4ab' }
const EN_SH_ONNX = { repo: 'TigreGotico/opus-mt-tc-base-en-sh-onnx', revision: '83f8ae0fd714891f84e237b4fc32fda7620f2b1d' }

interface FileSpec {
  repo: { repo: string; revision: string }
  source: string
  target: string
  size: number
  sha256?: string
  gitBlob?: string
  optional?: 'fp32'
}

const EN_SH_FILES: FileSpec[] = [
  { repo: EN_SH_ORIGINAL, source: 'config.json', target: 'config.json', size: 1073, gitBlob: '55c2105fcfaefaba4929df0c4a479ad49200e0a4' },
  { repo: EN_SH_ORIGINAL, source: 'generation_config.json', target: 'generation_config.json', size: 301, gitBlob: 'e78eb617c5432503af59c529f63fc3dadeccb67f' },
  { repo: EN_SH_ORIGINAL, source: 'tokenizer_config.json', target: 'tokenizer_config.json', size: 310, gitBlob: 'bd44ddaea6f4ab35e42137986dd12217576ac897' },
  { repo: EN_SH_ORIGINAL, source: 'special_tokens_map.json', target: 'special_tokens_map.json', size: 65, gitBlob: '6dc4d430ddbd24171268d73da061ce9f0b092911' },
  { repo: EN_SH_ORIGINAL, source: 'vocab.json', target: 'vocab.json', size: 1562217, gitBlob: '01c1cb1ffa9752a13d103ebe9b4a148876ef665d' },
  { repo: EN_SH_ORIGINAL, source: 'source.spm', target: 'source.spm', size: 795135, sha256: 'e21a114e9cd29d86d6686270b555ebae828d7ede41d155c24885477a5fbd5ea5' },
  { repo: EN_SH_ORIGINAL, source: 'target.spm', target: 'target.spm', size: 812079, sha256: '5af3b120c89deff27c19623dafd9c48d2198aa811cf66c21167f5fe305e6ad7e' },
  { repo: EN_SH_ORIGINAL, source: 'README.md', target: 'ORIGINAL_MODEL_CARD.md', size: 11788, gitBlob: '6093bfff79bd07404d8737cca7b93be60a1f3b73' },
  { repo: EN_SH_ONNX, source: 'int8/encoder_model.onnx', target: 'onnx/encoder_model_quantized.onnx', size: 49464072, sha256: '7f21b605fab0a06c04767fcd8c4f045776bd9338e73520abe4471ba1c4f47421' },
  { repo: EN_SH_ONNX, source: 'int8/decoder_model_merged.onnx', target: 'onnx/decoder_model_merged_quantized.onnx', size: 342898274, sha256: '05108aed719e9c34331bfd04380c23fe29c452a804c38d6cfd36a33afd9edb7c' },
  { repo: EN_SH_ONNX, source: 'encoder_model.onnx', target: 'onnx/encoder_model.onnx', size: 196872822, sha256: '3dc25a82b0f6fcd52eeff27bbc9b5bb0eed64b2c78511614ffb6bd773b876c8b', optional: 'fp32' },
  { repo: EN_SH_ONNX, source: 'decoder_model_merged.onnx', target: 'onnx/decoder_model_merged.onnx', size: 342748173, sha256: '037659b4ded38b25000a651598651a48b460a04f90e07ddfe6e3ae3236c894cb', optional: 'fp32' },
  { repo: EN_SH_ONNX, source: 'README.md', target: 'ONNX_CONVERSION_README.md', size: 2222, gitBlob: '3180ee5802083ea240a54628a9917a3a3fe2db9e' },
]

// Serbian / Croatian / Bosnian → English (tc-big, ~236M parameters). The int8 export has no
// merged decoder; the plain int8 decoder (no KV cache) is used under the merged file name.
const SH_EN_ORIGINAL = { repo: 'Helsinki-NLP/opus-mt-tc-big-sh-en', revision: '94d3197eab7df79725c8e7f59d23895092d39210' }
const SH_EN_ONNX = { repo: 'TigreGotico/opus-mt-tc-big-sh-en-onnx', revision: 'f03f73cb195457d199f00d88df0f8ce99eb52937' }
const SH_EN_FILES: FileSpec[] = [
  { repo: SH_EN_ORIGINAL, source: 'config.json', target: 'config.json', size: 1076, gitBlob: '0f1fc6994bee9fd9886b768ec1642dc9e9dd4c3c' },
  { repo: SH_EN_ORIGINAL, source: 'generation_config.json', target: 'generation_config.json', size: 301, gitBlob: '9dc6ffe19aa45ad4f5863b055cb2ebbb6b3da350' },
  { repo: SH_EN_ORIGINAL, source: 'tokenizer_config.json', target: 'tokenizer_config.json', size: 337, gitBlob: 'ea3fb734f2dfa509a8a2898fa434c36d8785da87' },
  { repo: SH_EN_ORIGINAL, source: 'special_tokens_map.json', target: 'special_tokens_map.json', size: 65, gitBlob: '6dc4d430ddbd24171268d73da061ce9f0b092911' },
  { repo: SH_EN_ORIGINAL, source: 'vocab.json', target: 'vocab.json', size: 1695406, gitBlob: 'b7ecd4a1049088dae4dacacfd4b58e5fd8d69194' },
  { repo: SH_EN_ORIGINAL, source: 'source.spm', target: 'source.spm', size: 848531, sha256: '04edd3b1ef274a674fad5bd278165e20db3b9190af3ed93ecc208546fc18c813' },
  { repo: SH_EN_ORIGINAL, source: 'target.spm', target: 'target.spm', size: 794188, sha256: 'f8162fb45022dc045c39eccfc02274ce988336f531a38eb3c892bd95692d7ae5' },
  { repo: SH_EN_ORIGINAL, source: 'README.md', target: 'ORIGINAL_MODEL_CARD.md', size: 7269, gitBlob: 'fa322af24eb396d19190775ed574f00e4029e4a6' },
  { repo: SH_EN_ONNX, source: 'int8/encoder_model.onnx', target: 'onnx/encoder_model_quantized.onnx', size: 137346021, sha256: 'e49558662a7f2d3f169c9419901b64a11bfb77109f8deacb9e9f8589e8c4abb4' },
  { repo: SH_EN_ONNX, source: 'int8/decoder_model.onnx', target: 'onnx/decoder_model_merged_quantized.onnx', size: 223443404, sha256: 'cfa231115f394d7450ef62267865efc0984e817e58006e9f251eede275c2c9da' },
  { repo: SH_EN_ONNX, source: 'README.md', target: 'ONNX_CONVERSION_README.md', size: 2185, gitBlob: 'f86c1aa77f4ef4735740c6ac867d637392233580' },
]

const MODELS = {
  'en-sh': { id: 'Helsinki-NLP/opus-mt-tc-base-en-sh', original: EN_SH_ORIGINAL, onnx: EN_SH_ONNX, onnxLicense: 'CC-BY-4.0 (inherited)', files: EN_SH_FILES },
  'sh-en': { id: 'Helsinki-NLP/opus-mt-tc-big-sh-en', original: SH_EN_ORIGINAL, onnx: SH_EN_ONNX, onnxLicense: 'Apache-2.0 tag on the conversion repo; weights CC-BY-4.0', files: SH_EN_FILES },
} as const

const args = process.argv.slice(2)
const modelArg = args.indexOf('--model')
const which = (modelArg >= 0 ? args[modelArg + 1] : 'en-sh') as keyof typeof MODELS
if (!MODELS[which]) throw new Error(`Unknown --model ${which} (use en-sh or sh-en)`)
const { id: MODEL_ID, original: ORIGINAL, onnx: ONNX, onnxLicense, files: FILES } = MODELS[which]
const withFp32 = args.includes('--fp32')
const dirArg = args.indexOf('--dir')
const root = dirArg >= 0 ? path.resolve(args[dirArg + 1]) : defaultInstallDir()
const modelDir = path.join(root, ...MODEL_ID.split('/'))

const sha256File = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const gitBlobFile = (file: string) => {
  const data = readFileSync(file)
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')
}
const verify = (spec: FileSpec, file: string) => {
  if (!existsSync(file) || statSync(file).size !== spec.size) return false
  return spec.sha256 ? sha256File(file) === spec.sha256 : gitBlobFile(file) === spec.gitBlob
}

async function download(spec: FileSpec, file: string) {
  const url = `https://huggingface.co/${spec.repo.repo}/resolve/${spec.repo.revision}/${spec.source}`
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`)
  const tmp = `${file}.part`
  let received = 0
  let lastLog = 0
  const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (spec.size > 5e6 && Date.now() - lastLog > 2000) {
      lastLog = Date.now()
      process.stdout.write(`\r  ${spec.target}: ${(received / 1e6).toFixed(0)} / ${(spec.size / 1e6).toFixed(0)} MB`)
    }
  })
  await pipeline(body, createWriteStream(tmp))
  if (spec.size > 5e6) process.stdout.write('\n')
  renameSync(tmp, file)
}

async function main() {
  const selected = FILES.filter((f) => !f.optional || (f.optional === 'fp32' && withFp32))
  const totalMb = selected.reduce((s, f) => s + f.size, 0) / 1e6
  console.log(`Installing ${MODEL_ID} into ${modelDir}`)
  console.log(`Download size (if nothing is present yet): ${totalMb.toFixed(0)} MB`)
  mkdirSync(path.join(modelDir, 'onnx'), { recursive: true })

  const manifestFiles: Array<{ path: string; bytes: number; sha256: string; source: string }> = []
  for (const spec of selected) {
    const file = path.join(modelDir, spec.target)
    if (verify(spec, file)) {
      console.log(`  ✓ ${spec.target} (already present, verified)`)
    } else {
      console.log(`  ↓ ${spec.target} (${(spec.size / 1e6).toFixed(1)} MB) from ${spec.repo.repo}@${spec.repo.revision.slice(0, 8)}`)
      await download(spec, file)
      if (!verify(spec, file)) throw new Error(`Checksum verification FAILED for ${spec.target}. The file was not accepted.`)
      console.log(`  ✓ ${spec.target} verified`)
    }
    manifestFiles.push({ path: spec.target, bytes: statSync(file).size, sha256: sha256File(file), source: `https://huggingface.co/${spec.repo.repo}/blob/${spec.repo.revision}/${spec.source}` })
  }

  // Generate tokenizer.json (Transformers.js format) from the original tokenizer files.
  const tokenizer = buildMarianTokenizerJson({
    vocab: JSON.parse(readFileSync(path.join(modelDir, 'vocab.json'), 'utf8')),
    sourceSpm: readFileSync(path.join(modelDir, 'source.spm')),
    targetSpm: readFileSync(path.join(modelDir, 'target.spm')),
  })
  const tokenizerPath = path.join(modelDir, 'tokenizer.json')
  writeFileSync(tokenizerPath, JSON.stringify(tokenizer))
  manifestFiles.push({ path: 'tokenizer.json', bytes: statSync(tokenizerPath).size, sha256: sha256File(tokenizerPath), source: 'generated by scripts/install-model.ts from vocab.json + source.spm + target.spm' })
  console.log(`  ✓ tokenizer.json generated (${tokenizer.model.vocab.length} tokens, unk_id ${tokenizer.model.unk_id})`)

  const manifest = {
    model: MODEL_ID,
    installedAt: new Date().toISOString(),
    original: { ...ORIGINAL, url: `https://huggingface.co/${ORIGINAL.repo}`, license: 'CC-BY-4.0' },
    onnxConversion: { ...ONNX, url: `https://huggingface.co/${ONNX.repo}`, license: onnxLicense, verifiedIndependently: false },
    attribution: 'OPUS-MT, Language Technology Research Group, University of Helsinki (Tiedemann & Thottingal 2020; Tiedemann 2020). Licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/',
    modifications: 'Converted to ONNX (optimum) and int8-quantized (onnxruntime quantize_dynamic) by TigreGotico; tokenizer.json generated for Transformers.js by Titlo (formerly ExYu Titl Studio). Files renamed into the Transformers.js layout (onnx/*_quantized.onnx).',
    totalBytes: manifestFiles.reduce((s, f) => s + f.bytes, 0),
    files: manifestFiles,
  }
  writeFileSync(path.join(modelDir, 'MODEL_INFO.json'), JSON.stringify(manifest, null, 2))
  console.log(`Done. ${(manifest.totalBytes / 1e6).toFixed(0)} MB on disk. Manifest: ${path.join(modelDir, 'MODEL_INFO.json')}`)
}

main().catch((error) => {
  console.error(`\nInstallation failed: ${(error as Error).message}`)
  process.exit(1)
})

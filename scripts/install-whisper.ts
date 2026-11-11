/**
 * Installs a local Whisper speech-to-text model (one-time download, then fully offline).
 *
 *   npm run model:install:whisper                 # whisper-small int8 (~250 MB, better for Serbian/Croatian/Bosnian)
 *   npm run model:install:whisper -- --size base  # whisper-base int8 (~77 MB, faster, less accurate)
 *
 * Source: onnx-community/whisper-* (official Transformers.js ONNX exports of OpenAI Whisper).
 * Licences: OpenAI Whisper weights MIT; ONNX conversion Apache-2.0 (base) / unlabeled (small).
 * Every file is verified against a pinned SHA-256 / git hash.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defaultInstallDir } from '../build/modelsDir'
import { downloadFile, sha256File, verifyFile, type PinnedFile, type PinnedRepo } from './lib/hfFiles'

type Row = [source: string, size: number, hash: string]

const MODELS: Record<'base' | 'small', { repo: PinnedRepo; files: Row[] }> = {
  base: {
    repo: { repo: 'onnx-community/whisper-base', revision: '27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c' },
    files: [
      ['added_tokens.json', 34604, 'git:e3d256c988462aa153dcabe2aa38b8e9b436c06f'],
      ['config.json', 2243, 'git:ce7faf5d5e56e82d4800e55f524582a525639ff7'],
      ['generation_config.json', 3832, 'git:a57cdbf036979f80bb7ff092a0fee6256a81d329'],
      ['preprocessor_config.json', 339, 'git:91876762a536a746d268353c5cba57286e76b058'],
      ['special_tokens_map.json', 2194, 'git:bf69932dca4b3719b59fdd8f6cc1978109509f6c'],
      ['tokenizer.json', 2480466, 'git:1e95340ff836fad1b5932e800fb7b8c5e6d78a74'],
      ['tokenizer_config.json', 282682, 'git:25be523be5ac50a7671a77f55acba082459d6314'],
      ['onnx/encoder_model_quantized.onnx', 23201314, 'sha256:5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46'],
      ['onnx/decoder_model_merged_quantized.onnx', 53693315, 'sha256:fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b'],
    ],
  },
  small: {
    repo: { repo: 'onnx-community/whisper-small', revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732' },
    files: [
      ['added_tokens.json', 34604, 'git:e3d256c988462aa153dcabe2aa38b8e9b436c06f'],
      ['config.json', 2227, 'git:b0447377b1ade057f991a6a0870d2a91de762f7f'],
      ['generation_config.json', 3893, 'git:703dc78ee83e87fca3ace72170253cdfe4cd2d13'],
      ['preprocessor_config.json', 339, 'git:91876762a536a746d268353c5cba57286e76b058'],
      ['special_tokens_map.json', 2194, 'git:bf69932dca4b3719b59fdd8f6cc1978109509f6c'],
      ['tokenizer.json', 2480466, 'git:1e95340ff836fad1b5932e800fb7b8c5e6d78a74'],
      ['tokenizer_config.json', 282683, 'git:d13b786c04765fb1a06492b53587752cd67665ea'],
      ['onnx/encoder_model_quantized.onnx', 92326160, 'sha256:a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92'],
      ['onnx/decoder_model_merged_quantized.onnx', 156750845, 'sha256:ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9'],
    ],
  },
}

const args = process.argv.slice(2)
const sizeArg = args.includes('--size') ? args[args.indexOf('--size') + 1] : 'small'
if (sizeArg !== 'base' && sizeArg !== 'small') throw new Error('--size must be "base" or "small"')
const root = args.includes('--dir') ? path.resolve(args[args.indexOf('--dir') + 1]) : defaultInstallDir()
const model = MODELS[sizeArg]
const modelDir = path.join(root, ...model.repo.repo.split('/'))

async function main() {
  const specs: PinnedFile[] = model.files.map(([source, size, hash]) => ({ repo: model.repo, source, target: source, size, hash }))
  console.log(`Installing ${model.repo.repo} into ${modelDir} (${(specs.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(0)} MB)`)
  mkdirSync(path.join(modelDir, 'onnx'), { recursive: true })
  for (const spec of specs) {
    const file = path.join(modelDir, spec.target)
    if (verifyFile(spec, file)) {
      console.log(`  ✓ ${spec.target} (already present, verified)`)
      continue
    }
    console.log(`  ↓ ${spec.target} (${(spec.size / 1e6).toFixed(1)} MB)`)
    await downloadFile(spec, file)
    if (!verifyFile(spec, file)) throw new Error(`Checksum verification FAILED for ${spec.target}`)
    console.log(`  ✓ ${spec.target} verified`)
  }
  const files = specs.map((s) => {
    const file = path.join(modelDir, s.target)
    return { path: s.target, bytes: statSync(file).size, sha256: sha256File(file), source: `https://huggingface.co/${s.repo.repo}/blob/${s.repo.revision}/${s.source}` }
  })
  writeFileSync(
    path.join(modelDir, 'MODEL_INFO.json'),
    JSON.stringify({
      model: model.repo.repo,
      revision: model.repo.revision,
      installedAt: new Date().toISOString(),
      license: 'OpenAI Whisper weights: MIT. ONNX export by onnx-community (Transformers.js).',
      attribution: 'Whisper, OpenAI (Radford et al. 2022), MIT licence; ONNX export by Hugging Face onnx-community.',
      totalBytes: files.reduce((s, f) => s + f.bytes, 0),
      files,
    }, null, 2),
  )
  console.log('Done.')
}

main().catch((error) => {
  console.error(`\nInstallation failed: ${(error as Error).message}`)
  process.exit(1)
})

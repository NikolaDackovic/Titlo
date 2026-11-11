/** Download + verification helpers for pinned Hugging Face files (used by install scripts). */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, readFileSync, renameSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface PinnedRepo {
  repo: string
  revision: string
}

export interface PinnedFile {
  repo: PinnedRepo
  source: string
  target: string
  size: number
  /** "sha256:<hex>" for LFS files, "git:<sha1>" for small files. */
  hash: string
}

export const sha256File = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const gitBlobFile = (file: string) => {
  const data = readFileSync(file)
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')
}

export function verifyFile(spec: PinnedFile, file: string): boolean {
  if (!existsSync(file) || statSync(file).size !== spec.size) return false
  const [kind, value] = spec.hash.split(':')
  return kind === 'sha256' ? sha256File(file) === value : gitBlobFile(file) === value
}

export async function downloadFile(spec: PinnedFile, file: string) {
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

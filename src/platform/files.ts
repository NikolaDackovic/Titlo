/**
 * Platform file access.
 *
 * Browser build: <input type=file> for opening and a download (or the File System
 * Access save dialog where available) for saving. The desktop build will implement
 * the same functions with Tauri's native dialog + fs plugins.
 */

export interface PickedFile {
  name: string
  size: number
  type: string
  file: File
}

export function pickFile(accept: string[]): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept.join(',')
    input.style.display = 'none'
    let settled = false
    const finish = (value: PickedFile | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(value)
    }
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      finish(file ? { name: file.name, size: file.size, type: file.type, file } : null)
    })
    input.addEventListener('cancel', () => finish(null))
    document.body.appendChild(input)
    input.click()
  })
}

type SaveFilePicker = (options: {
  suggestedName: string
  types?: Array<{ description: string; accept: Record<string, string[]> }>
}) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>

/**
 * Save bytes to a user-chosen location. Returns false if the user cancelled.
 * Uses the native save dialog where the browser supports it (Chromium/WebView2),
 * otherwise a regular download.
 */
export async function saveFile(fileName: string, data: Uint8Array | string, mime = 'text/plain;charset=utf-8'): Promise<boolean> {
  const blob = new Blob([typeof data === 'string' ? data : data.slice().buffer], { type: mime })
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (picker) {
    try {
      const ext = fileName.match(/\.[^.]+$/)?.[0] ?? '.txt'
      const handle = await picker({ suggestedName: fileName, types: [{ description: ext.slice(1).toUpperCase(), accept: { [mime.split(';')[0]]: [ext] } }] })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return false
      // Fall back to a download if the picker fails for another reason.
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

export const readFileBytes = async (file: File) => new Uint8Array(await file.arrayBuffer())
export const readFileText = async (file: File) => (await file.text()).replace(/^﻿/, '')

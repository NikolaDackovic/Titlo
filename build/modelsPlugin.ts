import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import type { Connect, Plugin } from 'vite'

/**
 * Serves the local `models/` directory at `/models/` in dev and preview mode.
 *
 * Models are large and licensed separately, so they are never copied into `dist/`
 * and never fetched from the internet by the app. The desktop (Tauri) build will
 * serve the same directory from the user's model storage location instead.
 */
const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.onnx_data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.model': 'application/octet-stream',
  '.spm': 'application/octet-stream',
}

export function localModelsPlugin(modelsDir: string): Plugin {
  const root = path.resolve(modelsDir)

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url || !req.url.startsWith('/models/')) return next()

    let relative: string
    try {
      relative = decodeURIComponent(req.url.slice('/models/'.length).split('?')[0])
    } catch {
      res.statusCode = 400
      res.end('Bad request')
      return
    }

    const target = path.resolve(root, relative)
    // Path traversal guard: the resolved path must stay inside the models directory.
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    let size: number
    try {
      const stats = statSync(target)
      if (!stats.isFile()) throw new Error('not a file')
      size = stats.size
    } catch {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    res.setHeader('Content-Type', MIME[path.extname(target)] ?? 'application/octet-stream')
    res.setHeader('Content-Length', String(size))
    res.setHeader('Cache-Control', 'no-cache')
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(target).pipe(res)
  }

  return {
    name: 'exyu-local-models',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

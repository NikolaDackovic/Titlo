import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Where local models live (Node side: dev/preview server, benchmark, model tests).
 *
 * 1. EXYU_MODELS_DIR environment variable, if set.
 * 2. %LOCALAPPDATA%\ExYuTitlStudio\models — the default install location. It is kept
 *    outside the project because projects often live in synced folders (OneDrive),
 *    and hundreds of MB of model files must not be uploaded to a cloud drive.
 * 3. ./models inside the project (fallback, gitignored).
 */
export const defaultInstallDir = () =>
  process.env.EXYU_MODELS_DIR
    ? path.resolve(process.env.EXYU_MODELS_DIR)
    : process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'ExYuTitlStudio', 'models')
      : path.resolve('models')

export function resolveModelsDir(projectRoot = process.cwd()): string {
  if (process.env.EXYU_MODELS_DIR) return path.resolve(process.env.EXYU_MODELS_DIR)
  if (process.env.LOCALAPPDATA) {
    const appData = path.join(process.env.LOCALAPPDATA, 'ExYuTitlStudio', 'models')
    if (existsSync(appData)) return appData
  }
  return path.resolve(projectRoot, 'models')
}

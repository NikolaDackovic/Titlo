import type { LogRepository } from '../persistence/repositories/misc'
import { notify } from './notifications'

/**
 * Central error handling: every caught error goes through `reportError`, which logs
 * it (console + app_logs table) and shows a notification. Nothing is swallowed silently.
 */
let logRepo: LogRepository | null = null

export function attachLogRepository(repo: LogRepository) {
  logRepo = repo
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function log(level: 'info' | 'warn' | 'error', message: string, details?: unknown) {
  const detailText = details === undefined ? undefined : details instanceof Error ? `${details.name}: ${details.message}\n${details.stack ?? ''}` : errorMessage(details)
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
  consoleFn(`[Titlo] ${message}`, details ?? '')
  try {
    logRepo?.write(level, message, detailText)
  } catch {
    /* logging must never throw */
  }
}

export function reportError(context: string, error: unknown, options: { silent?: boolean } = {}) {
  log('error', context, error)
  if (!options.silent) notify('error', context, errorMessage(error))
}

export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    reportError('Unexpected error', event.error ?? event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportError('Unexpected error in background task', event.reason)
  })
}

import { useCallback, useSyncExternalStore } from 'react'
import { SR } from './sr'

/**
 * Minimal i18n: English source strings are the keys, Serbian (Latin) is the default UI
 * language. Missing Serbian entries fall back to English (a unit test checks coverage).
 * Usable from React (useT) and from plain modules (t), e.g. QC messages.
 */
export type Locale = 'sr' | 'en'
export const LOCALES: Array<{ id: Locale; label: string }> = [
  { id: 'sr', label: 'Srpski (latinica)' },
  { id: 'en', label: 'English' },
]

let locale: Locale = 'sr'
const listeners = new Set<() => void>()

export function setLocale(next: Locale) {
  if (next === locale) return
  locale = next
  if (typeof document !== 'undefined') document.documentElement.lang = next === 'sr' ? 'sr-Latn' : 'en'
  listeners.forEach((l) => l())
}
export const getLocale = () => locale

export type Vars = Record<string, string | number>

export function t(key: string, vars?: Vars): string {
  const template = locale === 'sr' ? (SR[key] ?? key) : key
  return vars ? template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : template
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Re-renders the component when the UI language changes. */
export function useT() {
  const current = useSyncExternalStore(subscribe, getLocale)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((key: string, vars?: Vars) => t(key, vars), [current])
}

export const useLocale = () => useSyncExternalStore(subscribe, getLocale)

/** Plural helper for Serbian: 1 segment, 2–4 segmenta, 5+ segmenata. */
export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

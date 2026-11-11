/**
 * Rebranding guard: the UI says "Titlo" and "Terminologija/Terminology", never the old product name
 * or "Glosar/Glossary". Internal identifiers (storage keys, profile id `exyu-neutral`, the
 * "ExYu Neutral" language profile, module names) are intentionally unchanged.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getLocale, setLocale, t } from './i18n'
import { SR } from './i18n/sr'

// "ExYu Neutral" (language profile) is allowed; the old product names and an all-caps "EXYU" are not.
const OLD_NAME = { test: (s: string) => /ExYu\s*Titl|Titl\s*Studio|ExYu Subtitle|Subtitle Studio/i.test(s) || /\bEXYU\b/.test(s) }
const OLD_FEATURE = /glos+ar/i

const uiFiles = () => {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.') && !p.includes(join('i18n', 'sr.ts'))) out.push(p)
    }
  }
  walk(__dirname)
  return out
}

/** Strings shown to the user: t()/L()/tt() keys and JSX text. */
function visibleStrings(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const keys = [...text.matchAll(/\b(?:t|L|tt)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2])
  const jsx = file.endsWith('.tsx') ? [...text.matchAll(/>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*)\s*</g)].map((m) => m[1]) : []
  return [...keys, ...jsx]
}

describe('Titlo branding', () => {
  it('the browser tab, the sidebar and the start screen say Titlo', () => {
    const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8')
    expect(html).toMatch(/<title>Titlo\b/)
    expect(OLD_NAME.test(html)).toBe(false)
    expect(readFileSync(join(__dirname, 'app', 'App.tsx'), 'utf8')).toContain('<div className="brand-name">Titlo</div>')
    expect(readFileSync(join(__dirname, 'app', 'BootScreen.tsx'), 'utf8')).toContain('Titlo')
  })

  it('no user-visible string uses the old product name', () => {
    const hits = uiFiles().flatMap((f) => visibleStrings(f).filter((s) => OLD_NAME.test(s)).map((s) => `${f}: ${s}`))
    expect(hits).toEqual([])
    expect(Object.entries(SR).filter(([k, v]) => OLD_NAME.test(k) || OLD_NAME.test(v))).toEqual([])
  })

  it('"Glosar/Glossary" is called Terminology everywhere in the UI (SR and EN)', () => {
    const hits = uiFiles().flatMap((f) => visibleStrings(f).filter((s) => OLD_FEATURE.test(s)).map((s) => `${f}: ${s}`))
    expect(hits).toEqual([])
    expect(Object.entries(SR).filter(([k, v]) => OLD_FEATURE.test(k) || OLD_FEATURE.test(v))).toEqual([])
    const before = getLocale()
    setLocale('sr')
    expect(t('Terminology')).toBe('Terminologija')
    expect(t('Term lists')).toBe('Liste termina')
    setLocale('en')
    expect(t('Terminology')).toBe('Terminology')
    setLocale(before)
  })

  it('keeps the "ExYu Neutral" language profile and the internal storage keys (compatibility)', () => {
    expect(SR['ExYu Neutral']).toBeDefined()
    expect(readFileSync(join(__dirname, 'persistence', 'snapshotStore.ts'), 'utf8')).toContain("const DB_NAME = 'exyu-titl-studio'")
  })
})

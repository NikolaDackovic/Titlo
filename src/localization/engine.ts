import { getProfile, resolveYat, type ProfileId, type Variant, type Yat } from '../domain/languages'
import { findTerm, isSentenceStart, matchCase } from './matching'
import { neutralVariantFor, type TermConcept } from './termbase'
import { cyrillicToLatinWithMap, latinToCyrillic, stripProtected } from './transliterate'
import { yatCounterpart, wrongYatWords } from './yat'
import { t as L } from '../i18n'

/**
 * Localization engine.
 *
 * It never edits text by itself. It produces *proposals* (position, original,
 * replacement, reason, confidence). The UI shows them, the user accepts or rejects
 * each one, and accepted proposals are applied through the undo history.
 */

export type ProposalSource = 'glossary' | 'termbase' | 'syntax' | 'yat'
export type ProposalConfidence = 'high' | 'review'

export interface LocalizationProposal {
  id: string
  start: number
  end: number
  original: string
  /** `null` = advisory only (no safe automatic replacement exists). */
  replacement: string | null
  source: ProposalSource
  ruleId: string
  confidence: ProposalConfidence
  reason: string
  priority: number
}

/** A user-defined replacement rule applied on target-language text (from a glossary). */
export interface LocalizationRule {
  id: string
  from: string
  to: string
  /** Profiles the rule applies to (empty = all). */
  profiles: ProfileId[]
  wholeWord: boolean
  caseSensitive: boolean
  priority: number
  /** Phrases in which the rule must NOT apply (e.g. proper names). */
  exceptions: string[]
  note?: string
}

export interface LocalizationContext {
  profile: ProfileId
  neutralYat: Yat
  termbase: TermConcept[]
  rules: LocalizationRule[]
}

const PRIORITY = { glossary: 100, termbase: 50, syntax: 20, yat: 10 }

/** Which lexical variant the profile should use (Neutral → majority per concept). */
const targetVariantFor = (profile: ProfileId, concept: TermConcept): Variant | null => {
  const def = getProfile(profile)
  return def.variant ?? neutralVariantFor(concept)
}

interface IndexedForm {
  concept: TermConcept
  variant: Variant
  index: number
  caseAmbiguous: boolean
}

/** form (lowercase) → concepts/variants it belongs to. Cached per termbase array. */
const formIndexCache = new WeakMap<TermConcept[], Map<string, IndexedForm[]>>()

function formIndex(termbase: TermConcept[]) {
  let index = formIndexCache.get(termbase)
  if (index) return index
  index = new Map()
  for (const concept of termbase) {
    for (const variant of ['sr', 'hr', 'bs'] as Variant[]) {
      const forms = concept.forms[variant]
      forms.forEach((form, i) => {
        if (forms.indexOf(form) !== i) return // first occurrence only
        const list = index!.get(form) ?? []
        list.push({ concept, variant, index: i, caseAmbiguous: forms.lastIndexOf(form) !== i })
        index!.set(form, list)
      })
    }
  }
  formIndexCache.set(termbase, index)
  return index
}

function termbaseProposals(text: string, ctx: LocalizationContext): LocalizationProposal[] {
  const out: LocalizationProposal[] = []
  const index = formIndex(ctx.termbase)
  const profileLabel = L(getProfile(ctx.profile).label)

  for (const m of text.matchAll(/\p{L}+/gu)) {
    const word = m[0]
    const entries = index.get(word.toLowerCase())
    if (!entries) continue
    const start = m.index!
    const done = new Set<string>()
    for (const entry of entries) {
      const { concept, variant } = entry
      if (done.has(concept.id)) continue
      const target = targetVariantFor(ctx.profile, concept)
      if (!target || variant === target) continue
      if (concept.applyTo && !concept.applyTo.includes(target)) continue
      const targetForms = concept.forms[target]
      if (targetForms.includes(word.toLowerCase())) continue // already valid in target
      done.add(concept.id)

      const replacementBase = targetForms[entry.index] ?? targetForms[0]
      const capitalizedMidSentence = /^\p{Lu}/u.test(word) && !isSentenceStart(text, start)
      const reasons = [L('"{word}" is a {variant} form of "{gloss}"; {profile} uses "{replacement}".', { word, variant: variant.toUpperCase(), gloss: concept.gloss, profile: profileLabel, replacement: replacementBase })]
      if (concept.ambiguous) reasons.push(L(concept.ambiguous))
      if (entry.caseAmbiguous || entry.index >= targetForms.length) reasons.push(L('Grammatical case could not be determined; check the ending.'))
      if (capitalizedMidSentence) reasons.push(L('Capitalised mid-sentence — may be a name.'))
      if (concept.note) reasons.push(L(concept.note))
      out.push({
        id: `tb:${concept.id}:${start}`,
        start,
        end: start + word.length,
        original: word,
        replacement: matchCase(word, replacementBase),
        source: 'termbase',
        ruleId: concept.id,
        confidence:
          concept.strength === 'soft' || concept.ambiguous || entry.caseAmbiguous || capitalizedMidSentence ? 'review' : 'high',
        reason: reasons.join(' '),
        priority: PRIORITY.termbase + (concept.strength === 'soft' ? -10 : 0),
      })
    }
  }
  return out
}

function ruleProposals(text: string, ctx: LocalizationContext): LocalizationProposal[] {
  const out: LocalizationProposal[] = []
  for (const rule of ctx.rules) {
    if (rule.profiles.length && !rule.profiles.includes(ctx.profile)) continue
    const exceptionRanges = rule.exceptions.flatMap((ex) => findTerm(text, ex, { wholeWord: true, caseSensitive: false }))
    for (const m of findTerm(text, rule.from, { wholeWord: rule.wholeWord, caseSensitive: rule.caseSensitive })) {
      if (exceptionRanges.some((r) => m.start >= r.start && m.end <= r.end)) continue
      const replacement = rule.caseSensitive ? rule.to : matchCase(m.text, rule.to)
      if (replacement === m.text) continue
      out.push({
        id: `gl:${rule.id}:${m.start}`,
        start: m.start,
        end: m.end,
        original: m.text,
        replacement,
        source: 'glossary',
        ruleId: rule.id,
        confidence: 'high',
        reason: L('Terminology rule "{from}" → "{to}".', { from: rule.from, to: rule.to }) + (rule.note ? ` ${rule.note}` : ''),
        priority: PRIORITY.glossary + rule.priority,
      })
    }
  }
  return out
}

/** Croatian standard prefers infinitive after modal verbs ("moram ići", not "moram da idem"). */
const HR_MODAL_DA = /(?<![\p{L}])(mogu|možeš|može|možemo|možete|moram|moraš|mora|moramo|morate|moraju|hoću|hoćeš|želim|želiš|želi|trebam|trebaš|treba|smijem|smiješ)\s+da\s+(\p{L}+)/giu

function syntaxProposals(text: string, ctx: LocalizationContext): LocalizationProposal[] {
  if (getProfile(ctx.profile).variant !== 'hr') return []
  const out: LocalizationProposal[] = []
  for (const m of text.matchAll(HR_MODAL_DA)) {
    out.push({
      id: `syn:hr-modal-da:${m.index}`,
      start: m.index!,
      end: m.index! + m[0].length,
      original: m[0],
      replacement: null,
      source: 'syntax',
      ruleId: 'hr-modal-da',
      confidence: 'review',
      reason: L('Croatian standard usually uses the infinitive after modal verbs (e.g. "moram ići" instead of "moram da idem"). Rewrite manually — the verb form cannot be derived safely.'),
      priority: PRIORITY.syntax,
    })
  }
  return out
}

function yatProposals(text: string, ctx: LocalizationContext): LocalizationProposal[] {
  const expected = resolveYat(ctx.profile, ctx.neutralYat)
  const wrong = new Set(wrongYatWords(text, expected))
  const out: LocalizationProposal[] = []
  for (const word of wrong) {
    const counterpart = yatCounterpart(word, expected)
    for (const m of findTerm(text, word, { wholeWord: true, caseSensitive: false })) {
      out.push({
        id: `yat:${word}:${m.start}`,
        start: m.start,
        end: m.end,
        original: m.text,
        replacement: counterpart ? matchCase(m.text, counterpart) : null,
        source: 'yat',
        ruleId: `yat-${expected}`,
        confidence: 'review',
        reason: L('{label} uses the {expected} reflex; "{text}" is {v}.', { label: L(getProfile(ctx.profile).label), expected: L(expected), text: m.text, v: L(expected === 'ekavian' ? 'ijekavian' : 'ekavian') }),
        priority: PRIORITY.yat,
      })
    }
  }
  return out
}

export interface ProposalSet {
  proposals: LocalizationProposal[]
  /** Proposals dropped because a higher-priority rule covers the same text. */
  conflicts: Array<{ kept: LocalizationProposal; dropped: LocalizationProposal }>
}

export function findLocalizationProposals(text: string, ctx: LocalizationContext): ProposalSet {
  if (!text.trim() || getProfile(ctx.profile).language === 'en') return { proposals: [], conflicts: [] }
  // Markup and URLs must never be matched: blank them out while keeping offsets.
  const masked = stripProtectedKeepingOffsets(text)

  const all = [
    ...ruleProposals(masked, ctx),
    ...termbaseProposals(masked, ctx),
    ...syntaxProposals(masked, ctx),
    ...yatProposals(masked, ctx),
  ].map((p) => ({ ...p, original: text.slice(p.start, p.end) }))

  all.sort((a, b) => b.priority - a.priority || a.start - b.start)
  const kept: LocalizationProposal[] = []
  const conflicts: ProposalSet['conflicts'] = []
  for (const p of all) {
    const clash = kept.find((k) => p.start < k.end && k.start < p.end)
    if (clash) conflicts.push({ kept: clash, dropped: p })
    else kept.push(p)
  }
  kept.sort((a, b) => a.start - b.start)
  return { proposals: kept, conflicts }
}

/** Replace protected regions with spaces of equal length so match offsets stay valid. */
function stripProtectedKeepingOffsets(text: string): string {
  return text.replace(/(<[^>]+>|\{\\[^}]*\}|https?:\/\/\S+|www\.\S+)/g, (m) => ' '.repeat(m.length))
}

/**
 * Apply accepted proposals (only ones with a replacement). Applied right-to-left so
 * offsets stay valid. Throws if proposals overlap, which indicates a caller bug.
 */
export function applyProposals(text: string, accepted: LocalizationProposal[]): string {
  const applicable = accepted.filter((p) => p.replacement !== null).sort((a, b) => b.start - a.start)
  for (let i = 1; i < applicable.length; i += 1) {
    if (applicable[i].end > applicable[i - 1].start) throw new Error('Overlapping localization proposals cannot be applied together.')
  }
  let out = text
  for (const p of applicable) {
    if (out.slice(p.start, p.end) !== p.original) throw new Error(`Text changed since proposal "${p.original}" was created; re-run localization.`)
    out = out.slice(0, p.start) + p.replacement + out.slice(p.end)
  }
  return out
}

/**
 * Apply proposals that were computed on the Latin view of a CYRILLIC text. Only the matched
 * words are replaced (converted to Cyrillic); everything else — intentional Latin words,
 * н+ј / д+ж letter pairs, markup — stays exactly as it was.
 */
export function applyProposalsToCyrillic(text: string, accepted: LocalizationProposal[]): string {
  const { latin, map } = cyrillicToLatinWithMap(text)
  const applicable = accepted.filter((p) => p.replacement !== null).sort((a, b) => b.start - a.start)
  for (let i = 1; i < applicable.length; i += 1) {
    if (applicable[i].end > applicable[i - 1].start) throw new Error('Overlapping localization proposals cannot be applied together.')
  }
  let out = text
  for (const p of applicable) {
    if (latin.slice(p.start, p.end) !== p.original) throw new Error(`Text changed since proposal "${p.original}" was created; re-run localization.`)
    out = out.slice(0, map[p.start]) + latinToCyrillic(p.replacement!) + out.slice(map[p.end])
  }
  return out
}

/** Concepts for which forms of both Serbian and Croatian occur in the given texts (consistency check). */
export function findMixedVariantConcepts(texts: string[], termbase: TermConcept[]) {
  const index = formIndex(termbase)
  const hits = new Map<string, { concept: TermConcept; found: Partial<Record<Variant, Set<string>>> }>()
  for (const text of texts) {
    for (const m of stripProtected(text).matchAll(/\p{L}+/gu)) {
      const word = m[0].toLowerCase()
      for (const entry of index.get(word) ?? []) {
        const record = hits.get(entry.concept.id) ?? { concept: entry.concept, found: {} }
        ;(record.found[entry.variant] ??= new Set()).add(word)
        hits.set(entry.concept.id, record)
      }
    }
  }
  const result: Array<{ concept: TermConcept; found: Partial<Record<Variant, string[]>> }> = []
  for (const { concept, found } of hits.values()) {
    const srOnly = [...(found.sr ?? [])].filter((f) => !concept.forms.hr.includes(f))
    const hrOnly = [...(found.hr ?? [])].filter((f) => !concept.forms.sr.includes(f))
    if (srOnly.length && hrOnly.length) {
      result.push({ concept, found: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v!]])) })
    }
  }
  return result
}

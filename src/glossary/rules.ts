import type { ProfileId } from '../domain/languages'
import type { LocalizationRule } from '../localization/engine'
import { findTerm } from '../localization/matching'
import { neutralVariantFor, type TermConcept } from '../localization/termbase'
import { getProfile } from '../domain/languages'
import type { Glossary, GlossaryTerm } from './types'
import { t as L } from '../i18n'

const appliesTo = (scope: GlossaryTerm['targetProfile'] | Glossary['profile'], profile: ProfileId) =>
  scope === 'all' || scope === profile

/** Enabled terms of enabled glossaries that apply to the given profile. */
export function activeTerms(glossaries: Glossary[], terms: GlossaryTerm[], profile: ProfileId): GlossaryTerm[] {
  const enabled = new Map(glossaries.filter((g) => g.enabled && appliesTo(g.profile, profile)).map((g) => [g.id, g]))
  return terms.filter((t) => t.enabled && enabled.has(t.glossaryId) && appliesTo(t.targetProfile, profile))
}

export function toLocalizationRules(terms: GlossaryTerm[]): LocalizationRule[] {
  return terms
    .filter((t) => t.kind === 'localization')
    .map((t) => ({
      id: t.id,
      from: t.sourceTerm,
      to: t.targetTerm,
      profiles: t.targetProfile === 'all' ? [] : [t.targetProfile],
      wholeWord: t.wholeWord,
      caseSensitive: t.caseSensitive,
      priority: t.priority,
      // The "context" field can list exceptions separated by "|" (e.g. "Voz Express|Vozdovac").
      exceptions: t.context
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('!'))
        .map((s) => s.slice(1)),
      note: t.notes || undefined,
    }))
}

export interface GlossaryConflict {
  severity: 'warning' | 'info'
  termIds: string[]
  message: string
}

/** Detect contradictory or overlapping rules across all enabled glossaries. */
export function findGlossaryConflicts(glossaries: Glossary[], terms: GlossaryTerm[], termbase: TermConcept[]): GlossaryConflict[] {
  const conflicts: GlossaryConflict[] = []
  const enabledGlossaries = new Set(glossaries.filter((g) => g.enabled).map((g) => g.id))
  const active = terms.filter((t) => t.enabled && enabledGlossaries.has(t.glossaryId))
  const profileOverlap = (a: GlossaryTerm, b: GlossaryTerm) =>
    a.targetProfile === 'all' || b.targetProfile === 'all' || a.targetProfile === b.targetProfile

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i]
      const b = active[j]
      if (a.kind !== b.kind || a.sourceLanguage !== b.sourceLanguage || !profileOverlap(a, b)) continue
      const sameSource = a.sourceTerm.toLowerCase() === b.sourceTerm.toLowerCase()
      if (sameSource && a.targetTerm.toLowerCase() !== b.targetTerm.toLowerCase()) {
        conflicts.push({
          severity: 'warning',
          termIds: [a.id, b.id],
          message: L('"{sourceTerm}" has two different targets: "{targetTerm}" and "{targetTerm2}". The higher priority wins ({priority} vs {priority2}).', { sourceTerm: a.sourceTerm, targetTerm: a.targetTerm, targetTerm2: b.targetTerm, priority: a.priority, priority2: b.priority }),
        })
      } else if (sameSource) {
        conflicts.push({ severity: 'info', termIds: [a.id, b.id], message: L('"{sourceTerm}" is defined twice with the same target.', { sourceTerm: a.sourceTerm }) })
      } else if (findTerm(b.sourceTerm, a.sourceTerm, { wholeWord: true, caseSensitive: false }).length) {
        conflicts.push({ severity: 'info', termIds: [a.id, b.id], message: L('"{sourceTerm}" is contained in "{sourceTerm2}"; the longer/higher-priority term wins where both match.', { sourceTerm: a.sourceTerm, sourceTerm2: b.sourceTerm }) })
      } else if (findTerm(a.sourceTerm, b.sourceTerm, { wholeWord: true, caseSensitive: false }).length) {
        conflicts.push({ severity: 'info', termIds: [a.id, b.id], message: L('"{sourceTerm}" is contained in "{sourceTerm2}"; the longer/higher-priority term wins where both match.', { sourceTerm: b.sourceTerm, sourceTerm2: a.sourceTerm }) })
      }
      if (a.kind === 'localization' && a.targetTerm.toLowerCase() === b.sourceTerm.toLowerCase()) {
        conflicts.push({ severity: 'warning', termIds: [a.id, b.id], message: L('Rule chain: "{sourceTerm}" → "{targetTerm}" → "{targetTerm2}". Rules are not applied recursively.', { sourceTerm: a.sourceTerm, targetTerm: a.targetTerm, targetTerm2: b.targetTerm }) })
      }
    }
  }

  // Localization rules that contradict the built-in termbase.
  for (const t of active.filter((x) => x.kind === 'localization')) {
    for (const concept of termbase) {
      const lower = t.sourceTerm.toLowerCase()
      const variants = (['sr', 'hr', 'bs'] as const).filter((v) => concept.forms[v].includes(lower))
      if (!variants.length) continue
      const profiles: ProfileId[] = t.targetProfile === 'all' ? ['exyu-neutral', 'sr-Latn', 'hr', 'bs'] : t.targetProfile === 'en' ? [] : [t.targetProfile]
      for (const p of profiles) {
        const variant = getProfile(p).variant ?? neutralVariantFor(concept)
        if (!variant) continue
        const index = concept.forms[variants[0]].indexOf(lower)
        const expected = concept.forms[variant][index]
        if (expected && expected !== t.targetTerm.toLowerCase()) {
          conflicts.push({
            severity: 'info',
            termIds: [t.id],
            message: L('Rule "{sourceTerm}" → "{targetTerm}" overrides the built-in termbase for {label} (which suggests "{expected}"). Terminology rules take priority.', { sourceTerm: t.sourceTerm, targetTerm: t.targetTerm, label: L(getProfile(p).label), expected }),
          })
        }
      }
    }
  }
  return conflicts
}

import type { GlossaryTermInput } from '../glossary/types'
import { emptyTerm } from '../glossary/types'
import type { GlossaryRepository } from './repositories/glossaries'
import type { SettingsRepository } from './repositories/misc'

const term = (patch: Partial<GlossaryTermInput>): GlossaryTermInput => ({ ...emptyTerm(), ...patch })

/** Starter term list — examples from the product brief. Users can edit or disable it. */
export const STARTER_TERMS: GlossaryTermInput[] = [
  term({ sourceTerm: 'Apartment', targetTerm: 'stan', notes: 'Residential flat.' }),
  term({ sourceTerm: 'Elevator', targetTerm: 'lift', notes: '"Lift" is understood in all variants.' }),
  term({ sourceTerm: 'Car', targetTerm: 'automobil', alternatives: ['auto', 'kola'], notes: '"Auto" is fine in casual dialogue.' }),
  term({ sourceTerm: 'Movie theater', targetTerm: 'bioskop', targetProfile: 'sr-Latn' }),
  term({ sourceTerm: 'Movie theater', targetTerm: 'bioskop', targetProfile: 'sr-Cyrl' }),
  term({ sourceTerm: 'Movie theater', targetTerm: 'kino', targetProfile: 'hr' }),
  term({ sourceTerm: 'Movie theater', targetTerm: 'kino', targetProfile: 'bs' }),
]

export function seedIfEmpty(glossaries: GlossaryRepository, settings: SettingsRepository) {
  if (settings.get('seeded_v1', false)) return
  // Existing databases keep their (already seeded) list and its name.
  const starter = glossaries.create({ name: 'Starter terminology (EN)', description: 'Example terms. Edit, extend or disable.', isGlobal: true })
  glossaries.addTerms(starter.id, STARTER_TERMS)
  settings.set('seeded_v1', true)
}

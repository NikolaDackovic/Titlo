import { Check, CornerDownRight, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getProfile, type ProfileId, type Yat } from '../../../domain/languages'
import type { Segment } from '../../../domain/types'
import { applyProposals, applyProposalsToCyrillic, findLocalizationProposals, type LocalizationProposal, type LocalizationRule } from '../../../localization/engine'
import type { TermConcept } from '../../../localization/termbase'
import { cyrillicToLatin, latinToCyrillic } from '../../../localization/transliterate'
import { reportError } from '../../../services/errors'
import { useLocale, useT } from '../../../i18n'

interface Props {
  segments: Segment[]
  profile: ProfileId
  neutralYat: Yat
  termbase: TermConcept[]
  rules: LocalizationRule[]
  activeId: string | null
  onApply: (changes: Array<{ segmentId: string; text: string }>) => void
  onJump: (segmentId: string) => void
}

interface Item {
  segmentId: string
  number: number
  proposal: LocalizationProposal
}

const SOURCE_LABEL = { glossary: 'Terminology', termbase: 'Regional', syntax: 'Syntax', yat: 'Yat' }

export function LocalizationPanel({ segments, profile, neutralYat, termbase, rules, activeId, onApply, onJump }: Props) {
  const t = useT()
  const locale = useLocale()
  const [scope, setScope] = useState<'segment' | 'project'>('project')
  const [ignored, setIgnored] = useState<Set<string>>(new Set())
  const def = getProfile(profile)
  const cyr = def.script === 'Cyrl'

  const items = useMemo(() => {
    const out: Item[] = []
    segments.forEach((s, i) => {
      if (scope === 'segment' && s.id !== activeId) return
      const tr = s.translations[profile]
      if (!tr?.text.trim() || tr.locked) return
      const view = cyr ? cyrillicToLatin(tr.text) : tr.text
      for (const p of findLocalizationProposals(view, { profile, neutralYat, termbase, rules }).proposals) {
        out.push({ segmentId: s.id, number: i + 1, proposal: p })
      }
    })
    return out
    // Reasons are generated in the current UI language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, scope, activeId, profile, neutralYat, termbase, rules, cyr, locale])

  const visible = items.filter((it) => !ignored.has(`${it.segmentId}:${it.proposal.id}`))
  const autoApplicable = visible.filter((it) => it.proposal.replacement !== null && it.proposal.confidence === 'high')

  const accept = (list: Item[]) => {
    const bySegment = new Map<string, LocalizationProposal[]>()
    for (const it of list) {
      if (it.proposal.replacement === null) continue
      bySegment.set(it.segmentId, [...(bySegment.get(it.segmentId) ?? []), it.proposal])
    }
    const changes: Array<{ segmentId: string; text: string }> = []
    try {
      for (const [segmentId, proposals] of bySegment) {
        const seg = segments.find((s) => s.id === segmentId)
        const tr = seg?.translations[profile]
        if (!tr) continue
        // Cyrillic: edit only the matched words in the original text (no full round-trip).
        changes.push({ segmentId, text: cyr ? applyProposalsToCyrillic(tr.text, proposals) : applyProposals(tr.text, proposals) })
      }
      onApply(changes)
    } catch (error) {
      reportError(t('Could not apply the changes'), error)
    }
  }

  return (
    <>
      <div className="filters">
        <div className="btn-group">
          <button className={`btn sm${scope === 'project' ? ' active' : ''}`} onClick={() => setScope('project')}>{t('Whole project')}</button>
          <button className={`btn sm${scope === 'segment' ? ' active' : ''}`} onClick={() => setScope('segment')}>{t('Current subtitle')}</button>
        </div>
        <span className="small muted">
          {t('{n} suggestion(s) for', { n: visible.length })} <strong>{t(def.label)}</strong>
          {profile === 'exyu-neutral' && ` · ${t(neutralYat === 'ijekavian' ? 'ijekavian' : 'ekavian')}`}
        </span>
        <span className="spacer" />
        {ignored.size > 0 && (
          <button className="btn sm ghost" onClick={() => setIgnored(new Set())}>
            {t('Show ignored ({n})', { n: ignored.size })}
          </button>
        )}
        <button className="btn sm primary" disabled={!autoApplicable.length} onClick={() => accept(autoApplicable)} title={t('Applies only high-confidence replacements; the others wait for your decision')}>
          <Check size={13} /> {t('Accept {n} reliable', { n: autoApplicable.length })}
        </button>
      </div>
      <div className="dock-body">
        {visible.length === 0 && (
          <div className="empty small">
            <p>{t('No regional suggestions.')} {items.length ? '' : t('The subtitles already follow this profile, or nothing is translated yet.')}</p>
            <p className="tiny subtle">{t('Suggestions come from the regional dictionary, ekavian/ijekavian detection, Croatian syntax hints and your Terminology. Nothing is changed without your approval.')}</p>
          </div>
        )}
        {visible.slice(0, 500).map((it) => {
          const p = it.proposal
          return (
            <div key={`${it.segmentId}:${p.id}`} className="proposal">
              <span className="mono subtle" style={{ cursor: 'pointer' }} onClick={() => onJump(it.segmentId)}>
                #{it.number}
              </span>
              <div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="badge">{t(SOURCE_LABEL[p.source])}</span>
                  <span className={`badge ${p.confidence === 'high' ? 'ok' : 'warn'}`}>{p.confidence === 'high' ? t('Reliable') : t('Check')}</span>
                  <span className="change">
                    <span className="from">{cyr ? latinToCyrillic(p.original) : p.original}</span>
                    {p.replacement !== null && (
                      <>
                        {' → '}
                        <span className="to">{cyr ? latinToCyrillic(p.replacement) : p.replacement}</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="why">{p.reason}</div>
              </div>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn sm ghost" onClick={() => onJump(it.segmentId)} title={t('Jump to subtitle')}>
                  <CornerDownRight size={13} />
                </button>
                {p.replacement !== null && (
                  <button className="btn sm" onClick={() => accept([it])}>
                    <Check size={13} /> {t('Accept')}
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => setIgnored((s) => new Set(s).add(`${it.segmentId}:${p.id}`))} title={t('Ignore')}>
                  <X size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

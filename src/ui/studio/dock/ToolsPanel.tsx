import { ArrowDownUp, ClipboardCopy, Clock, Type } from 'lucide-react'
import { useState } from 'react'
import { getProfile, SOURCE_LANGUAGES, type ProfileId, type SourceLanguage, type Yat } from '../../../domain/languages'
import type { Segment } from '../../../domain/types'
import { notify } from '../../../services/notifications'
import { copySourceToProfile, deriveCyrillic, shiftTimes, sortByStart } from '../../../state/segmentOps'

interface Props {
  segments: Segment[]
  profile: ProfileId
  sourceLanguage: SourceLanguage
  neutralYat: Yat
  selected: string[]
  onChange: (fn: (s: Segment[]) => Segment[], label: string) => void
  onProject: (patch: { sourceLanguage?: SourceLanguage; neutralYat?: Yat }) => void
}

import { useT } from '../../../i18n'

export function ToolsPanel({ segments, profile, sourceLanguage, neutralYat, selected, onChange, onProject }: Props) {
  const t = useT()
  const [shift, setShift] = useState('0')
  const [overwriteCyr, setOverwriteCyr] = useState(false)
  const latinCount = segments.filter((s) => s.translations['sr-Latn']?.text.trim()).length
  const def = getProfile(profile)

  return (
    <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
      <div className="col">
        <strong className="small row"><Type size={14} /> {t('Serbian Cyrillic')}</strong>
        <p className="tiny muted">{t('Create Serbian Cyrillic from the Serbian Latin subtitles (lj/nj/dž handled correctly, formatting and foreign words kept).')}</p>
        <label className="check small"><input type="checkbox" checked={overwriteCyr} onChange={(e) => setOverwriteCyr(e.target.checked)} /> {t('Overwrite manual Cyrillic edits')}</label>
        <button
          className="btn sm"
          disabled={!latinCount}
          onClick={() => {
            const r = deriveCyrillic(segments, overwriteCyr)
            onChange((cur) => deriveCyrillic(cur, overwriteCyr).segments, 'Derive Cyrillic')
            notify('success', t('Serbian Cyrillic generated'), t('{created} subtitle(s) transliterated, {kept} manual/approved kept. Switch the profile to Serbian (Cyrillic) to review.', { created: r.created, kept: r.kept }))
          }}
        >
          {t('Generate from Serbian Latin ({n})', { n: latinCount })}
        </button>
      </div>

      <div className="col">
        <strong className="small row"><ClipboardCopy size={14} /> {t('Source language')}</strong>
        <p className="tiny muted">{t('For Serbian/Croatian/Bosnian sources the original is copied into {profile} as a starting point; then review the Regional suggestions tab.', { profile: t(def.label) })}</p>
        <div className="row">
          <select className="select" style={{ width: 140 }} value={sourceLanguage} onChange={(e) => onProject({ sourceLanguage: e.target.value as SourceLanguage })} title={t('Source language')}>
            {SOURCE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{t(l.label)}</option>)}
          </select>
          <button
            className="btn sm"
            onClick={() => {
              const { copied } = copySourceToProfile(segments, profile, def.script === 'Cyrl')
              onChange((cur) => copySourceToProfile(cur, profile, def.script === 'Cyrl').segments, 'Copy source')
              notify('success', t('Source copied'), t('{n} empty subtitle(s) filled with the original text (marked "Needs review").', { n: copied }))
            }}
          >
            {t('Copy the original as a starting point')}
          </button>
        </div>
        {profile === 'exyu-neutral' && (
          <div className="row">
            <span className="small muted">{t('ExYu Neutral: yat')}:</span>
            <select className="select" style={{ width: 160 }} value={neutralYat} onChange={(e) => onProject({ neutralYat: e.target.value as Yat })}>
              <option value="ijekavian">{t('Ijekavian')}</option>
              <option value="ekavian">{t('Ekavian')}</option>
            </select>
          </div>
        )}
      </div>

      <div className="col">
        <strong className="small row"><Clock size={14} /> {t('Timing')}</strong>
        <div className="row">
          <input className="input mono" style={{ width: 100 }} value={shift} onChange={(e) => setShift(e.target.value)} aria-label={t('Shift in milliseconds')} />
          <span className="small muted">ms</span>
          <button
            className="btn sm"
            disabled={!Number.isFinite(Number(shift)) || Number(shift) === 0}
            onClick={() => onChange((cur) => shiftTimes(cur, Math.round(Number(shift)), selected.length > 1 ? selected : undefined), 'Shift timing')}
          >
            {selected.length > 1 ? t('Shift {n} selected', { n: selected.length }) : t('Shift all')}
          </button>
        </div>
        <p className="tiny muted">{t('Positive = later. Negative values move subtitles earlier.')}</p>
        <button className="btn sm" onClick={() => onChange((cur) => sortByStart(cur), 'Sort')}>
          <ArrowDownUp size={13} /> {t('Sort subtitles by start time')}
        </button>
      </div>
    </div>
  )
}

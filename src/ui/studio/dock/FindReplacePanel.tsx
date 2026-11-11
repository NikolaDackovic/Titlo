import { ArrowDown, Replace, ReplaceAll } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProfileId } from '../../../domain/languages'
import type { Segment } from '../../../domain/types'
import { notify } from '../../../services/notifications'
import { findMatches, replaceAll, type FindOptions } from '../../../state/segmentOps'

interface Props {
  segments: Segment[]
  profile: ProfileId
  activeId: string | null
  focusToken: number
  onJump: (id: string) => void
  onReplace: (fn: (segments: Segment[]) => Segment[]) => void
}

import { useT } from '../../../i18n'

export function FindReplacePanel({ segments, profile, activeId, focusToken, onJump, onReplace }: Props) {
  const t = useT()
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [field, setField] = useState<FindOptions['field']>('translation')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusToken])

  const options: FindOptions = { find, field, profile, caseSensitive, wholeWord }
  const matches = useMemo(() => findMatches(segments, options), [segments, find, field, profile, caseSensitive, wholeWord]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = matches.reduce((n, m) => n + m.count, 0)

  const next = () => {
    if (!matches.length) return
    const order = segments.map((s) => s.id)
    const current = activeId ? order.indexOf(activeId) : -1
    const target = matches.find((m) => order.indexOf(m.segmentId) > current) ?? matches[0]
    onJump(target.segmentId)
  }

  const run = (onlyCurrent: boolean) => {
    if (onlyCurrent && !activeId) return
    const replaceOptions = { ...options, replace, onlyIds: onlyCurrent ? [activeId!] : undefined }
    const summary = replaceAll(segments, replaceOptions) // preview for the message
    onReplace((current) => replaceAll(current, replaceOptions).segments)
    notify(summary.replaced ? 'success' : 'info', t('Replaced {n} occurrence(s)', { n: summary.replaced }), summary.skippedLocked ? t('{n} in locked subtitles were skipped.', { n: summary.skippedLocked }) : t('Undo with Ctrl+Z.'))
  }

  return (
    <div className="panel-body col" style={{ maxWidth: 760 }}>
      <div className="grid-2">
        <input ref={inputRef} className="input" placeholder={t('Find…')} aria-label={t('Find…')} value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && next()} />
        <input className="input" placeholder={t('Replace with…')} aria-label={t('Replace with…')} value={replace} onChange={(e) => setReplace(e.target.value)} />
      </div>
      <div className="row wrap">
        <select className="select" style={{ width: 190 }} value={field} onChange={(e) => setField(e.target.value as FindOptions['field'])}>
          <option value="translation">{t('In the subtitle')}</option>
          <option value="source">{t('In the original')}</option>
        </select>
        <label className="check"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> {t('Match case')}</label>
        <label className="check"><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> {t('Whole word')}</label>
        <span className="spacer" />
        <span className="small muted">{find ? t('{n} match(es) in {s} subtitle(s)', { n: total, s: matches.length }) : ''}</span>
      </div>
      <div className="row">
        <button className="btn sm" onClick={next} disabled={!matches.length}><ArrowDown size={13} /> {t('Find next')}</button>
        <button className="btn sm" onClick={() => run(true)} disabled={!find || !activeId}><Replace size={13} /> {t('Replace in current')}</button>
        <button className="btn sm" onClick={() => run(false)} disabled={!total}><ReplaceAll size={13} /> {t('Replace all')}</button>
        <span className="tiny subtle">{t('Locked subtitles are never changed. Replacements can be undone.')}</span>
      </div>
    </div>
  )
}

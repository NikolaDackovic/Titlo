import { AlertCircle, AlertTriangle, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSettings } from '../../app/settingsContext'
import { PROFILES, getProfile, type ProfileId } from '../../domain/languages'
import type { Project, Segment } from '../../domain/types'
import { EXPORT_FORMATS, buildExport, type ExportContent, type ExportFormat, type ExportResult } from '../../formats/exporter'
import type { LineEnding } from '../../formats/types'
import { saveFile } from '../../platform/files'
import { reportError } from '../../services/errors'
import { notify } from '../../services/notifications'
import { Field } from '../components/Field'
import { Modal } from '../components/Modal'

interface Props {
  project: Project
  segments: Segment[]
  onClose: () => void
}

import { useT } from '../../i18n'

export function ExportDialog({ project, segments, onClose }: Props) {
  const t = useT()
  const { settings } = useSettings()
  const [format, setFormat] = useState<ExportFormat>(settings.defaultExportFormat)
  const [content, setContent] = useState<ExportContent>(settings.defaultExportContent)
  const [profile, setProfile] = useState<ProfileId>(project.activeProfile)
  const [allVariants, setAllVariants] = useState(false)
  const [lineEnding, setLineEnding] = useState<LineEnding>(settings.exportLineEnding)
  const [bom, setBom] = useState(settings.exportBom)
  const [busy, setBusy] = useState(false)

  const profilesWithText = PROFILES.filter((p) => segments.some((s) => s.translations[p.id]?.text.trim())).map((p) => p.id)

  const profileKey = profilesWithText.join()
  const results: ExportResult[] = useMemo(() => {
    if (content === 'source') return [buildExport(project, segments, { format, content, profile, lineEnding, bom })]
    const targets = allVariants ? profilesWithText : [profile]
    return targets.map((p) => buildExport(project, segments, { format, content, profile: p, lineEnding, bom }))
  }, [project, segments, format, content, profile, allVariants, lineEnding, bom, profileKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const issues = results.flatMap((r) => r.issues.map((i) => ({ ...i, file: r.fileName })))
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  const run = async () => {
    setBusy(true)
    try {
      let saved = 0
      for (const r of results) {
        if (await saveFile(r.fileName, r.bytes, format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8')) saved += 1
      }
      if (saved) {
        notify('success', t('Exported {n} file(s)', { n: saved }), results.map((r) => r.fileName).join(', '))
        onClose()
      }
    } catch (error) {
      reportError(t('Export failed'), error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('Export subtitles')}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className={`btn ${errors.length ? 'danger' : 'primary'}`} onClick={run} disabled={busy || results.length === 0}>
            <Download size={14} /> {errors.length || warnings.length ? t('Export anyway') : t('Export')}
            {results.length > 1 ? ` (${t('{n} files', { n: results.length })})` : ''}
          </button>
        </>
      }
    >
      <div className="grid-3">
        <Field label={t('Format')}>
          <select className="select" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {EXPORT_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Field>
        <Field label={t('Content')}>
          <select className="select" value={content} onChange={(e) => setContent(e.target.value as ExportContent)}>
            <option value="translation">{t('Translated subtitles')}</option>
            <option value="source">{t('Original subtitles')}</option>
            <option value="bilingual">{t('Bilingual (translation + original)')}</option>
          </select>
        </Field>
        <Field label={t('Language profile')}>
          <select className="select" value={profile} disabled={content === 'source' || allVariants} onChange={(e) => setProfile(e.target.value as ProfileId)}>
            {PROFILES.map((p) => (
              <option key={p.id} value={p.id}>{t(p.label)}{profilesWithText.includes(p.id) ? '' : ` ${t('(empty)')}`}</option>
            ))}
          </select>
        </Field>
        <Field label={t('Line endings')} hint={t('CRLF is the safest choice for Windows players and TVs.')}>
          <select className="select" value={lineEnding} onChange={(e) => setLineEnding(e.target.value as LineEnding)}>
            <option value="crlf">Windows (CRLF)</option>
            <option value="lf">Unix (LF)</option>
          </select>
        </Field>
        <Field label={t('Encoding')} hint={t('Always UTF-8. A BOM helps some older TVs display č/ć/š/ž/đ and Cyrillic.')}>
          <label className="check" style={{ height: 28 }}>
            <input type="checkbox" checked={bom} onChange={(e) => setBom(e.target.checked)} /> {t('UTF-8 with BOM')}
          </label>
        </Field>
        <Field label={t('Variants')}>
          <label className="check" style={{ height: 28 }}>
            <input type="checkbox" checked={allVariants} disabled={content === 'source' || profilesWithText.length < 2} onChange={(e) => setAllVariants(e.target.checked)} /> {t('All profiles with translations ({n})', { n: profilesWithText.length })}
          </label>
        </Field>
      </div>

      <div className="small muted">
        {t('Files')}: {results.map((r) => r.fileName).join(', ') || '—'}
        {format === 'ass' && project.sourceFormat === 'ass' && ` · ${t('original ASS styles are preserved')}`}
        {content !== 'source' && !allVariants && ` · ${t(getProfile(profile).label)}`}
      </div>

      {errors.length > 0 && (
        <div className="callout err">
          <AlertCircle size={16} />
          <div className="small">
            <strong>{t('Timing errors — most players will show these subtitles incorrectly.')}</strong> {t('Fix them in the Quality control tab before exporting.')}
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, maxHeight: 110, overflow: 'auto' }}>
              {errors.slice(0, 20).map((i, k) => <li key={k}>{i.message}</li>)}
              {errors.length > 20 && <li>{t('…and {n} more', { n: errors.length - 20 })}</li>}
            </ul>
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="callout warn">
          <AlertTriangle size={16} />
          <div className="small">
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {warnings.map((i, k) => <li key={k}>{results.length > 1 ? `${i.file}: ` : ''}{i.message}</li>)}
            </ul>
          </div>
        </div>
      )}
      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>{t('Preview first lines')}</summary>
        <pre className="mono" style={{ background: 'var(--bg-0)', padding: 10, borderRadius: 6, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {results[0]?.text.split(/\r?\n/).slice(0, 24).join('\n')}
        </pre>
      </details>
    </Modal>
  )
}

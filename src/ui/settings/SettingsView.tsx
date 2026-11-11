import { Database, Download, HardDrive, History, Keyboard, Languages, ShieldCheck, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useServices } from '../../app/services'
import { useSettings } from '../../app/settingsContext'
import type { ProfileId } from '../../domain/languages'
import { EXPORT_FORMATS, type ExportContent, type ExportFormat } from '../../formats/exporter'
import { LOCALES, useT, type Locale } from '../../i18n'
import type { BackupInfo } from '../../persistence/snapshotStore'
import { pickFile, readFileBytes, saveFile } from '../../platform/files'
import { QC_PROFILES } from '../../qc'
import { reportError } from '../../services/errors'
import { notify } from '../../services/notifications'
import { KEYBOARD_SHORTCUTS, type Theme } from '../../services/settings'
import { ProfileSelect } from '../components/Field'
import { ConfirmDialog } from '../components/Modal'

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export function SettingsView() {
  const t = useT()
  const { db, cache, logs } = useServices()
  const { settings, update } = useSettings()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [restore, setRestore] = useState<BackupInfo | { file: Uint8Array; name: string } | null>(null)
  const [cacheCount, setCacheCount] = useState(() => cache.count())
  const [showLogs, setShowLogs] = useState(false)

  const loadBackups = () => void db.store.listBackups().then(setBackups).catch((e) => reportError(t('Could not list backups'), e))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadBackups, [db])

  const doRestore = async () => {
    if (!restore) return
    try {
      const bytes = 'file' in restore ? restore.file : await db.store.loadBackup(restore.id)
      if (!bytes) throw new Error(t('Backup not found.'))
      await db.replaceWith(bytes, 'restore')
      notify('success', t('Database restored'), t('The previous state was backed up first. The app will reload.'))
      setTimeout(() => location.reload(), 900)
    } catch (error) {
      reportError(t('Restore failed'), error)
    } finally {
      setRestore(null)
    }
  }

  const qc = QC_PROFILES.find((x) => x.id === settings.qcProfileId) ?? QC_PROFILES[0]

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>{t('Settings')}</h1>
            <div className="muted">{t('Preferences are stored in the local database.')}</div>
          </div>
        </div>

        <div className="card">
          <div className="section-title"><Languages size={13} /> {t('Language and appearance')}</div>
          <div className="settings-grid">
            <span className="label">{t('Interface language')}</span>
            <div className="chips">
              {LOCALES.map((l) => (
                <button key={l.id} className={`chip${settings.uiLanguage === l.id ? ' active' : ''}`} onClick={() => update({ uiLanguage: l.id as Locale })}>{l.label}</button>
              ))}
            </div>
            <span className="label">{t('Theme')}</span>
            <div className="chips">
              {(['dark', 'light'] as Theme[]).map((th) => (
                <button key={th} className={`chip${settings.theme === th ? ' active' : ''}`} onClick={() => update({ theme: th })}>{th === 'dark' ? t('Dark') : t('Light')}</button>
              ))}
            </div>
            <span className="label">{t('Default subtitle language')}</span>
            <div style={{ maxWidth: 260 }}><ProfileSelect value={settings.defaultProfile} onChange={(v) => update({ defaultProfile: v as ProfileId })} /></div>
            <span className="label">{t('Quality control profile')}</span>
            <div className="col" style={{ gap: 4 }}>
              <select className="select" style={{ maxWidth: 300 }} value={settings.qcProfileId} onChange={(e) => update({ qcProfileId: e.target.value })}>
                {QC_PROFILES.map((p) => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
              </select>
              <span className="tiny muted">{t('{chars} characters per line · {lines} lines · {cps} characters per second · {min}–{max} s. These are common conventions, not an official standard.', { chars: qc.maxCharsPerLine, lines: qc.maxLines, cps: qc.maxCps, min: qc.minDurationMs / 1000, max: qc.maxDurationMs / 1000 })}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-title"><Download size={13} /> {t('Export defaults')}</div>
          <div className="settings-grid">
            <span className="label">{t('Format')}</span>
            <select className="select" style={{ maxWidth: 260 }} value={settings.defaultExportFormat} onChange={(e) => update({ defaultExportFormat: e.target.value as ExportFormat })}>
              {EXPORT_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <span className="label">{t('Content')}</span>
            <select className="select" style={{ maxWidth: 260 }} value={settings.defaultExportContent} onChange={(e) => update({ defaultExportContent: e.target.value as ExportContent })}>
              <option value="translation">{t('Translated subtitles')}</option>
              <option value="source">{t('Original subtitles')}</option>
              <option value="bilingual">{t('Bilingual (translation + original)')}</option>
            </select>
            <span className="label">{t('Line endings')}</span>
            <select className="select" style={{ maxWidth: 260 }} value={settings.exportLineEnding} onChange={(e) => update({ exportLineEnding: e.target.value as 'crlf' | 'lf' })}>
              <option value="crlf">Windows (CRLF)</option>
              <option value="lf">Unix (LF)</option>
            </select>
            <span className="label">UTF-8 BOM</span>
            <label className="check"><input type="checkbox" checked={settings.exportBom} onChange={(e) => update({ exportBom: e.target.checked })} /> {t('Add BOM (helps older TVs with č/ć/š/ž/đ and Cyrillic)')}</label>
          </div>
        </div>

        <div className="card col">
          <div className="section-title" style={{ margin: 0 }}><Database size={13} /> {t('Data and backups')}</div>
          <div className="settings-grid">
            <span className="label">{t('Database')}</span>
            <span className="small">SQLite (schema v{db.schemaVersion}) · {t('Browser storage (IndexedDB) on this computer')}</span>
            <span className="label">{t('Translation cache')}</span>
            <div className="row">
              <span className="small">{t('{n} cached translation(s)', { n: cacheCount })}</span>
              <button className="btn sm" disabled={!cacheCount} onClick={() => (cache.clear(), setCacheCount(cache.count()))}>{t('Clear cache')}</button>
            </div>
          </div>
          <div className="row wrap">
            <button className="btn sm" onClick={() => void db.backup('manual backup').then(loadBackups).then(() => notify('success', t('Backup created')))}>
              <History size={13} /> {t('Create backup now')}
            </button>
            <button className="btn sm" onClick={() => void saveFile(`titlo-${new Date().toISOString().slice(0, 10)}.sqlite`, db.exportBytes(), 'application/vnd.sqlite3')}>
              <Download size={13} /> {t('Download database file')}
            </button>
            <button
              className="btn sm"
              onClick={async () => {
                const f = await pickFile(['.sqlite', '.db', '.sqlite3'])
                if (f) setRestore({ file: await readFileBytes(f.file), name: f.name })
              }}
            >
              <Upload size={13} /> {t('Restore from file…')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Backup')}</th><th>{t('Reason')}</th><th>{t('Size')}</th><th /></tr></thead>
              <tbody>
                {backups.length === 0 && <tr><td colSpan={4} className="small muted">{t('No backups yet.')}</td></tr>}
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td className="small">{new Date(b.createdAt).toLocaleString(settings.uiLanguage === 'sr' ? 'sr-Latn' : 'en')}</td>
                    <td className="small muted">{b.reason}</td>
                    <td className="small">{kb(b.size)}</td>
                    <td><button className="btn sm" onClick={() => setRestore(b)}>{t('Restore')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted">{t('Up to 12 backups are kept: automatically once a day, before deleting a project, before migrations and before every restore.')}</p>
        </div>

        <div className="card">
          <div className="section-title"><ShieldCheck size={13} /> {t('Privacy')}</div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--text-1)' }}>
            <li>{t('Projects, terminology and settings are stored only in the local database on this computer.')}</li>
            <li>{t('Speech recognition and translation run on local models; the app sends nothing to the internet.')}</li>
            <li>{t('Attached video/audio is read directly from your disk and never copied or uploaded.')}</li>
            <li>{t('No telemetry, accounts or cloud features are included in this version.')}</li>
          </ul>
        </div>

        <div className="card">
          <div className="section-title"><HardDrive size={13} /> {t('Models and hardware acceleration')}</div>
          <p className="small muted">{t('Speech and translation models, CPU/GPU mode and precision are configured on the Models page.')}</p>
        </div>

        <div className="card">
          <div className="section-title"><Keyboard size={13} /> {t('Keyboard shortcuts (Studio)')}</div>
          <div className="grid-2" style={{ gap: 8 }}>
            {KEYBOARD_SHORTCUTS.map((s) => (
              <div key={s.keys} className="row small"><kbd>{s.keys}</kbd><span className="muted">{t(s.action)}</span></div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="row">
            <div className="section-title" style={{ margin: 0 }}>{t('Application log')}</div>
            <span className="spacer" />
            <button className="btn sm" onClick={() => setShowLogs((s) => !s)}>{showLogs ? t('Hide') : t('Show')}</button>
          </div>
          {showLogs && (
            <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}>
              {logs.recent(150).map((l) => (
                <div key={l.id} className="tiny mono" style={{ color: l.level === 'error' ? 'var(--err)' : l.level === 'warn' ? 'var(--warn)' : 'var(--text-2)', padding: '2px 0' }}>
                  {new Date(l.createdAt).toLocaleString()} [{l.level}] {l.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {restore && (
        <ConfirmDialog
          title={t('Restore database?')}
          message={'file' in restore
            ? t('All projects, terminology and settings will be replaced with the file "{name}". The current state is backed up first, so this can be undone.', { name: restore.name })
            : t('All projects, terminology and settings will be replaced with the backup from {date}. The current state is backed up first, so this can be undone.', { date: new Date(restore.createdAt).toLocaleString() })}
          confirmLabel={t('Restore')}
          danger
          onCancel={() => setRestore(null)}
          onConfirm={() => void doRestore()}
        />
      )}
    </div>
  )
}

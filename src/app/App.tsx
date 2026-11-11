import { BookText, Cpu, LayoutDashboard, Settings as SettingsIcon, ShieldCheck, Subtitles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT, type Locale } from '../i18n'
import { notify } from '../services/notifications'
import { PROVIDER_OPTIONS } from '../translation/registry'
import { Toasts } from '../ui/components/Toasts'
import { Dashboard } from '../ui/dashboard/Dashboard'
import { GlossaryManager } from '../ui/glossary/GlossaryManager'
import { ModelsView } from '../ui/models/ModelsView'
import { SettingsView } from '../ui/settings/SettingsView'
import { Studio } from '../ui/studio/Studio'
import { BrandMark } from '../ui/components/BrandMark'
import { ErrorBoundary } from './ErrorBoundary'
import { ServicesContext, type BootReport, type Services } from './services'
import { SettingsProvider, useSettings } from './settingsContext'
import { useSaveState } from './useSaveState'

export type View = 'dashboard' | 'studio' | 'glossary' | 'models' | 'settings'

export interface Navigation {
  view: View
  projectId: string | null
  go: (view: View) => void
  openProject: (id: string) => void
  closeProject: () => void
}

export function App({ services, report }: { services: Services; report: BootReport }) {
  return (
    <ServicesContext.Provider value={services}>
      <SettingsProvider>
        <Shell report={report} />
      </SettingsProvider>
    </ServicesContext.Provider>
  )
}

const NAV: Array<{ view: View; label: string; icon: typeof LayoutDashboard }> = [
  { view: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { view: 'studio', label: 'Studio', icon: Subtitles },
  { view: 'glossary', label: 'Terminology', icon: BookText },
  { view: 'models', label: 'Models', icon: Cpu },
  { view: 'settings', label: 'Settings', icon: SettingsIcon },
]

function Shell({ report }: { report: BootReport }) {
  const t = useT()
  const [view, setView] = useState<View>('dashboard')
  const [projectId, setProjectId] = useState<string | null>(null)
  const saveState = useSaveState()
  const { settings, update } = useSettings()
  const reported = useRef(false)

  useEffect(() => {
    if (reported.current) return
    reported.current = true
    if (report.recoveredFrom) notify('warning', t('Database restored from backup'), t('The main database file was damaged. Restored {from}.', { from: report.recoveredFrom }))
    if (report.legacy?.error) notify('error', t('Old projects were not migrated'), report.legacy.error)
    else if (report.legacy && report.legacy.migrated > 0) notify('success', t('Projects migrated to SQLite'), t('{n} project(s) from version 0.1 were imported. Old translations are marked "Needs review". The original browser data was kept.', { n: report.legacy.migrated }))
    if (report.interruptedJobs) notify('info', t('Interrupted job'), t('{n} job(s) were interrupted when the app closed. Finished segments were saved; start the job again to continue.', { n: report.interruptedJobs }))
  }, [report, t])

  const nav: Navigation = {
    view,
    projectId,
    go: setView,
    openProject: (id) => {
      setProjectId(id)
      setView('studio')
    },
    closeProject: () => {
      setProjectId(null)
      setView('dashboard')
    },
  }

  const provider = PROVIDER_OPTIONS.find((p) => p.id === settings.translation.providerId)
  const setLang = (l: Locale) => update({ uiLanguage: l })

  return (
    <div className={`shell${view === 'studio' ? ' studio-mode' : ''}`}>
      <nav className="sidebar" aria-label={t('Main navigation')}>
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <div className="brand-name">Titlo</div>
            <div className="brand-sub">{t('Subtitle & Localization Studio')}</div>
          </div>
        </div>
        <div className="nav-label">{t('Workspace')}</div>
        {NAV.map(({ view: v, label, icon: Icon }) => (
          <button
            key={v}
            className={`nav-btn${view === v ? ' active' : ''}`}
            onClick={() => setView(v)}
            disabled={v === 'studio' && !projectId}
            title={v === 'studio' && !projectId ? t('Open a project first') : t(label)}
            aria-label={t(label)}
          >
            <Icon size={18} />
            <span className="nav-text">{t(label)}</span>
          </button>
        ))}
        <div className="sidebar-foot">
          <div className="lang-switch" role="group" aria-label={t('Interface language')}>
            <button className={settings.uiLanguage === 'sr' ? 'active' : ''} onClick={() => setLang('sr')} title="Srpski">SR</button>
            <button className={settings.uiLanguage === 'en' ? 'active' : ''} onClick={() => setLang('en')} title="English">EN</button>
          </div>
          <div className="privacy-pill" title={t('No subtitle or media content is sent to the internet. Everything runs on this computer.')}>
            <ShieldCheck size={14} color="var(--ok)" />
            <span>{t('Everything stays on this computer')}</span>
          </div>
        </div>
      </nav>

      <main className="main">
        {view === 'dashboard' && (
          <ErrorBoundary area="Home">
            <Dashboard nav={nav} />
          </ErrorBoundary>
        )}
        {view === 'studio' && projectId && (
          <ErrorBoundary area="Studio" onReset={() => setView('studio')}>
            <Studio key={projectId} projectId={projectId} nav={nav} />
          </ErrorBoundary>
        )}
        {view === 'glossary' && (
          <ErrorBoundary area="Terminology">
            <GlossaryManager projectId={projectId} />
          </ErrorBoundary>
        )}
        {view === 'models' && (
          <ErrorBoundary area="Models">
            <ModelsView />
          </ErrorBoundary>
        )}
        {view === 'settings' && (
          <ErrorBoundary area="Settings">
            <SettingsView />
          </ErrorBoundary>
        )}
      </main>

      <footer className="statusbar">
        <span className="item">
          <ShieldCheck size={12} color="var(--ok)" /> {t('Local processing only')}
        </span>
        <span className="item">{t('Translation')}: {provider ? t(provider.label) : '—'}</span>
        <span className="spacer" />
        <span className="item" style={{ color: saveState.status === 'error' ? 'var(--err)' : undefined }}>
          {saveState.status === 'saved' && (saveState.lastSavedAt ? t('Saved {time}', { time: new Date(saveState.lastSavedAt).toLocaleTimeString() }) : t('Saved'))}
          {saveState.status === 'unsaved' && t('Unsaved changes…')}
          {saveState.status === 'saving' && t('Saving…')}
          {saveState.status === 'error' && t('Save failed: {error}', { error: saveState.error ?? '' })}
        </span>
        <span className="item">SQLite</span>
      </footer>
      <Toasts />
    </div>
  )
}

import { AlertTriangle, LoaderCircle, Lock } from 'lucide-react'
import { t } from '../i18n'
import { BrandMark } from '../ui/components/BrandMark'
import '../styles/base.css'
import '../styles/components.css'
import '../styles/layout.css'

export type BootState = { kind: 'loading' } | { kind: 'locked' } | { kind: 'error'; message: string }

export function BootScreen({ state }: { state: BootState }) {
  return (
    <div className="boot">
      <div className="boot-card card">
        <div className="row">
          <BrandMark />
          <div>
            <h2 style={{ fontSize: 16 }}>Titlo</h2>
            <div className="muted small">{t('Your words. Every language. Perfectly timed.')}</div>
          </div>
        </div>
        {state.kind === 'loading' && (
          <div className="row muted">
            <LoaderCircle size={15} className="spin" /> {t('Opening the local project database…')}
          </div>
        )}
        {state.kind === 'locked' && (
          <div className="callout warn">
            <Lock size={16} />
            <div>
              <strong>{t('Titlo is already open in another window or tab.')}</strong>
              <p className="small">{t('To protect your projects from being overwritten, only one window can use the database at a time. Close the other window and reload this one.')}</p>
            </div>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="callout err">
            <AlertTriangle size={16} />
            <div>
              <strong>{t('The application could not start.')}</strong>
              <p className="small">{state.message}</p>
              <p className="tiny muted" style={{ marginTop: 6 }}>{t('Your data has not been deleted. If browser storage is disabled (private mode), enable it and reload.')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

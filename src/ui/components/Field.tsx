import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { PROFILES, type ProfileId } from '../../domain/languages'
import { TRANSLATION_STATUS_LABEL, type SegmentTranslation, type TranslationStatus } from '../../domain/types'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function ProfileSelect({ value, onChange, includeAll, className }: { value: ProfileId | 'all'; onChange: (v: ProfileId | 'all') => void; includeAll?: boolean; className?: string }) {
  return (
    <select className={`select ${className ?? ''}`} value={value} onChange={(e) => onChange(e.target.value as ProfileId | 'all')}>
      {includeAll && <option value="all">{t('All profiles')}</option>}
      {PROFILES.map((p) => (
        <option key={p.id} value={p.id}>
          {t(p.label)}
        </option>
      ))}
    </select>
  )
}

const STATUS_CLASS: Record<TranslationStatus, string> = {
  not_translated: '',
  translating: 'blue',
  translated: 'accent',
  needs_review: 'warn',
  approved: 'ok',
  failed: 'err',
}

export function StatusBadge({ tr }: { tr: SegmentTranslation | undefined }) {
  const status = tr?.status ?? 'not_translated'
  return (
    <span className="row" style={{ gap: 4 }}>
      <span className={`badge ${STATUS_CLASS[status]}`}>{t(TRANSLATION_STATUS_LABEL[status])}</span>
      {tr?.origin === 'test' && <span className="badge err" title={t('TEST provider output — not a translation')}>TEST</span>}
      {tr?.origin === 'machine' && status !== 'approved' && <span className="badge" title={t('Machine translation — not reviewed')}>{tr.providerId === 'adaptation' ? t('Source') : 'MT'}</span>}
      {tr?.locked && <span className="badge blue">{t('Locked')}</span>}
    </span>
  )
}

export const statusDotClass = (tr: SegmentTranslation | undefined) => {
  if (!tr || !tr.text.trim()) return ''
  if (tr.origin === 'test' || tr.status === 'failed') return 'err'
  if (tr.status === 'approved') return 'ok'
  if (tr.status === 'needs_review') return 'warn'
  return 'accent'
}

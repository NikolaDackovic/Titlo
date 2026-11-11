import { ShieldAlert } from 'lucide-react'
import { useT } from '../../i18n'
import { Modal } from '../components/Modal'

export type GateChoice = 'all' | 'reviewed' | 'continue' | 'review'

interface Props {
  /** Targeted segments whose original still waits for review (unreviewed Whisper text or flagged). */
  pending: number
  /** Targeted segments whose original is verified or approved. */
  reviewed: number
  total: number
  sameLanguage: boolean
  onChoose: (choice: GateChoice) => void
  onClose: () => void
}

/**
 * Shown before translating when the original text has not been reviewed yet. It never blocks:
 * the user chooses what happens.
 */
export function TranslationGate({ pending, reviewed, total, sameLanguage, onChoose, onClose }: Props) {
  const t = useT()
  return (
    <Modal
      title={sameLanguage ? t('Adapt unreviewed subtitles?') : t('Translate unreviewed subtitles?')}
      onClose={onClose}
      footer={
        <div className="gate-actions">
          <button className="btn" onClick={() => onChoose('review')}>{t('Back to review')}</button>
          <span className="spacer" />
          <button className="btn" onClick={() => onChoose('continue')} title={t('Do not ask again until the Studio is closed')}>{t('Continue, do not ask again')}</button>
          <button className="btn" onClick={() => onChoose('all')}>{t('All subtitles ({n})', { n: total })}</button>
          <button className="btn primary" autoFocus disabled={reviewed === 0} onClick={() => onChoose('reviewed')}>{t('Only verified and approved ({n})', { n: reviewed })}</button>
        </div>
      }
    >
      <div className="callout warn">
        <ShieldAlert size={16} />
        <div className="small">
          <strong>{t('{n} of {total} subtitles have an original nobody has checked yet.', { n: pending, total })}</strong>{' '}
          {t('Mistakes in the transcription (misheard words, text invented on silence) are carried into the translation. Reviewing the original first is safer.')}
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 10 }}>{t('Nothing is blocked: you can translate everything now and review later. Translations made from an original that you change afterwards are marked "out of date".')}</p>
    </Modal>
  )
}

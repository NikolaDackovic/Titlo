import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useT } from '../../i18n'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Modal({ title, onClose, children, footer, wide }: ModalProps) {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div
        className={`modal${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.14 }}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label={t('Close')}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </motion.div>
    </div>
  )
}

interface ConfirmProps {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: ConfirmProps) {
  const t = useT()
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>{t('Cancel')}</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="small" style={{ color: 'var(--text-1)' }}>{message}</div>
    </Modal>
  )
}

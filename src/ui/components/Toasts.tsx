import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { dismiss, subscribeNotices, type Notice } from '../../services/notifications'
import { useT } from '../../i18n'

const ICON = {
  info: <Info size={16} color="var(--info)" />,
  success: <CheckCircle2 size={16} color="var(--ok)" />,
  warning: <AlertTriangle size={16} color="var(--warn)" />,
  error: <AlertCircle size={16} color="var(--err)" />,
}

export function Toasts() {
  const t = useT()
  const [notices, setNotices] = useState<Notice[]>([])
  useEffect(() => subscribeNotices(setNotices), [])
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {notices.map((n) => (
          <motion.div key={n.id} className={`toast ${n.kind}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.15 }}>
            {ICON[n.kind]}
            <div className="grow">
              <strong>{n.title}</strong>
              {n.message && <p>{n.message}</p>}
              {n.details && n.details.length > 0 && (
                <ul>
                  {n.details.slice(0, 4).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                  {n.details.length > 4 && <li>{t('…and {n} more', { n: n.details.length - 4 })}</li>}
                </ul>
              )}
            </div>
            <button className="btn ghost icon sm" onClick={() => dismiss(n.id)} aria-label={t('Dismiss')}>
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

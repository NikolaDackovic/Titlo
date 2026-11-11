import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { log } from '../services/errors'
import { t } from '../i18n'

interface Props {
  children: ReactNode
  /** Short name of the area, shown in the fallback. */
  area: string
  onReset?: () => void
}

interface State {
  error: Error | null
}

/**
 * Catches render errors in one area of the UI so the rest of the app (and unsaved
 * work in other areas) keeps running. Project data is persisted independently.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log('error', `UI error in ${this.props.area}`, `${error.stack ?? error.message}\n${info.componentStack ?? ''}`)
  }

  reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty" role="alert">
        <AlertTriangle size={22} color="var(--err)" />
        <h3>{t('{area} stopped because of an error', { area: t(this.props.area) })}</h3>
        <p className="small">{this.state.error.message}</p>
        <p className="tiny subtle">{t('Your saved projects are not affected. The error was written to the application log.')}</p>
        <button className="btn" onClick={this.reset}>
          <RotateCcw size={14} /> {t('Try again')}
        </button>
      </div>
    )
  }
}

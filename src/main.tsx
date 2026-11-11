import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { App } from './app/App'
import { BootScreen } from './app/BootScreen'
import { createServices } from './app/services'
import { IndexedDbSnapshotStore } from './persistence/snapshotStore'
import { installGlobalErrorHandlers } from './services/errors'
import './styles/base.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/studio.css'

const root = createRoot(document.getElementById('root')!)

/**
 * Only one window may own the database at a time; a second window would overwrite
 * the first one's changes. Web Locks give us a reliable single-owner guarantee.
 */
function acquireSingleInstanceLock(): Promise<boolean> {
  if (!('locks' in navigator)) return Promise.resolve(true)
  return new Promise((resolve) => {
    void navigator.locks.request('exyu-titl-studio-database', { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false)
        return undefined
      }
      resolve(true)
      return new Promise<void>(() => {}) // hold for the lifetime of the page
    })
  })
}

async function boot() {
  installGlobalErrorHandlers()
  root.render(<BootScreen state={{ kind: 'loading' }} />)

  if (!(await acquireSingleInstanceLock())) {
    root.render(<BootScreen state={{ kind: 'locked' }} />)
    return
  }

  try {
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
    const store = new IndexedDbSnapshotStore()
    const { services, report } = await createServices(SQL, store)

    const flush = () => void services.db.flush().catch(() => undefined)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
    window.addEventListener('beforeunload', (event) => {
      if (services.db.state.status === 'unsaved' || services.db.state.status === 'saving') {
        flush()
        event.preventDefault()
      }
    })

    root.render(
      <StrictMode>
        <App services={services} report={report} />
      </StrictMode>,
    )
  } catch (error) {
    root.render(<BootScreen state={{ kind: 'error', message: (error as Error)?.message ?? String(error) }} />)
  }
}

void boot()

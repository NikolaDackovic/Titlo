import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { setLocale } from '../i18n'
import { mergeSettings, type AppSettings } from '../services/settings'
import { useServices } from './services'

interface SettingsValue {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => void
}

const SettingsContext = createContext<SettingsValue | null>(null)
const KEY = 'app_settings'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { settings: repo } = useServices()
  const [settings, setSettings] = useState<AppSettings>(() => mergeSettings(repo.get<Partial<AppSettings> | null>(KEY, null)))

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  // Applied during render so the very first paint is already in the chosen language.
  setLocale(settings.uiLanguage)

  const latest = useRef(settings)
  latest.current = settings

  // Persist outside the state updater: writing to the database notifies other
  // components (save indicator), which must not happen during rendering.
  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      const next = mergeSettings({ ...latest.current, ...patch })
      latest.current = next
      repo.set(KEY, next)
      setSettings(next)
    },
    [repo],
  )

  const value = useMemo(() => ({ settings, update }), [settings, update])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings must be used inside SettingsProvider')
  return value
}

import { useEffect, useState } from 'react'
import type { SaveState } from '../persistence/database'
import { useServices } from './services'

export function useSaveState(): SaveState {
  const { db } = useServices()
  const [state, setState] = useState<SaveState>(db.state)
  useEffect(() => {
    const unsubscribe = db.onSaveState(setState)
    return () => {
      unsubscribe()
    }
  }, [db])
  return state
}

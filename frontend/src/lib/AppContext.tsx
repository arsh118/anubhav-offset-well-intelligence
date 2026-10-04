import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type Well } from './api'
import { JUDGING_DEMO } from './demoScenario'

type AppContextValue = {
  wells: Well[]
  activeWell: Well | null
  activeWellId: string
  setActiveWellId: (id: string) => void
  radiusKm: number
  setRadiusKm: (value: number) => void
  depthWindowM: number
  setDepthWindowM: (value: number) => void
  demoMode: boolean
  startDemoMode: () => boolean
  exitDemoMode: () => void
  apiStatus: 'loading' | 'online' | 'offline'
  wellError: string | null
  refreshWells: () => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [wells, setWells] = useState<Well[]>([])
  const [activeWellId, setActiveWellIdState] = useState('')
  const [radiusKm, setRadiusKmState] = useState(20)
  const [depthWindowM, setDepthWindowMState] = useState(100)
  const [demoMode, setDemoMode] = useState(false)
  const [apiStatus, setApiStatus] = useState<AppContextValue['apiStatus']>('loading')
  const [wellError, setWellError] = useState<string | null>(null)

  const refreshWells = async () => {
    try {
      const [result, health] = await Promise.all([
        api<Well[]>('/wells?limit=500'),
        api<{ status: string; database: string }>('/health').catch(() => null),
      ])
      setWells(result)
      setWellError(null)
      setApiStatus(health?.status === 'ok' && health.database === 'connected' ? 'online' : 'offline')
      setActiveWellIdState((current) => {
        if (result.some((well) => well.id === current)) return current
        return result.find((well) => well.role === 'active' && well.well_name === 'ANB-01')?.id
          ?? result.find((well) => well.role === 'active')?.id
          ?? ''
      })
    } catch (error) {
      setApiStatus('offline')
      setWellError(error instanceof Error ? error.message : 'Unable to load wells.')
    }
  }

  useEffect(() => { void refreshWells() }, [])

  const setActiveWellId = (id: string) => { setDemoMode(false); setActiveWellIdState(id) }
  const setRadiusKm = (value: number) => { setDemoMode(false); setRadiusKmState(value) }
  const setDepthWindowM = (value: number) => { setDemoMode(false); setDepthWindowMState(value) }
  const startDemoMode = useCallback(() => {
    const demoWell = wells.find((well) => well.role === 'active' && well.well_name === JUDGING_DEMO.activeWellName)
    if (!demoWell) return false
    setActiveWellIdState(demoWell.id)
    setRadiusKmState(JUDGING_DEMO.radiusKm)
    setDepthWindowMState(JUDGING_DEMO.depthWindowM)
    setDemoMode(true)
    return true
  }, [wells])
  const exitDemoMode = () => setDemoMode(false)
  const activeWell = wells.find((well) => well.id === activeWellId) ?? null
  const value = useMemo(() => ({
    wells, activeWell, activeWellId, setActiveWellId,
    radiusKm, setRadiusKm, depthWindowM, setDepthWindowM,
    demoMode, startDemoMode, exitDemoMode,
    apiStatus, wellError, refreshWells,
  }), [wells, activeWell, activeWellId, radiusKm, depthWindowM, demoMode, startDemoMode, apiStatus, wellError])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}

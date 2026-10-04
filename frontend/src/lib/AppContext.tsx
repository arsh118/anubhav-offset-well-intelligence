import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, INITIAL_API_TIMEOUT_MS, withTransientRetries, type Well } from './api'
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
  wellState: 'loading' | 'ready' | 'empty' | 'error'
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
  const refreshInFlight = useRef<Promise<void> | null>(null)

  const refreshWells = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current

    setApiStatus('loading')
    setWellError(null)
    const request = (async () => {
      try {
        await withTransientRetries(async () => {
          const health = await api<{ status: string; database: string }>('/health', {}, INITIAL_API_TIMEOUT_MS)
          if (health.status !== 'ok' || health.database !== 'connected') {
            throw new ApiError('ANUBHAV is not ready to serve dashboard data.', 503)
          }
        })
        const result = await withTransientRetries(() => api<Well[]>('/wells?limit=500', {}, INITIAL_API_TIMEOUT_MS))
        setWells(result)
        setWellError(null)
        setApiStatus('online')
        setActiveWellIdState((current) => {
          if (result.some((well) => well.id === current)) return current
          return result.find((well) => well.role === 'active' && well.well_name === 'ANB-01')?.id
            ?? result.find((well) => well.role === 'active')?.id
            ?? ''
        })
      } catch {
        setApiStatus('offline')
        setWellError('The ANUBHAV API could not be reached.')
      }
    })()
    refreshInFlight.current = request
    void request.then(() => {
      if (refreshInFlight.current === request) refreshInFlight.current = null
    })
    return request
  }, [])

  useEffect(() => { void refreshWells() }, [refreshWells])

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
  const wellState: AppContextValue['wellState'] = apiStatus === 'loading'
    ? 'loading'
    : apiStatus === 'offline'
      ? 'error'
      : wells.length === 0 ? 'empty' : 'ready'
  const value = useMemo(() => ({
    wells, activeWell, activeWellId, setActiveWellId,
    radiusKm, setRadiusKm, depthWindowM, setDepthWindowM,
    demoMode, startDemoMode, exitDemoMode,
    apiStatus, wellState, wellError, refreshWells,
  }), [wells, activeWell, activeWellId, radiusKm, depthWindowM, demoMode, startDemoMode, apiStatus, wellState, wellError, refreshWells])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}

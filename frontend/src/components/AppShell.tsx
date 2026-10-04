import { Activity, ArrowUpRight, Bell, BookOpen, ChevronDown, Compass, FileText, Layers3, MapPinned, ShieldCheck, Waves, CircleHelp } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { humanize } from '../lib/format'
import { ErrorState } from './Feedback'
import { MethodologyDrawer } from './MethodologyDrawer'

const navigation = [
  { to: '/', label: 'Dashboard', icon: Layers3, end: true },
  { to: '/active-well', label: 'Active Well', icon: Activity },
  { to: '/offsets', label: 'Offset Wells', icon: MapPinned },
  { to: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/documents', label: 'Documents', icon: FileText },
]

export function AppShell() {
  const { wells, activeWellId, setActiveWellId, activeWell, radiusKm, setRadiusKm, depthWindowM, setDepthWindowM, demoMode, startDemoMode, exitDemoMode, apiStatus, wellState, wellError, refreshWells } = useApp()
  const activeWells = wells.filter((well) => well.role === 'active')
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const toggleDemoMode = () => {
    if (demoMode) {
      exitDemoMode()
      return
    }
    if (startDemoMode()) navigate('/')
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><div className="brand-mark"><Waves size={22} strokeWidth={1.8} /></div><div><div className="brand-name">ANUBHAV</div><div className="brand-caption">OFFSET WELL INTELLIGENCE</div></div></div>
      <div className="sidebar-rule" />
      <div className="nav-section-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">
        {navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{label === 'Alerts' && <span className="nav-trailing"><Bell size={13} /></span>}
        </NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="data-source"><span className="source-dot" /><div><strong>Representative Synthetic Demo Data</strong><small>Public / illustrative only</small></div></div>
        <div className="sidebar-disclaimer">Synthetic demo data. Historical evidence supports engineer review; it is not incident prediction.</div>
        <div className="sidebar-version">ANUBHAV MVP <span>·</span> SIH 2026</div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar">
        <div className="topbar-context"><div className="eyebrow">DRILLING OPERATIONS KNOWLEDGE</div><div className="topbar-title">AI-Powered Offset Well Intelligence</div></div>
        <div className="topbar-tools">
          <label className="top-control well-control"><span>ACTIVE WELL</span><span className="select-wrap"><select value={activeWellId} onChange={(event) => setActiveWellId(event.target.value)} aria-label="Select active well" disabled={!activeWells.length}>
            {activeWells.length === 0 && <option value="">{wellState === 'loading' ? 'Loading active wells…' : wellState === 'error' ? 'Active wells unavailable' : wellState === 'empty' ? 'No active wells available' : 'No active well configured'}</option>}
            {activeWells.map((well) => <option key={well.id} value={well.id}>{well.well_name} · {well.field ?? 'Unassigned field'}</option>)}
          </select><ChevronDown size={14} /></span></label>
          <label className="top-control compact-control"><span>RADIUS</span><span className="select-wrap"><select value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))} aria-label="Offset search radius">
            {[5, 10, 20, 50].map((value) => <option key={value} value={value}>{value} km</option>)}
          </select><ChevronDown size={14} /></span></label>
          <label className="top-control compact-control window-control"><span>DEPTH WINDOW</span><span className="select-wrap"><select value={depthWindowM} onChange={(event) => setDepthWindowM(Number(event.target.value))} aria-label="Historical depth window">
            {[50, 100, 200, 500].map((value) => <option key={value} value={value}>{value} m</option>)}
          </select><ChevronDown size={14} /></span></label>
          <button className={`demo-mode-trigger${demoMode ? ' active' : ''}`} onClick={toggleDemoMode} disabled={!demoMode && !activeWells.some((well) => well.well_name === 'ANB-01')} aria-pressed={demoMode}>{demoMode ? 'Exit demo' : 'Explore demo'}</button>
          <Link className="topbar-active-well-link" to="/active-well">Explore active well <ArrowUpRight size={14} /></Link>
          <button className="methodology-trigger" onClick={() => setMethodologyOpen(true)} disabled={!activeWellId} aria-label="How ANUBHAV calculates historical relevance" title="How relevance is calculated"><CircleHelp size={14} /><span>Methodology</span></button>
          <div className={`system-status ${apiStatus}`} title={apiStatus === 'online' ? 'API and database reachable' : 'API status'}><span className="status-led" />{apiStatus === 'online' ? 'SYSTEM ONLINE' : apiStatus === 'loading' ? 'CONNECTING' : 'API OFFLINE'}</div>
        </div>
      </header>
      <div className="provenance-banner"><span className="provenance-mark" /><strong>DECISION SUPPORT</strong><span className="provenance-divider">—</span><span>Engineer review required</span></div>
      <main className="page-content">
        {!activeWell && wellState === 'error' && wellError && <ErrorState title="ANUBHAV is taking longer to respond." message={wellError} retryLabel="TRY AGAIN" retry={() => void refreshWells()} />}
        {!activeWell && wellState === 'ready' && <div className="context-banner"><ShieldCheck size={15} />No active well is configured in the returned records. Select an available active well to load intelligence.</div>}
        {activeWell && location.pathname !== '/' && <div className="context-line"><span className="context-line-name">{activeWell.well_name}</span><span>{activeWell.field}</span><span className="context-separator">/</span><span>{activeWell.current_depth?.toLocaleString() ?? '—'} m MD</span><span className="context-separator">/</span><span>{activeWell.current_formation?.name ?? 'Formation unavailable'}</span><span className="context-separator">/</span><span className="context-status">{humanize(activeWell.status)}</span></div>}
        <Outlet />
      </main>
      <footer className="page-footer"><span><Compass size={13} /> Offset relevance is a transparent heuristic based on historical records.</span><span>Demo dataset · No confidential OIL data</span></footer>
    </div>
    {methodologyOpen && activeWellId && <MethodologyDrawer activeWellId={activeWellId} radiusKm={radiusKm} depthWindowM={depthWindowM} onClose={() => setMethodologyOpen(false)} />}
  </div>
}

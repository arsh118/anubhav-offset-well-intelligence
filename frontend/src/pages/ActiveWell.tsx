import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Activity, ArrowRight, Gauge, Layers, MapPin, MoveUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, queryString, type ActiveAlerts, type Alert, type Correlation, type DrillingMeasurement, type LiveFeed, type OffsetMatch, type Well } from '../lib/api'
import { useApp } from '../lib/AppContext'
import { formatDate, formatDepth, humanize, signedDepth } from '../lib/format'
import { DepthCorrelation } from '../components/DepthCorrelation'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { ActiveWellGate, EmptyState, ErrorState, Loading } from '../components/Feedback'
import { WellCorrelation } from '../components/WellCorrelation'
import { OffsetDepthIntelligence } from '../components/OffsetDepthIntelligence'
import { PageHeading } from './Dashboard'

type WellData = { detail: Well; correlation: Correlation; alerts: ActiveAlerts; measurements: DrillingMeasurement[] }

export function ActiveWellPage() {
  const { activeWell, activeWellId, radiusKm, depthWindowM, wellState } = useApp()
  const [data, setData] = useState<WellData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<OffsetMatch | null>(null)
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null)
  const [selectedOffsetId, setSelectedOffsetId] = useState<string | undefined>()

  const load = useCallback(async () => {
    if (!activeWellId) return
    setLoading(true)
    setError(null)
    try {
      const params = queryString({ radius_km: radiusKm, depth_window_m: depthWindowM })
      const [detail, correlation, alerts, feed] = await Promise.all([
        api<Well>(`/wells/${activeWellId}`),
        api<Correlation>(`/intelligence/${activeWellId}/correlation${params}`),
        api<ActiveAlerts>(`/alerts/active/${activeWellId}${params}`),
        api<LiveFeed>(`/live/${activeWellId}?limit=100`).catch(() => null),
      ])
      setData({ detail, correlation, alerts, measurements: feed?.states.map((row) => row.measurement) ?? [] })
      setSelectedOffsetId((current) => current && correlation.comparable_wells.some((row) => row.offset_well.id === current)
        ? current
        : correlation.comparable_wells[0]?.offset_well.id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load active well details.') }
    finally { setLoading(false) }
  }, [activeWellId, radiusKm, depthWindowM])
  useEffect(() => { void load() }, [load])

  if (!activeWell) return <div className="page-stack"><PageHeading title="Active Well" subtitle="" /><ActiveWellGate state={wellState} readyDetail="Choose a well from the header." /></div>

  return <div className="page-stack">
    <PageHeading title="Active Well" subtitle="" action={<Link className="secondary-button" to="/offsets">Nearby wells <ArrowRight size={14} /></Link>} />
    {error && <ErrorState message={error} retry={() => void load()} />}
    {loading && !data ? <div className="panel loading-panel"><Loading label="Loading active well context" /></div> : data && <>
      <section className="active-well-hero panel">
        <div className="active-well-hero-top"><div className="well-identity"><span className="well-state-dot" /><div><div className="eyebrow">ACTIVE WELL</div><h2>{data.detail.well_name}</h2><p>{humanize(data.detail.status)}</p></div></div></div>
        <div className="well-overview-grid"><WellMetric icon={<Gauge size={18} />} label="Current measured depth" value={formatDepth(data.detail.current_depth)} note={`Total depth ${formatDepth(data.detail.total_depth)}`} /><WellMetric icon={<Layers size={18} />} label="Current formation" value={data.detail.current_formation?.name ?? 'Not recorded'} note={data.detail.formations.length ? `${data.detail.formations.length} formation intervals mapped` : 'No interval data'} /><WellMetric icon={<MapPin size={18} />} label="Nearby offset wells" value={String(data.correlation.matched_wells.length)} note={`Within ${radiusKm} km radius`} /><WellMetric icon={<Activity size={18} />} label="Upcoming precedents" value={String(data.alerts.matching_event_count)} note={`${data.alerts.future_depth_window_m} m look-ahead window`} /></div>
        <details className="well-metadata-details"><summary>Well metadata</summary><div className="well-metadata"><span>SPUD DATE <strong>{formatDate(data.detail.spud_date)}</strong></span><span>COORDINATES <strong>{data.detail.latitude?.toFixed(4) ?? '—'}, {data.detail.longitude?.toFixed(4) ?? '—'}</strong></span><span>DATA SOURCE <strong>{data.detail.source}</strong></span></div></details>
      </section>

      <OffsetDepthIntelligence
        activeWell={data.detail}
        activeMeasurements={data.measurements}
        correlation={data.correlation}
        depthWindowM={depthWindowM}
        selectedOffsetId={selectedOffsetId}
        onSelectOffset={setSelectedOffsetId}
        onSelectEvent={setSelected}
      />

      <details className="active-correlation-details"><summary><span><span className="eyebrow">HISTORICAL PRECEDENTS</span><strong>Full depth correlation and well comparison</strong></span><small>{data.correlation.total_matching_events} matched events</small></summary>
        <div className="active-correlation-content"><DepthCorrelation activeWell={data.detail} events={data.correlation.historical_events} depthWindowM={depthWindowM} onSelect={setSelected} /><WellCorrelation correlation={data.correlation} /></div>
      </details>

      <details className="active-supporting-details"><summary>Event records and formation intervals</summary><div className="two-column-grid">
        <section className="panel"><div className="panel-heading"><div><div className="eyebrow">HISTORICAL SIGNALS</div><h2>Offset event register</h2></div><span className="record-count">{data.correlation.historical_events.length} EVENTS</span></div>
          {data.correlation.historical_events.length === 0 ? <EmptyState title="No historical events in the current correlation window" detail="Expand the search radius or depth window to include more source-backed history." /> : <div className="signal-register">{data.correlation.historical_events.slice(0, 10).map((event) => <button key={event.event_id} className="signal-register-row" onClick={() => setSelected(event)} aria-label={`View evidence for ${event.event_title} in ${event.offset_well.well_name}`}><span className={`event-dot ${event.relevance_band}`} /><span className="signal-register-copy"><strong>{event.event_title}</strong><small>{event.offset_well.well_name} · {event.formation?.name ?? 'Formation unknown'}</small></span><span className="signal-register-depth">{formatDepth(event.historical_depth_m)}<small>{signedDepth(event.depth_difference_m)}</small></span><span className={`score-badge ${event.relevance_band}`}>{Math.round(event.relevance_score)}</span><span className="view-evidence-label">View evidence</span></button>)}</div>}
        </section>
        <section className="panel"><div className="panel-heading"><div><div className="eyebrow">FIELD CONTEXT</div><h2>Formation intervals</h2></div></div>
          {data.detail.formations.length === 0 ? <EmptyState title="No formation intervals recorded" detail="Formation intervals have not been structured for this well." /> : <div className="formation-register">{data.detail.formations.map((interval) => <div key={interval.id} className={`formation-register-row ${interval.formation.normalized_name === data.detail.current_formation?.normalized_name ? 'current' : ''}`}><span className="formation-register-mark" /><span className="formation-register-name"><strong>{interval.formation.name}</strong><small>{interval.formation.aliases.join(' · ')}</small></span><span className="formation-register-range">{formatDepth(interval.top_depth)} <i>→</i> {formatDepth(interval.base_depth)}</span></div>)}</div>}
        </section>
      </div></details>

      <details className="active-alert-details"><summary>Latest historical alerts <span>{data.alerts.alerts.length}</span></summary><section className="panel"><div className="panel-heading"><div><div className="eyebrow">ENGINEER REVIEW</div><h2>Alert register</h2></div><Link to="/alerts" className="inline-link">View alerts <MoveUpRight size={14} /></Link></div>
        {data.alerts.alerts.length === 0 ? <EmptyState title={data.alerts.title} detail="There are no alert records requiring review for this active context." /> : <div className="latest-alert-list">{data.alerts.alerts.slice(0, 3).map((alert) => <button key={alert.id} className="latest-alert-row" onClick={() => setSelectedAlert(alert)}><span className="latest-alert-indicator" /><span><strong>{alert.alert_title}</strong><small>{alert.historical_event?.well_name} · {alert.historical_event?.event_title} · {formatDepth(alert.historical_event?.measured_depth)}</small></span><span className={`status-pill ${alert.status}`}>{humanize(alert.status)}</span><MoveUpRight size={14} /></button>)}</div>}
      </section></details>
    </>}
    {selected && <EvidenceDrawer match={selected} relatedMatches={data?.correlation.historical_events} onClose={() => setSelected(null)} />}
    {selectedAlert && <EvidenceDrawer alert={selectedAlert} match={data?.correlation.historical_events.find((event) => event.event_id === selectedAlert.historical_event_id)} relatedMatches={data?.correlation.historical_events} onClose={() => setSelectedAlert(null)} onUpdated={() => void load()} />}
  </div>
}

function WellMetric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  return <div className="well-metric"><span className="well-metric-icon">{icon}</span><span className="well-metric-label">{label}</span><strong>{value}</strong><small>{note}</small></div>
}

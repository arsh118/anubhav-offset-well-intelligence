import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Activity, ArrowRight, Gauge, Layers, MapPin, MoveUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, queryString, type ActiveAlerts, type Alert, type Correlation, type OffsetMatch, type Well } from '../lib/api'
import { useApp } from '../lib/AppContext'
import { formatDate, formatDepth, humanize, signedDepth } from '../lib/format'
import { DepthCorrelation } from '../components/DepthCorrelation'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { EmptyState, ErrorState, Loading } from '../components/Feedback'
import { WellCorrelation } from '../components/WellCorrelation'
import { PageHeading } from './Dashboard'

type WellData = { detail: Well; correlation: Correlation; alerts: ActiveAlerts }

export function ActiveWellPage() {
  const { activeWell, activeWellId, radiusKm, depthWindowM } = useApp()
  const [data, setData] = useState<WellData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<OffsetMatch | null>(null)
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null)

  const load = useCallback(async () => {
    if (!activeWellId) return
    setLoading(true)
    setError(null)
    try {
      const params = queryString({ radius_km: radiusKm, depth_window_m: depthWindowM })
      const [detail, correlation, alerts] = await Promise.all([
        api<Well>(`/wells/${activeWellId}`),
        api<Correlation>(`/intelligence/${activeWellId}/correlation${params}`),
        api<ActiveAlerts>(`/alerts/active/${activeWellId}${params}`),
      ])
      setData({ detail, correlation, alerts })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load active well details.') }
    finally { setLoading(false) }
  }, [activeWellId, radiusKm, depthWindowM])
  useEffect(() => { void load() }, [load])

  if (!activeWell) return <div className="page-stack"><PageHeading title="Active well" subtitle="Current drilling context and historical precedents." /><EmptyState title="Select an active well" detail="Choose a well from the selector in the header to open its operations summary." /></div>

  return <div className="page-stack">
    <PageHeading title="Active well" subtitle="Current drilling context, nearby analogs, and upcoming historical precedents." action={<Link className="secondary-button" to="/offsets">Review nearby wells <ArrowRight size={14} /></Link>} />
    {error && <ErrorState message={error} retry={() => void load()} />}
    {loading && !data ? <div className="panel loading-panel"><Loading label="Loading active well context" /></div> : data && <>
      <section className="active-well-hero panel">
        <div className="active-well-hero-top"><div className="well-identity"><span className="well-state-dot" /><div><div className="eyebrow">ACTIVE WELL · {data.detail.field ?? 'FIELD UNASSIGNED'}</div><h2>{data.detail.well_name}</h2><p>{humanize(data.detail.status)} <i /> {data.detail.source}</p></div></div><span className="dataset-tag">Representative Synthetic Demo Data</span></div>
        <div className="well-overview-grid"><WellMetric icon={<Gauge size={18} />} label="Current measured depth" value={formatDepth(data.detail.current_depth)} note={`Total depth ${formatDepth(data.detail.total_depth)}`} /><WellMetric icon={<Layers size={18} />} label="Current formation" value={data.detail.current_formation?.name ?? 'Not recorded'} note={data.detail.formations.length ? `${data.detail.formations.length} formation intervals mapped` : 'No interval data'} /><WellMetric icon={<MapPin size={18} />} label="Nearby offset wells" value={String(data.correlation.matched_wells.length)} note={`Within ${radiusKm} km radius`} /><WellMetric icon={<Activity size={18} />} label="Upcoming precedents" value={String(data.alerts.matching_event_count)} note={`${data.alerts.future_depth_window_m} m look-ahead window`} /></div>
        <div className="well-metadata"><span>SPUD DATE <strong>{formatDate(data.detail.spud_date)}</strong></span><span>COORDINATES <strong>{data.detail.latitude?.toFixed(4) ?? '—'}, {data.detail.longitude?.toFixed(4) ?? '—'}</strong></span><span>WELL STATUS <strong>{humanize(data.detail.status)}</strong></span><span>DATA SOURCE <strong>{data.detail.source}</strong></span></div>
      </section>

      <div className="active-section-header"><div><div className="eyebrow">OFFSET INTELLIGENCE</div><h2>Upcoming historical precedents</h2><p>Events within the configured depth window, ranked by explainable relevance.</p></div><span className="record-count">{data.correlation.total_matching_events} MATCHES</span></div>
      <DepthCorrelation activeWell={data.detail} events={data.correlation.historical_events} depthWindowM={depthWindowM} onSelect={setSelected} />
      <WellCorrelation correlation={data.correlation} />

      <div className="two-column-grid">
        <section className="panel"><div className="panel-heading"><div><div className="eyebrow">HISTORICAL SIGNALS</div><h2>Offset event register</h2></div><span className="record-count">{data.correlation.historical_events.length} EVENTS</span></div>
          {data.correlation.historical_events.length === 0 ? <EmptyState title="No historical events in the current correlation window" detail="Expand the search radius or depth window to include more source-backed history." /> : <div className="signal-register">{data.correlation.historical_events.slice(0, 10).map((event) => <button key={event.event_id} className="signal-register-row" onClick={() => setSelected(event)} aria-label={`View evidence for ${event.event_title} in ${event.offset_well.well_name}`}><span className={`event-dot ${event.relevance_band}`} /><span className="signal-register-copy"><strong>{event.event_title}</strong><small>{event.offset_well.well_name} · {event.formation?.name ?? 'Formation unknown'}</small></span><span className="signal-register-depth">{formatDepth(event.historical_depth_m)}<small>{signedDepth(event.depth_difference_m)}</small></span><span className={`score-badge ${event.relevance_band}`}>{Math.round(event.relevance_score)}</span><span className="view-evidence-label">View evidence</span></button>)}</div>}
        </section>
        <section className="panel"><div className="panel-heading"><div><div className="eyebrow">FIELD CONTEXT</div><h2>Formation intervals</h2></div></div>
          {data.detail.formations.length === 0 ? <EmptyState title="No formation intervals recorded" detail="Formation intervals have not been structured for this well." /> : <div className="formation-register">{data.detail.formations.map((interval) => <div key={interval.id} className={`formation-register-row ${interval.formation.normalized_name === data.detail.current_formation?.normalized_name ? 'current' : ''}`}><span className="formation-register-mark" /><span className="formation-register-name"><strong>{interval.formation.name}</strong><small>{interval.formation.aliases.join(' · ')}</small></span><span className="formation-register-range">{formatDepth(interval.top_depth)} <i>→</i> {formatDepth(interval.base_depth)}</span></div>)}</div>}
        </section>
      </div>

      <section className="panel"><div className="panel-heading"><div><div className="eyebrow">CURRENT DECISION SUPPORT</div><h2>Latest historical alert</h2></div><Link to="/alerts" className="inline-link">Alert register <MoveUpRight size={14} /></Link></div>
        {data.alerts.alerts.length === 0 ? <EmptyState title={data.alerts.title} detail="There are no alert records requiring review for this active context." /> : <div className="latest-alert-list">{data.alerts.alerts.slice(0, 3).map((alert) => <button key={alert.id} className="latest-alert-row" onClick={() => setSelectedAlert(alert)}><span className="latest-alert-indicator" /><span><strong>{alert.alert_title}</strong><small>{alert.historical_event?.well_name} · {alert.historical_event?.event_title} · {formatDepth(alert.historical_event?.measured_depth)}</small></span><span className={`status-pill ${alert.status}`}>{humanize(alert.status)}</span><MoveUpRight size={14} /></button>)}</div>}
      </section>
    </>}
    {selected && <EvidenceDrawer match={selected} relatedMatches={data?.correlation.historical_events} onClose={() => setSelected(null)} />}
    {selectedAlert && <EvidenceDrawer alert={selectedAlert} match={data?.correlation.historical_events.find((event) => event.event_id === selectedAlert.historical_event_id)} relatedMatches={data?.correlation.historical_events} onClose={() => setSelectedAlert(null)} onUpdated={() => void load()} />}
  </div>
}

function WellMetric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  return <div className="well-metric"><span className="well-metric-icon">{icon}</span><span className="well-metric-label">{label}</span><strong>{value}</strong><small>{note}</small></div>
}

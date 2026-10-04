import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, CheckCheck, Filter, ShieldCheck } from 'lucide-react'
import { api, queryString, type ActiveAlerts, type Alert, type AlertStatus, type Correlation, type OffsetMatch } from '../lib/api'
import { useApp } from '../lib/AppContext'
import { formatDate, formatDepth, formatDistance, humanize, signedDepth } from '../lib/format'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { ActiveWellGate, EmptyState, ErrorState, Loading } from '../components/Feedback'
import { PageHeading } from './Dashboard'

type AlertData = { summary: ActiveAlerts; alerts: Alert[]; correlation: Correlation }

export function AlertsPage() {
  const { activeWell, activeWellId, radiusKm, depthWindowM, wellState } = useApp()
  const [data, setData] = useState<AlertData | null>(null)
  const [filter, setFilter] = useState<AlertStatus | 'all'>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Alert | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!activeWellId) return
    setLoading(true); setError(null)
    try {
      const query = queryString({ radius_km: radiusKm, depth_window_m: depthWindowM })
      const summary = await api<ActiveAlerts>(`/alerts/active/${activeWellId}${query}`)
      const [alerts, correlation] = await Promise.all([
        api<Alert[]>(`/alerts${queryString({ active_well_id: activeWellId, limit: 500 })}`),
        api<Correlation>(`/intelligence/${activeWellId}/correlation${query}`),
      ])
      setData({ summary, alerts, correlation })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load alert register.') }
    finally { setLoading(false) }
  }, [activeWellId, radiusKm, depthWindowM])
  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => (data?.alerts ?? [])
    .filter((alert) => filter === 'all' || alert.status === filter)
    .sort((left, right) => right.relevance_score - left.relevance_score), [data, filter])
  const matchedEvent = (alert: Alert): OffsetMatch | undefined => data?.correlation.historical_events.find((event) => event.event_id === alert.historical_event_id)
  const summary = data?.summary

  if (!activeWell) return <div className="page-stack"><PageHeading title="Alerts" subtitle="Review, acknowledge, and annotate historical precedent alerts." /><ActiveWellGate state={wellState} readyDetail="The alert register is scoped to the active well selected in the header." /></div>
  return <div className="page-stack">
    <PageHeading title="Historical precedent alerts" subtitle="Review evidence-backed signals generated from nearby well events." action={<span className="radius-summary"><BellRing size={14} />{activeWell.well_name}</span>} />
    {error && <ErrorState message={error} retry={() => void load()} />}
    {loading && !data ? <div className="panel loading-panel"><Loading label="Loading historical alert workflow" /></div> : data && <>
      {summary && <div className={`alert-overview-banner ${summary.category}`}><span className="alert-overview-icon"><ShieldCheck size={18} /></span><div><div className="eyebrow">CURRENT CONTEXT · {summary.category.replace(/_/g, ' ').toUpperCase()}</div><strong>{summary.title}</strong><details className="alert-overview-details"><summary>Context</summary><p>{summary.summary}</p></details></div><div className="alert-overview-count"><strong>{summary.matching_event_count}</strong><span>matched · {summary.future_depth_window_m} m window</span></div></div>}
      <section className="panel"><div className="panel-heading"><div><div className="eyebrow">ENGINEER REVIEW WORKFLOW</div><h2>Alert register <span className="inline-count">{visible.length}</span></h2></div><label className="filter-select"><Filter size={14} /><select aria-label="Filter alerts by status" value={filter} onChange={(event) => setFilter(event.target.value as AlertStatus | 'all')}><option value="all">All statuses</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option></select></label></div>
        {visible.length === 0 ? <EmptyState title={filter === 'all' ? 'No historical precedent alerts' : `No ${humanize(filter).toLowerCase()} alerts`} detail="No alert records match this active well and current context. Historical records remain available in Knowledge." /> : <div className="alert-priority-list">{visible.map((alert) => {
          const match = matchedEvent(alert)
          return <article className="alert-priority-card" key={alert.id}>
            <div className="alert-priority-main"><span className={`event-dot ${alert.relevance_score >= 75 ? 'high' : 'medium'}`} /><div><span className="eyebrow">{alert.relevance_score >= 75 ? 'HIGH' : 'MEDIUM'} HISTORICAL RELEVANCE</span><h3>{alert.alert_title}</h3></div><span className={`status-pill ${alert.status}`}>{humanize(alert.status)}</span></div>
            <div className="alert-priority-facts"><span><small>OFFSET WELL</small><strong>{match?.offset_well.well_name ?? match?.offset_well.field ?? 'Offset well'}</strong></span><span><small>HISTORICAL DEPTH</small><strong>{formatDepth(match?.historical_depth_m)}</strong></span><span><small>DEPTH RELATION</small><strong>{match ? signedDepth(match.depth_difference_m) : 'Unavailable'}</strong></span><span><small>DISTANCE</small><strong>{formatDistance(alert.distance_km ?? match?.distance_km)}</strong></span><span><small>FORMATION</small><strong>{match?.formation?.name ?? 'Not recorded'}</strong></span><span><small>RELEVANCE</small><strong>{Math.round(alert.relevance_score)} / 100</strong></span></div>
            <div className="alert-priority-actions"><button className="secondary-button" onClick={() => setSelected(alert)}>View evidence</button><button className="primary-button" onClick={() => setSelected(alert)}><CheckCheck size={14} /> Review alert</button><small>Created {formatDate(alert.created_at)}</small></div>
          </article>
        })}</div>}
        <div className="alert-panel-footer"><span>Alert status is an engineer review workflow, not a prediction of an incident.</span><span>Updates are saved to the ANUBHAV API.</span></div>
      </section>
      <div className="alert-workflow-note"><span className="workflow-note-mark" /><div><strong>Review workflow</strong><span>Open → Acknowledged → Reviewed · Engineers can add a note to preserve review context.</span></div></div>
      {notice && <div className="inline-notice">{notice}</div>}
    </>}
    {selected && <EvidenceDrawer key={selected.id} alert={selected} match={matchedEvent(selected)} relatedMatches={data?.correlation.historical_events} onClose={() => setSelected(null)} onUpdated={() => { setNotice('Alert changes saved.'); void load() }} />}
  </div>
}

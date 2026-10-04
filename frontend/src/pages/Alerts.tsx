import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, CheckCheck, Filter, ShieldCheck } from 'lucide-react'
import { api, queryString, type ActiveAlerts, type Alert, type AlertStatus, type Correlation, type OffsetMatch } from '../lib/api'
import { useApp } from '../lib/AppContext'
import { formatDate, formatDepth, formatDistance, humanize, signedDepth } from '../lib/format'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { EmptyState, ErrorState, Loading } from '../components/Feedback'
import { PageHeading } from './Dashboard'

type AlertData = { summary: ActiveAlerts; alerts: Alert[]; correlation: Correlation }

export function AlertsPage() {
  const { activeWell, activeWellId, radiusKm, depthWindowM } = useApp()
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

  const visible = useMemo(() => (data?.alerts ?? []).filter((alert) => filter === 'all' || alert.status === filter), [data, filter])
  const matchedEvent = (alert: Alert): OffsetMatch | undefined => data?.correlation.historical_events.find((event) => event.event_id === alert.historical_event_id)
  const summary = data?.summary

  if (!activeWell) return <div className="page-stack"><PageHeading title="Alerts" subtitle="Review, acknowledge, and annotate historical precedent alerts." /><EmptyState title="Select an active well" detail="The alert register is scoped to the active well selected in the header." /></div>
  return <div className="page-stack">
    <PageHeading title="Historical precedent alerts" subtitle="Review evidence-backed signals generated from nearby well events." action={<span className="radius-summary"><BellRing size={14} />{activeWell.well_name}</span>} />
    {error && <ErrorState message={error} retry={() => void load()} />}
    {loading && !data ? <div className="panel loading-panel"><Loading label="Loading historical alert workflow" /></div> : data && <>
      {summary && <div className={`alert-overview-banner ${summary.category}`}><span className="alert-overview-icon"><ShieldCheck size={18} /></span><div><div className="eyebrow">CURRENT CONTEXT · {summary.category.replace(/_/g, ' ').toUpperCase()}</div><strong>{summary.title}</strong><p>{summary.summary}</p></div><div className="alert-overview-count"><strong>{summary.matching_event_count}</strong><span>matched precedents<br />within {summary.future_depth_window_m} m ahead</span></div></div>}
      <section className="panel"><div className="panel-heading"><div><div className="eyebrow">ENGINEER REVIEW WORKFLOW</div><h2>Alert register <span className="inline-count">{visible.length}</span></h2></div><label className="filter-select"><Filter size={14} /><select aria-label="Filter alerts by status" value={filter} onChange={(event) => setFilter(event.target.value as AlertStatus | 'all')}><option value="all">All statuses</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option></select></label></div>
        {visible.length === 0 ? <EmptyState title={filter === 'all' ? 'No historical precedent alerts' : `No ${humanize(filter).toLowerCase()} alerts`} detail="No alert records match this active well and current context. Historical records remain available in Knowledge." /> : <div className="data-table-wrap"><table className="data-table alerts-table"><thead><tr><th>PRECEDENT</th><th>OFFSET WELL</th><th>HISTORICAL DEPTH</th><th>FORMATION</th><th>DISTANCE</th><th>RELEVANCE</th><th>STATUS</th><th></th></tr></thead><tbody>{visible.map((alert) => {
          const match = matchedEvent(alert)
          return <tr key={alert.id} onClick={() => setSelected(alert)}><td><strong>{alert.alert_title}</strong><small className="table-subline">{match?.event_type ? humanize(match.event_type) : 'Historical event'} · {formatDate(alert.created_at)}</small></td><td>{match?.offset_well.well_name ?? match?.offset_well.field ?? 'Offset well'}</td><td>{formatDepth(match?.historical_depth_m)}<small className="table-subline">{match ? signedDepth(match.depth_difference_m) : 'Depth delta unavailable'}</small></td><td>{match?.formation?.name ?? '—'}</td><td>{formatDistance(alert.distance_km ?? match?.distance_km)}</td><td><span className={`score-badge ${alert.relevance_score >= 75 ? 'high' : 'medium'}`}>{Math.round(alert.relevance_score)}</span></td><td><span className={`status-pill ${alert.status}`}>{humanize(alert.status)}</span></td><td><button className="table-action" onClick={(event) => { event.stopPropagation(); setSelected(alert) }}>Review <CheckCheck size={13} /></button></td></tr>
        })}</tbody></table></div>}
        <div className="alert-panel-footer"><span>Alert status is an engineer review workflow, not a prediction of an incident.</span><span>Updates are saved to the ANUBHAV API.</span></div>
      </section>
      <div className="alert-workflow-note"><span className="workflow-note-mark" /><div><strong>Review workflow</strong><span>Open → Acknowledged → Reviewed · Engineers can add a note to preserve review context.</span></div></div>
      {notice && <div className="inline-notice">{notice}</div>}
    </>}
    {selected && <EvidenceDrawer key={selected.id} alert={selected} match={matchedEvent(selected)} relatedMatches={data?.correlation.historical_events} onClose={() => setSelected(null)} onUpdated={() => { setNotice('Alert changes saved.'); void load() }} />}
  </div>
}

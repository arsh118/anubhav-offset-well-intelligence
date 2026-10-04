import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, Check, Filter } from 'lucide-react'
import { api, queryString, type ActiveAlerts, type Alert, type AlertStatus, type Correlation, type OffsetMatch } from '../lib/api'
import { useApp } from '../lib/AppContext'
import { humanize } from '../lib/format'
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
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null)

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

  const acknowledge = async (alert: Alert) => {
    setBusyAlertId(alert.id); setError(null)
    try {
      await api<Alert>(`/alerts/${alert.id}/acknowledge`, { method: 'POST' })
      setNotice('Alert acknowledged.')
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to acknowledge alert.') }
    finally { setBusyAlertId(null) }
  }

  if (!activeWell) return <div className="page-stack"><PageHeading title="Alerts" subtitle="" /><ActiveWellGate state={wellState} readyDetail="Select an active well to review its alert register." /></div>
  return <div className="page-stack">
    <PageHeading title="Alerts" subtitle="" action={<span className="radius-summary"><BellRing size={14} />{activeWell.well_name}</span>} />
    {error && <ErrorState message={error} retry={() => void load()} />}
    {loading && !data ? <div className="panel loading-panel"><Loading label="Loading historical alert workflow" /></div> : data && <>
      {summary && <details className="alert-context-details"><summary>{humanize(summary.category)} · {summary.matching_event_count} matches · {summary.future_depth_window_m} m window</summary><p>{summary.summary}</p></details>}
      <section className="panel"><div className="panel-heading"><div><div className="eyebrow">ENGINEER REVIEW WORKFLOW</div><h2>Alert register <span className="inline-count">{visible.length}</span></h2></div><label className="filter-select"><Filter size={14} /><select aria-label="Filter alerts by status" value={filter} onChange={(event) => setFilter(event.target.value as AlertStatus | 'all')}><option value="all">All statuses</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option></select></label></div>
        {visible.length === 0 ? <EmptyState title={filter === 'all' ? 'No historical precedent alerts' : `No ${humanize(filter).toLowerCase()} alerts`} detail="No alert records match this active well and current context. Historical records remain available in Knowledge." /> : <div className="alert-priority-list">{visible.map((alert) => {
          const match = matchedEvent(alert)
          return <article className="alert-priority-card" key={alert.id}>
            <div className="alert-priority-main"><span className={`event-dot ${alert.relevance_score >= 75 ? 'high' : 'medium'}`} /><div><span className="eyebrow">{alert.relevance_score >= 75 ? 'HIGH' : 'MEDIUM'} HISTORICAL RELEVANCE</span><h3>{humanize(match?.event_type ?? alert.alert_type)}</h3><p>{match?.offset_well.well_name ?? match?.offset_well.field ?? 'Offset well'} <span>·</span> {match ? `${Math.abs(Math.round(match.depth_difference_m))} m ${match.depth_difference_m > 0 ? 'ahead' : match.depth_difference_m < 0 ? 'behind' : 'at depth'}` : 'Depth relation unavailable'}</p></div><span className={`status-pill ${alert.status}`}>{humanize(alert.status)}</span></div>
            <div className="alert-priority-actions"><button className="secondary-button" onClick={() => setSelected(alert)}>View</button>{alert.status === 'open' && <button className="primary-button" onClick={() => void acknowledge(alert)} disabled={busyAlertId === alert.id}><Check size={14} />{busyAlertId === alert.id ? 'Saving…' : 'Acknowledge'}</button>}</div>
          </article>
        })}</div>}
      </section>
      <details className="alert-workflow-details"><summary>Review workflow</summary><p>Open → Acknowledged → Reviewed. Engineers can add a note in alert details.</p></details>
      {notice && <div className="inline-notice">{notice}</div>}
    </>}
    {selected && <EvidenceDrawer key={selected.id} alert={selected} match={matchedEvent(selected)} relatedMatches={data?.correlation.historical_events} onClose={() => setSelected(null)} onUpdated={() => { setNotice('Alert changes saved.'); void load() }} />}
  </div>
}

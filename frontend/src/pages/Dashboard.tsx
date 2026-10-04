import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, ArrowUpRight, BellRing, BookOpen, Database, MapPin, Radio, ShieldAlert, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, queryString, type ActiveAlerts, type Alert, type Correlation, type NearbyWell, type OffsetMatch, type OffsetWellSummary } from '../lib/api'
import { useApp } from '../lib/AppContext'
import { formatDepth, formatDistance, humanize, signedDepth } from '../lib/format'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { EmptyState, ErrorState, Loading } from '../components/Feedback'
import { OffsetMap } from '../components/OffsetMap'
import { DemoScenarioGuide } from '../components/DemoScenarioGuide'
import { getJudgingPrecedents } from '../lib/demoScenario'
import { LiveIntelligence } from '../components/LiveIntelligence'

type DashboardData = { correlation: Correlation; nearby: NearbyWell[]; eventCount: number; alerts: ActiveAlerts }

export function Dashboard() {
  const { activeWell, activeWellId, radiusKm, depthWindowM, demoMode } = useApp()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMatch, setSelectedMatch] = useState<OffsetMatch | null>(null)
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null)

  const load = useCallback(async () => {
    if (!activeWellId) { setData(null); return }
    setLoading(true)
    setError(null)
    try {
      const params = queryString({ radius_km: radiusKm, depth_window_m: depthWindowM, limit: 100 })
      const [correlation, nearbyResponse, eventSummary, alerts] = await Promise.all([
        api<Correlation>(`/intelligence/${activeWellId}/correlation${params}`),
        api<{ items: NearbyWell[] }>(`/wells/${activeWellId}/nearby${queryString({ radius_km: radiusKm, limit: 200 })}`),
        api<{ total: number }>('/events/summary'),
        api<ActiveAlerts>(`/alerts/active/${activeWellId}${queryString({ radius_km: radiusKm, depth_window_m: depthWindowM })}`),
      ])
      setData({ correlation, nearby: nearbyResponse.items, eventCount: eventSummary.total, alerts })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load dashboard data.') }
    finally { setLoading(false) }
  }, [activeWellId, radiusKm, depthWindowM])

  useEffect(() => { void load() }, [load])

  const mapOffsets = useMemo<OffsetWellSummary[]>(() => {
    const matchingById = new Map((data?.correlation.matched_wells ?? []).map((item) => [item.id, item]))
    return (data?.nearby ?? []).map(({ well, distance_km }) => {
      const match = matchingById.get(well.id)
      return {
        id: well.id, well_name: well.well_name, field: well.field, latitude: well.latitude, longitude: well.longitude,
        distance_km, matching_event_count: match?.matching_event_count ?? 0, best_relevance_score: match?.best_relevance_score ?? 0, event_ids: match?.event_ids ?? [],
      }
    })
  }, [data])

  const featuredDemoMatches = useMemo(() => getJudgingPrecedents(data?.correlation.historical_events ?? []), [data])
  const displayedMatches = demoMode ? featuredDemoMatches : data?.correlation.historical_events ?? []
  const leadMatch = useMemo(() => {
    const matches = data?.correlation.historical_events ?? []
    const featured = demoMode ? featuredDemoMatches[0] : null
    if (featured) return featured
    const firstUpcoming = matches.find((match) => match.depth_difference_m > 0)
    return firstUpcoming ?? matches[0] ?? null
  }, [data, demoMode, featuredDemoMatches])
  const leadAlert = data?.alerts.alerts.find((alert) => alert.historical_event_id === leadMatch?.event_id)
    ?? data?.alerts.alerts[0]
    ?? null

  if (!activeWell) return <div className="page-stack"><PageHeading title="Operations overview" subtitle="Evidence-backed historical context for the active well." />{loading ? <Loading /> : error ? <ErrorState message={error} retry={() => void load()} /> : <EmptyState title="No active well available" detail="An active well record is needed before offset relevance can be calculated." />}</div>

  return <div className="page-stack dashboard-page">
    <PageHeading title="ANUBHAV" subtitle="AI-powered offset well intelligence for current drilling decisions." />
    {error && <ErrorState message={error} retry={() => void load()} />}
    {loading && !data ? <div className="panel loading-panel"><Loading label="Correlating offset wells and historical events" /></div> : data && <>
      <section className="active-summary panel" aria-label="Active well summary">
        <div className="active-summary-copy">
          <div className="eyebrow">ACTIVE WELL <span className="active-summary-divider">/</span> {activeWell.field ?? 'FIELD UNASSIGNED'}</div>
          <h2>{activeWell.well_name}</h2>
          <p>Historical drilling intelligence from nearby and analogous wells.</p>
        </div>
        <div className="active-summary-facts">
          <div className="active-summary-depth"><span>Current depth</span><strong>{formatDepth(activeWell.current_depth)} <small>MD</small></strong></div>
          <div className="active-summary-formation"><span>Current formation</span><strong>{activeWell.current_formation?.name ?? 'Formation unavailable'}</strong></div>
          <span className="active-summary-status"><i />{humanize(activeWell.status)}</span>
        </div>
        <Link className="active-summary-link" to="/active-well">Explore active well <ArrowUpRight size={15} /></Link>
      </section>

      <div className="kpi-grid">
        <Kpi icon={<MapPin size={18} />} label="Nearby wells" value={String(data.nearby.length)} detail={`Within ${radiusKm} km`} accent="teal" />
        <Kpi icon={<Database size={18} />} label="Historical events" value={data.eventCount.toLocaleString()} detail="Structured source records" accent="blue" />
        <Kpi icon={<Activity size={18} />} label="Relevant precedents" value={String(data.correlation.total_matching_events)} detail={`${data.correlation.matched_wells.length} offset wells matched`} accent="amber" />
        <Kpi icon={<BellRing size={18} />} label="Open signals" value={String(data.alerts.alerts.filter((alert) => alert.status === 'open' || alert.status === 'acknowledged').length)} detail="Awaiting engineer review" accent="red" />
      </div>

      <section className={`precedent-hero panel ${leadMatch?.relevance_band ?? 'none'}`} aria-labelledby="precedent-title">
        <div className="precedent-hero-heading"><span className="precedent-icon"><TriangleAlert size={19} /></span><div><div className="eyebrow">HISTORICAL PRECEDENT</div><h2 id="precedent-title">{leadMatch?.event_title ?? data.alerts.title}</h2></div><span className={`precedent-relevance ${leadMatch?.relevance_band ?? 'none'}`}>{leadMatch ? `${humanize(leadMatch.relevance_band)} historical relevance` : 'No significant precedent'}</span></div>
        {leadMatch ? <>
          <div className="precedent-facts" aria-label="Historical precedent details">
            <div><span>Offset well</span><strong>{leadMatch.offset_well.well_name}</strong></div>
            <div><span>Historical depth</span><strong>{formatDepth(leadMatch.historical_depth_m)}</strong></div>
            <div><span>Depth from active</span><strong>{signedDepth(leadMatch.depth_difference_m)}</strong></div>
            <div><span>Distance</span><strong>{formatDistance(leadMatch.distance_km)} away</strong></div>
            <div><span>Formation</span><strong>{leadMatch.formation?.name ?? 'Not recorded'}</strong></div>
          </div>
          <p className="precedent-explanation">{leadMatch.formation_match === 'exact' ? 'Same formation' : `${humanize(leadMatch.formation_match)} formation context`}, nearby offset well, and a documented historical event {leadMatch.depth_difference_m > 0 ? `${leadMatch.depth_difference_m} m ahead` : 'near the active depth'}.</p>
          <button type="button" className="precedent-action" onClick={() => { setSelectedMatch(leadMatch); setSelectedAlert(leadAlert) }} aria-label={`View evidence and mitigation for ${leadMatch.event_title}`}>
            <BookOpen size={16} /> View evidence &amp; mitigation <ArrowUpRight size={16} />
          </button>
        </> : <div className="precedent-empty"><p>No source-backed precedent is available in the current radius and depth window.</p><Link to="/knowledge">Search historical records <ArrowUpRight size={14} /></Link></div>}
      </section>

      <LiveIntelligence activeWellId={activeWellId} radiusKm={radiusKm} depthWindowM={depthWindowM} />

      <div className="dashboard-spatial-grid">
        <section className="panel map-panel">
          <div className="panel-heading"><div><div className="eyebrow">LOCATION CONTEXT · {activeWell.field ?? 'FIELD UNASSIGNED'}</div><h2>Nearby wells</h2></div><span className="panel-meta"><i className="map-radius-icon" />{radiusKm} km radius</span></div>
          <div className="map-wrap"><OffsetMap activeWell={activeWell} offsets={mapOffsets} events={displayedMatches} radiusKm={radiusKm} /></div>
          <div className="map-legend"><span><i className="legend-active" />Active well <b>{activeWell.well_name}</b></span><span><i className="legend-offset" />Nearby well</span><span><i className="legend-match" />Historical match</span></div>
        </section>
        <section className="panel nearby-list-panel" aria-labelledby="nearby-list-title">
          <div className="panel-heading"><div><div className="eyebrow">OFFSET REGISTER</div><h2 id="nearby-list-title">Nearby offsets</h2></div><span className="record-count">{data.nearby.length} WELLS</span></div>
          {data.nearby.length ? <div className="nearby-list">{data.nearby.map(({ well, distance_km }) => {
            const offset = mapOffsets.find((item) => item.id === well.id)
            const matchedEvent = data.correlation.historical_events.find((event) => event.offset_well.id === well.id)
            const eventCount = offset?.matching_event_count ?? 0
            return <Link className="nearby-list-row" key={well.id} to="/offsets">
              <span className="nearby-list-marker"><MapPin size={16} /></span>
              <span className="nearby-list-main"><strong>{well.well_name}</strong><small>{matchedEvent?.formation?.name ?? well.current_formation?.name ?? 'Formation not recorded'}</small></span>
              <span className="nearby-list-meta"><strong>{formatDistance(distance_km)}</strong><small>{eventCount} relevant {eventCount === 1 ? 'event' : 'events'}</small></span>
            </Link>
          })}</div> : <EmptyState title="No nearby offset wells in this radius" detail="Increase the radius to include more wells." />}
          <div className="nearby-list-footer"><span>Historical matches are source-linked records.</span><Link to="/offsets">View offset register <ArrowUpRight size={14} /></Link></div>
        </section>
      </div>

      <div className="dashboard-insight-grid">
        <section className="panel historical-list-panel" aria-labelledby="historical-list-title">
          <div className="panel-heading"><div><div className="eyebrow">SOURCE-LINKED EVENT RECORDS</div><h2 id="historical-list-title">Historical intelligence</h2></div><span className="record-count">{displayedMatches.length} MATCHES</span></div>
          {displayedMatches.length === 0 ? <EmptyState title="No significant historical match" detail="Widen the search controls to review more history." /> : <div className="historical-list">{displayedMatches.slice(0, 4).map((event) => <button key={event.event_id} className="historical-list-row" onClick={() => { setSelectedMatch(event); setSelectedAlert(null) }} aria-label={`View evidence for ${event.event_title} in ${event.offset_well.well_name}`}>
            <span className={`event-dot ${event.relevance_band}`} /><span className="historical-list-main"><strong>{event.event_title}</strong><small>{event.offset_well.well_name} · {event.formation?.name ?? 'Formation unknown'}</small></span><span className="historical-list-depth">{formatDepth(event.historical_depth_m)}<small>{signedDepth(event.depth_difference_m)}</small></span><span className={`score-badge ${event.relevance_band}`}>{humanize(event.relevance_band)}</span><span className="historical-list-source">View evidence <ArrowUpRight size={13} /></span>
          </button>)}</div>}
          <div className="historical-list-footer"><ShieldAlert size={14} /><span>Historical relevance supports engineer review; it does not predict incidents.</span><Link to="/offsets">View all matches <ArrowUpRight size={14} /></Link></div>
        </section>
        <section className="panel correlation-insight-panel" aria-labelledby="correlation-insight-title">
          <div className="panel-heading"><div><div className="eyebrow">CORRELATION INSIGHT</div><h2 id="correlation-insight-title">Closest relevant offset</h2></div><Activity size={17} className="panel-heading-icon" /></div>
          {leadMatch ? <div className="correlation-insight">
            <div className="correlation-insight-top"><strong>{leadMatch.offset_well.well_name}</strong><span className={`precedent-relevance ${leadMatch.relevance_band}`}>{humanize(leadMatch.relevance_band)} relevance</span></div>
            <div className="correlation-insight-facts"><span>{leadMatch.formation_match === 'exact' ? 'Same formation' : `${humanize(leadMatch.formation_match)} formation`}</span><span>{signedDepth(leadMatch.depth_difference_m)}</span><span>{formatDistance(leadMatch.distance_km)} away</span></div>
            <p>{leadMatch.explanation}</p>
          </div> : <EmptyState title="No correlated offset available" detail="Try a wider radius or depth window." />}
          <div className="correlation-insight-footer"><Link to="/active-well">View full correlation <ArrowUpRight size={14} /></Link></div>
        </section>
      </div>

      <details className="dashboard-secondary-details">
        <summary>Active alert records <span>{data.alerts.alerts.length}</span></summary>
        <section className="panel alert-panel">
          <div className="panel-heading"><div><div className="eyebrow">DECISION SUPPORT · HISTORICAL RECORDS</div><h2>Alert register preview</h2></div><span className={`alert-category ${data.alerts.category}`}>{humanize(data.alerts.category)}</span></div>
          <div className="alert-summary"><div className={`alert-state-icon ${data.alerts.category}`}><Radio size={18} /></div><div><strong>{data.alerts.title}</strong><p>{data.alerts.summary}</p></div><span className="alert-window">{data.alerts.matching_event_count} matched · next {data.alerts.future_depth_window_m} m</span></div>
          {data.alerts.alerts.length === 0 ? <EmptyState title="No significant historical precedent found in the selected radius and depth window." detail="Historical events remain searchable in Knowledge." /> : <div className="alert-records">
            {data.alerts.alerts.slice(0, 4).map((alert) => {
              const event = alert.historical_event
              return <button className="alert-record" key={alert.id} onClick={() => { setSelectedMatch(null); setSelectedAlert(alert) }} aria-label={`Review evidence for ${event?.event_title ?? 'historical event'}`}><span className={`event-dot ${alert.relevance_score >= 75 ? 'high' : 'medium'}`} /><span className="alert-record-event"><strong>{event?.event_title ?? 'Historical event'}</strong><small>{event?.well_name ?? 'Offset well'} · {formatDepth(event?.measured_depth)} · {event?.formation?.name ?? 'Formation not recorded'}</small></span><span className="status-pill">{humanize(alert.status)}</span><span className="alert-open">Review evidence <ArrowUpRight size={13} /></span></button>
            })}
          </div>}
          <div className="alert-panel-footer"><span>Historical precedent identified from documented offset well records.</span><Link to="/alerts">Open alert register <ArrowUpRight size={14} /></Link></div>
        </section>
      </details>

      {demoMode && <DemoScenarioGuide activeWell={activeWell} precedents={featuredDemoMatches} onOpenEvidence={setSelectedMatch} />}
    </>}
    {(selectedMatch || selectedAlert) && <EvidenceDrawer key={selectedAlert?.id ?? selectedMatch?.event_id} match={selectedMatch} alert={selectedAlert} relatedMatches={data?.correlation.historical_events} onClose={() => { setSelectedMatch(null); setSelectedAlert(null) }} onUpdated={() => void load()} />}
  </div>
}

export function PageHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">ANUBHAV / OFFSET WELL INTELLIGENCE</div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="page-heading-action">{action}</div>}</div>
}

function Kpi({ icon, label, value, detail, accent }: { icon: ReactNode; label: string; value: string; detail: string; accent: string }) {
  return <div className={`kpi-card ${accent}`}><div className="kpi-top"><span className="kpi-icon">{icon}</span><span className="kpi-label">{label}</span></div><div className="kpi-value">{value}</div><div className="kpi-detail">{detail}</div></div>
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, LocateFixed, MapPin, Search } from 'lucide-react'
import { api, queryString, type Correlation, type NearbyWell, type OffsetMatch, type OffsetWellSummary } from '../lib/api'
import { useApp } from '../lib/AppContext'
import { formatDepth, formatDistance, humanize } from '../lib/format'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { EmptyState, ErrorState, Loading } from '../components/Feedback'
import { OffsetMap } from '../components/OffsetMap'
import { PageHeading } from './Dashboard'

type OffsetData = { nearby: NearbyWell[]; correlation: Correlation }

export function OffsetWellsPage() {
  const { activeWell, activeWellId, radiusKm, depthWindowM } = useApp()
  const [data, setData] = useState<OffsetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedWellId, setSelectedWellId] = useState<string | undefined>()
  const [selected, setSelected] = useState<OffsetMatch | null>(null)

  const load = useCallback(async () => {
    if (!activeWellId) return
    setLoading(true); setError(null)
    try {
      const [nearby, correlation] = await Promise.all([
        api<{ items: NearbyWell[] }>(`/wells/${activeWellId}/nearby${queryString({ radius_km: radiusKm, limit: 200 })}`),
        api<Correlation>(`/intelligence/${activeWellId}/correlation${queryString({ radius_km: radiusKm, depth_window_m: depthWindowM, limit: 500 })}`),
      ])
      setData({ nearby: nearby.items, correlation })
      setSelectedWellId((current) => current && nearby.items.some((item) => item.well.id === current)
        ? current
        : correlation.historical_events[0]?.offset_well.id ?? nearby.items[0]?.well.id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load nearby wells.') }
    finally { setLoading(false) }
  }, [activeWellId, radiusKm, depthWindowM])
  useEffect(() => { void load() }, [load])

  const offsets = useMemo<OffsetWellSummary[]>(() => {
    const matching = new Map((data?.correlation.matched_wells ?? []).map((well) => [well.id, well]))
    return (data?.nearby ?? []).map(({ well, distance_km }) => {
      const result = matching.get(well.id)
      return { id: well.id, well_name: well.well_name, field: well.field, latitude: well.latitude, longitude: well.longitude, distance_km, matching_event_count: result?.matching_event_count ?? 0, best_relevance_score: result?.best_relevance_score ?? 0, event_ids: result?.event_ids ?? [] }
    })
  }, [data])
  const filtered = offsets.filter((well) => `${well.well_name} ${well.field ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
  const selectedWell = filtered.find((well) => well.id === selectedWellId)
  const selectedEvents = data?.correlation.historical_events.filter((event) => event.offset_well.id === selectedWellId) ?? []

  if (!activeWell) return <div className="page-stack offset-wells-page"><PageHeading title="Offset wells" subtitle="Nearby analog wells and their correlated historical records." /><EmptyState title="Select an active well" detail="Nearby distances are calculated relative to the active well selected in the header." /></div>
  return <div className="page-stack offset-wells-page">
    <PageHeading title="Offset wells" subtitle={`Nearby wells and source-backed events relative to ${activeWell.well_name}.`} action={<span className="radius-summary"><LocateFixed size={14} />{radiusKm} km search radius</span>} />
    {error && <ErrorState message={error} retry={() => void load()} />}
    {loading && !data ? <div className="panel loading-panel"><Loading label="Locating nearby offset wells" /></div> : data && <>
      <div className="offset-overview"><div className="offset-overview-main"><span className="overview-icon"><MapPin size={19} /></span><div><div className="eyebrow">SPATIAL ANALOG SEARCH</div><strong>{data.nearby.length} offset wells located</strong><p>Distances use well coordinates and Haversine calculation. Event matches also account for formation and depth.</p></div></div><div className="offset-overview-metric"><span>ACTIVE WELL</span><strong>{activeWell.well_name}</strong></div><div className="offset-overview-metric"><span>DEPTH / FORMATION</span><strong>{formatDepth(activeWell.current_depth)} · {activeWell.current_formation?.name ?? '—'}</strong></div></div>
      <section className="panel offset-map-panel"><div className="panel-heading"><div><div className="eyebrow">MAP VIEW · {activeWell.field ?? 'FIELD'}</div><h2>Spatial relationship</h2></div><div className="map-key-compact"><span><i className="legend-active" />Active</span><span><i className="legend-offset" />Offset</span><span><i className="legend-match" />Event match</span></div></div>
        <div className="offset-map-layout"><div className="offset-map-area"><OffsetMap activeWell={activeWell} offsets={offsets} events={data.correlation.historical_events} radiusKm={radiusKm} selectedWellId={selectedWellId} onSelectWell={setSelectedWellId} /></div><div className="offset-map-list"><div className="offset-list-title"><span>NEARBY WELLS</span><span>{offsets.length} TOTAL</span></div>{filtered.length === 0 ? <EmptyState title="No nearby wells found" detail="There are no offset wells inside the current radius." /> : filtered.map((well) => <button className={`offset-list-row ${well.id === selectedWellId ? 'selected' : ''}`} key={well.id} onClick={() => setSelectedWellId(well.id)}><span className="offset-well-pin"><MapPin size={15} /></span><span className="offset-well-name"><strong>{well.well_name}</strong><small>{well.field ?? 'Field unavailable'}</small></span><span className="offset-distance">{formatDistance(well.distance_km)}<small>{well.matching_event_count ? `${well.matching_event_count} events` : 'No depth match'}</small></span></button>)}</div></div>
      </section>
      <section className="panel offset-register-panel"><div className="panel-heading"><div><div className="eyebrow">OFFSET REGISTER</div><h2>Well and event relevance</h2></div><div className="table-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter wells" /></div></div>
        {filtered.length === 0 ? <EmptyState title="No offset wells in this search" detail="Change the well name search or increase the radius using the header control." /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>OFFSET WELL</th><th>DISTANCE</th><th>FIELD</th><th>FORMATION OVERLAP</th><th>CORRELATED EVENTS</th><th>BEST RELEVANCE</th><th></th></tr></thead><tbody>{filtered.map((well) => {
          const item = data.nearby.find((entry) => entry.well.id === well.id)
          const formationMatch = item?.formation_match
          return <tr key={well.id} onClick={() => setSelectedWellId(well.id)} className={well.id === selectedWellId ? 'row-selected' : ''}><td><strong>{well.well_name}</strong><small className="table-subline">{item?.well.current_depth ? formatDepth(item.well.current_depth) : 'Historical well'}</small></td><td>{formatDistance(well.distance_km)}</td><td>{well.field ?? '—'}</td><td><span className={`match-indicator ${formationMatch ? 'yes' : formationMatch === false ? 'no' : 'unknown'}`}><i />{formationMatch === true ? 'Formation match' : formationMatch === false ? 'Different' : 'Unknown'}</span></td><td>{well.matching_event_count || '—'}</td><td>{well.best_relevance_score ? `${Math.round(well.best_relevance_score)} / 100` : '—'}</td><td><button className="table-action" onClick={(event) => { event.stopPropagation(); setSelectedWellId(well.id) }}>Inspect <ArrowRight size={13} /></button></td></tr>
        })}</tbody></table></div>}
      </section>
      {selectedWell && <section className="panel selected-offset-panel"><div className="panel-heading"><div><div className="eyebrow">SELECTED OFFSET · {formatDistance(selectedWell.distance_km)}</div><h2>{selectedWell.well_name}</h2></div><span className="record-count">{selectedEvents.length} CORRELATED EVENTS</span></div>
        {selectedEvents.length === 0 ? <EmptyState title="No significant historical match in current depth window" detail="This nearby well remains spatially relevant, but no event currently meets the depth and formation criteria." /> : <div className="signal-register">{selectedEvents.map((event) => <button key={event.event_id} className="signal-register-row" onClick={() => setSelected(event)} aria-label={`View evidence for ${event.event_title} in ${event.offset_well.well_name}`}><span className={`event-dot ${event.relevance_band}`} /><span className="signal-register-copy"><strong>{event.event_title}</strong><small>{humanize(event.event_type)} · {event.formation?.name ?? 'Formation unknown'}</small></span><span className="signal-register-depth">{formatDepth(event.historical_depth_m)}<small>{Math.round(event.depth_difference_m)} m from active</small></span><span className={`score-badge ${event.relevance_band}`}>{Math.round(event.relevance_score)}</span><span className="view-evidence-label">View evidence</span></button>)}</div>}
      </section>}
    </>}
    {selected && <EvidenceDrawer match={selected} relatedMatches={data?.correlation.historical_events} onClose={() => setSelected(null)} />}
  </div>
}

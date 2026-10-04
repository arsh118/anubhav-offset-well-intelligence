import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { BookOpen, Search, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api, queryString, type Correlation, type Formation, type OffsetMatch, type WellEvent } from '../lib/api'
import { useApp } from '../lib/AppContext'
import { formatDepth, formatDate, humanize } from '../lib/format'
import { EmptyState, ErrorState, Loading } from '../components/Feedback'
import { EventDistribution } from '../components/EventDistribution'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { PageHeading } from './Dashboard'

type Filters = { q: string; eventType: string; formation: string; wellId: string; depthMin: string; depthMax: string; dateFrom: string; dateTo: string; relevance: string }
const EMPTY_FILTERS: Filters = { q: '', eventType: '', formation: '', wellId: '', depthMin: '', depthMax: '', dateFrom: '', dateTo: '', relevance: '' }

export function KnowledgePage() {
  const { wells, activeWellId, radiusKm, depthWindowM } = useApp()
  const [searchParams] = useSearchParams()
  const initialFilters = { ...EMPTY_FILTERS, q: searchParams.get('q') ?? '' }
  const [form, setForm] = useState<Filters>(initialFilters)
  const [applied, setApplied] = useState<Filters>(initialFilters)
  const [events, setEvents] = useState<WellEvent[]>([])
  const [formations, setFormations] = useState<Formation[]>([])
  const [correlation, setCorrelation] = useState<Correlation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<WellEvent | null>(null)

  useEffect(() => {
    let current = true
    api<Formation[]>('/formations').then((result) => { if (current) setFormations(result) }).catch(() => { /* Formation filtering can still use loaded records. */ })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (!activeWellId) { setCorrelation(null); return }
    let current = true
    api<Correlation>(`/intelligence/${activeWellId}/correlation${queryString({ radius_km: radiusKm, depth_window_m: depthWindowM, limit: 500 })}`)
      .then((result) => { if (current) setCorrelation(result) })
      .catch(() => { if (current) setCorrelation(null) })
    return () => { current = false }
  }, [activeWellId, radiusKm, depthWindowM])

  const load = useCallback(async (filters: Filters) => {
    setLoading(true); setError(null)
    try {
      const q = filters.q.trim()
      let result: WellEvent[]
      if (q.length >= 2) {
        result = await api<WellEvent[]>(`/knowledge/search${queryString({ q, formation: filters.formation, event_type: filters.eventType, depth_min: filters.depthMin, depth_max: filters.depthMax, limit: 200 })}`)
      } else {
        if (q.length === 1) throw new Error('Enter at least two characters to search historical text.')
        result = await api<WellEvent[]>(`/events${queryString({ formation: filters.formation, event_type: filters.eventType, well_id: filters.wellId, depth_min: filters.depthMin, depth_max: filters.depthMax, limit: 500 })}`)
      }
      result = result.filter((event) => (!filters.wellId || event.well_id === filters.wellId)
        && (!filters.dateFrom || (event.event_date ?? '') >= filters.dateFrom)
        && (!filters.dateTo || (event.event_date ?? '').slice(0, 10) <= filters.dateTo))
      setEvents(result)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to search the knowledge repository.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(applied) }, [load, applied])

  const eventTypes = useMemo(() => Array.from(new Set(events.map((event) => event.event_type))).sort(), [events])
  const matchByEventId = useMemo(() => new Map((correlation?.historical_events ?? []).map((match) => [match.event_id, match])), [correlation])
  const visibleEvents = events.filter((event) => {
    if (!applied.relevance) return true
    const match = matchByEventId.get(event.id)
    return applied.relevance === 'unmatched' ? !match : match?.relevance_band === applied.relevance
  })
  const apply = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setApplied({ ...form }) }
  const reset = () => { setForm(EMPTY_FILTERS); setApplied(EMPTY_FILTERS) }

  return <div className="page-stack knowledge-page">
    <PageHeading title="Historical Event Explorer" subtitle="" action={<span className="knowledge-count"><BookOpen size={14} />{visibleEvents.length} records</span>} />
    <section className="panel knowledge-search-panel"><form onSubmit={apply}>
      <div className="knowledge-search-main"><div className="search-input-wrap"><Search size={18} /><input aria-label="Search historical drilling knowledge" value={form.q} onChange={(event) => setForm({ ...form, q: event.target.value })} placeholder="Event, well, depth or formation" /><span>⌘ K</span></div><button className="primary-button" type="submit"><Search size={15} />Search</button></div>
      <details className="knowledge-filter-details"><summary><SlidersHorizontal size={15} /> Filters <span>Advanced</span></summary>
      <div className="filter-section-title">FILTER RECORDS <button className="reset-filters" type="button" onClick={reset}>Reset</button></div>
      <div className="knowledge-filters">
        <label>EVENT TYPE<select value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value })}><option value="">All event types</option>{eventTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}</select></label>
        <label>FORMATION<select value={form.formation} onChange={(event) => setForm({ ...form, formation: event.target.value })}><option value="">All formations</option>{formations.map((formation) => <option key={formation.id} value={formation.name}>{formation.name}</option>)}</select></label>
        <label>SOURCE WELL<select value={form.wellId} onChange={(event) => setForm({ ...form, wellId: event.target.value })}><option value="">All wells</option>{wells.map((well) => <option key={well.id} value={well.id}>{well.well_name} · {well.role === 'active' ? 'Active' : 'Offset'}</option>)}</select></label>
        <label>DEPTH FROM<input type="number" min="0" step="1" placeholder="e.g. 2,800 m" value={form.depthMin} onChange={(event) => setForm({ ...form, depthMin: event.target.value })} /></label>
        <label>DEPTH TO<input type="number" min="0" step="1" placeholder="e.g. 3,000 m" value={form.depthMax} onChange={(event) => setForm({ ...form, depthMax: event.target.value })} /></label>
        <label>RELEVANCE<select value={form.relevance} onChange={(event) => setForm({ ...form, relevance: event.target.value })}><option value="">All records</option><option value="high">High · current well</option><option value="medium">Medium · current well</option><option value="low">Low · current well</option><option value="unmatched">Outside current correlation</option></select></label>
        <label>DATE FROM<input type="date" value={form.dateFrom} onChange={(event) => setForm({ ...form, dateFrom: event.target.value })} /></label>
        <label>DATE TO<input type="date" value={form.dateTo} onChange={(event) => setForm({ ...form, dateTo: event.target.value })} /></label>
      </div>
      </details>
    </form></section>

    {!loading && !error && <EventDistribution events={visibleEvents} />}

    <section className="panel knowledge-results"><div className="panel-heading"><div><div className="eyebrow">SOURCE-LINKED REPOSITORY</div><h2>Historical event records</h2></div><span className="record-count">{loading ? '—' : visibleEvents.length} RESULTS</span></div>
      {loading ? <Loading label="Searching source-linked drilling records" /> : error ? <ErrorState message={error} retry={() => void load(applied)} /> : visibleEvents.length === 0 ? <EmptyState title="No matching historical records" detail="Try a broader term, clear a filter, or adjust the depth range. Search results only include structured event records with source evidence." /> : <div className="event-table-scroll"><table className="event-explorer-table"><thead><tr><th scope="col">WELL</th><th scope="col">EVENT</th><th scope="col">DEPTH</th><th scope="col">FORMATION</th><th scope="col">RELEVANCE</th></tr></thead><tbody>{visibleEvents.map((event) => {
        const match = matchByEventId.get(event.id)
        return <tr key={event.id} tabIndex={0} onClick={() => setSelectedEvent(event)} onKeyDown={(key) => { if (key.key === 'Enter' || key.key === ' ') { key.preventDefault(); setSelectedEvent(event) } }} aria-label={`Open ${event.event_title} evidence from ${event.well_name}`}>
          <td><strong>{event.well_name}</strong><small>{formatDate(event.event_date)}</small></td>
          <td><button type="button" className="event-row-title" tabIndex={-1} onClick={(click) => { click.stopPropagation(); setSelectedEvent(event) }}>{humanize(event.event_type)}</button><small>{event.event_title}</small></td>
          <td>{formatDepth(event.measured_depth)}</td>
          <td>{event.formation?.name ?? 'Not recorded'}</td>
          <td>{match ? <span className={`event-relevance ${match.relevance_band}`}><strong>{Math.round(match.relevance_score)}</strong> {humanize(match.relevance_band)}</span> : <span className="event-relevance unmatched">— <small>Outside current correlation</small></span>}</td>
        </tr>
      })}</tbody></table></div>}
      <div className="event-explorer-note">Relevance uses the active well, radius and depth window. A dash means the event is outside the current correlation result.</div>
    </section>
    {selectedEvent && <EvidenceDrawer event={selectedEvent} match={matchByEventId.get(selectedEvent.id) as OffsetMatch | undefined} relatedMatches={correlation?.historical_events} onClose={() => setSelectedEvent(null)} />}
  </div>
}

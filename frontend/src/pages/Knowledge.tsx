import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { BookOpen, CalendarDays, ExternalLink, Search, SlidersHorizontal } from 'lucide-react'
import { api, queryString, type Formation, type WellEvent } from '../lib/api'
import { useApp } from '../lib/AppContext'
import { formatDate, formatDepth, humanize } from '../lib/format'
import { EmptyState, ErrorState, Loading } from '../components/Feedback'
import { PageHeading } from './Dashboard'
import { SourceReference } from '../components/SourceReference'
import { useSearchParams } from 'react-router-dom'

type Filters = { q: string; eventType: string; formation: string; wellId: string; depthMin: string; depthMax: string; dateFrom: string; dateTo: string }
const EMPTY_FILTERS: Filters = { q: '', eventType: '', formation: '', wellId: '', depthMin: '', depthMax: '', dateFrom: '', dateTo: '' }

export function KnowledgePage() {
  const { wells } = useApp()
  const [searchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''
  const initialFilters = { ...EMPTY_FILTERS, q: initialQuery }
  const [form, setForm] = useState<Filters>(initialFilters)
  const [applied, setApplied] = useState<Filters>(initialFilters)
  const [events, setEvents] = useState<WellEvent[]>([])
  const [formations, setFormations] = useState<Formation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadFormations = useCallback(async () => {
    try { setFormations(await api<Formation[]>('/formations')) } catch { /* Search remains usable with API records. */ }
  }, [])
  useEffect(() => { void loadFormations() }, [loadFormations])

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
      const selectedWell = filters.wellId
      result = result.filter((event) => (!selectedWell || event.well_id === selectedWell)
        && (!filters.dateFrom || (event.event_date ?? '') >= filters.dateFrom)
        && (!filters.dateTo || (event.event_date ?? '').slice(0, 10) <= filters.dateTo))
      setEvents(result)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to search the knowledge repository.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(applied) }, [load, applied])

  const eventTypes = useMemo(() => Array.from(new Set(events.map((event) => event.event_type))).sort(), [events])
  const apply = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setApplied({ ...form }) }
  const reset = () => { setForm(EMPTY_FILTERS); setApplied(EMPTY_FILTERS) }
  const searchPreset = (term: string) => {
    const next = { ...form, q: term }
    setForm(next)
    setApplied(next)
  }

  return <div className="page-stack">
    <PageHeading title="Search drilling knowledge" subtitle="" action={<span className="knowledge-count"><BookOpen size={14} />{events.length} records</span>} />
    <section className="panel knowledge-search-panel"><form onSubmit={apply}>
      <div className="knowledge-search-main"><div className="search-input-wrap"><Search size={18} /><input aria-label="Search historical drilling knowledge" value={form.q} onChange={(event) => setForm({ ...form, q: event.target.value })} placeholder="Event, well, depth or formation" /><span>⌘ K</span></div><button className="primary-button" type="submit"><Search size={15} />Search</button></div>
      <div className="knowledge-search-presets" aria-label="Suggested searches">{['Lost Circulation', 'Stuck Pipe', 'Cementing', 'X Formation'].map((term) => <button type="button" key={term} onClick={() => searchPreset(term)}>{term}</button>)}</div>
      <details className="knowledge-filter-details"><summary><SlidersHorizontal size={15} /> Filters <span>Advanced</span></summary>
      <div className="filter-section-title">FILTER RECORDS <button className="reset-filters" type="button" onClick={reset}>Reset</button></div>
      <div className="knowledge-filters">
        <label>EVENT TYPE<select value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value })}><option value="">All event types</option>{eventTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}</select></label>
        <label>FORMATION<select value={form.formation} onChange={(event) => setForm({ ...form, formation: event.target.value })}><option value="">All formations</option>{formations.map((formation) => <option key={formation.id} value={formation.name}>{formation.name}</option>)}</select></label>
        <label>SOURCE WELL<select value={form.wellId} onChange={(event) => setForm({ ...form, wellId: event.target.value })}><option value="">All wells</option>{wells.map((well) => <option key={well.id} value={well.id}>{well.well_name} · {well.role === 'active' ? 'Active' : 'Offset'}</option>)}</select></label>
        <label>DEPTH FROM<input type="number" min="0" step="1" placeholder="e.g. 2,800 m" value={form.depthMin} onChange={(event) => setForm({ ...form, depthMin: event.target.value })} /></label>
        <label>DEPTH TO<input type="number" min="0" step="1" placeholder="e.g. 3,000 m" value={form.depthMax} onChange={(event) => setForm({ ...form, depthMax: event.target.value })} /></label>
        <label>DATE FROM<input type="date" value={form.dateFrom} onChange={(event) => setForm({ ...form, dateFrom: event.target.value })} /></label>
        <label>DATE TO<input type="date" value={form.dateTo} onChange={(event) => setForm({ ...form, dateTo: event.target.value })} /></label>
      </div>
      </details>
    </form></section>
    <section className="panel knowledge-results"><div className="panel-heading"><div><div className="eyebrow">SOURCE-LINKED REPOSITORY</div><h2>Drilling event records</h2></div><span className="record-count">{loading ? '—' : events.length} RESULTS</span></div>
      {loading ? <Loading label="Searching source-linked drilling records" /> : error ? <ErrorState message={error} retry={() => void load(applied)} /> : events.length === 0 ? <EmptyState title="No matching historical records" detail="Try a broader term, clear a filter, or adjust the depth range. Search results only include structured event records with source evidence." /> : <div className="knowledge-result-list">{events.map((event) => {
        const evidence = event.evidence.find((record) => record.excerpt) ?? event.evidence[0]
        const isSeed = event.source_document.origin === 'seeded_demo'
        return <article key={event.id} className="knowledge-result"><div className="result-main"><div className="knowledge-event-head"><h3>{humanize(event.event_type)}</h3><span className="result-date"><CalendarDays size={12} />{formatDate(event.event_date)}</span></div>
          <div className="knowledge-result-facts"><span><small>WELL</small><strong>{event.well_name}</strong></span><span><small>DEPTH</small><strong>{formatDepth(event.measured_depth)}</strong></span></div>
          <div className="knowledge-mitigation knowledge-mitigation-compact"><strong>MITIGATION</strong><p>{event.mitigation ?? 'Not recorded'}</p></div>
          <div className="knowledge-source-line"><span>SOURCE</span><SourceReference documentId={event.source_document.id} eventId={event.id} page={evidence?.page_number ?? event.source_page} className="knowledge-source-link"><strong>{event.source_document.filename}</strong></SourceReference><small>{isSeed ? 'Seeded' : 'Uploaded'} · p.{evidence?.page_number ?? event.source_page ?? '—'}</small><SourceReference documentId={event.source_document.id} eventId={event.id} page={evidence?.page_number ?? event.source_page} className="knowledge-view-evidence"><ExternalLink size={12} /> View source</SourceReference></div>
          <details className="knowledge-result-details"><summary>Event and evidence details</summary>
            <p><strong>{event.event_title}</strong> · {event.description}</p>
            {event.consequence && <div className="knowledge-consequence"><strong>Recorded consequence</strong><p>{event.consequence}</p></div>}
            {evidence && <blockquote className="result-excerpt">“{evidence.excerpt}”</blockquote>}
            <div className="result-tags"><span>{event.formation?.name ?? 'Formation unknown'}</span><span className={`severity-tag ${event.severity_label}`}>{humanize(event.severity_label)} severity</span><span>{Math.round((evidence?.confidence ?? event.confidence) * 100)}% extraction confidence</span></div>
          </details>
        </div></article>
      })}</div>}
    </section>
  </div>
}

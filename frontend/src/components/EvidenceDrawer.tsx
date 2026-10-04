import { useEffect, useState, type FormEvent } from 'react'
import { Check, ClipboardCheck, ExternalLink, FileText, MessageSquareText, X } from 'lucide-react'
import { api, type Alert, type AlertNote, type AlertStatus, type Evidence, type OffsetMatch, type WellEvent } from '../lib/api'
import { formatDate, formatDepth, formatDistance, humanize } from '../lib/format'
import { ErrorState, Loading } from './Feedback'
import { SourceReference } from './SourceReference'

type AlertDetail = Alert & { historical_event?: WellEvent; notes?: AlertNote[] }
type Props = { match?: OffsetMatch | null; alert?: Alert | null; relatedMatches?: OffsetMatch[]; onClose: () => void; onUpdated?: () => void }

export function EvidenceDrawer({ match, alert, relatedMatches = [], onClose, onUpdated }: Props) {
  const [detail, setDetail] = useState<AlertDetail | null>(alert as AlertDetail | null)
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const eventId = detail?.historical_event_id ?? match?.event_id
  const alertId = alert?.id
  useEffect(() => {
    let live = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const results = await Promise.all([
          alertId ? api<AlertDetail>(`/alerts/${alertId}`) : Promise.resolve(null),
          eventId ? api<Evidence[]>(`/events/${eventId}/evidence`) : Promise.resolve([]),
        ])
        if (!live) return
        if (results[0]) setDetail(results[0])
        setEvidence(results[1])
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : 'Unable to load source evidence.')
      } finally { if (live) setLoading(false) }
    }
    void load()
    return () => { live = false }
  }, [alertId, eventId])

  const event = detail?.historical_event
  const title = event?.event_title ?? match?.event_title ?? 'Historical event'
  const sourceWell = event?.well_name ?? match?.offset_well.well_name ?? 'Offset well'
  const depth = event?.measured_depth ?? match?.historical_depth_m
  const formation = event?.formation?.name ?? match?.formation?.name
  const activeDepth = match?.active_depth_m ?? detail?.active_well?.current_depth
  const distance = alert?.distance_km ?? match?.distance_km
  const score = alert?.relevance_score ?? match?.relevance_score
  const document = event?.source_document ?? match?.source_document
  const sourcePage = event?.source_page ?? match?.source_page
  const sourceEvidence = evidence.find((item) => item.excerpt && item.document_id === document?.id && (sourcePage == null || item.page_number === sourcePage))
    ?? evidence.find((item) => item.excerpt && item.document_id === document?.id)
    ?? evidence.find((item) => item.excerpt)
  const excerpt = sourceEvidence?.excerpt ?? match?.evidence_excerpt
  const resolvedPage = sourcePage ?? sourceEvidence?.page_number
  const mitigation = event?.mitigation ?? match?.mitigation
  const status = detail?.status ?? alert?.status
  const depthDifference = match?.depth_difference_m ?? alert?.depth_difference_m
  const formationMatch = match?.formation_match ?? (alert?.formation_match ? 'matched' : 'unknown')
  const sameTypeWells = new Set(relatedMatches
    .filter((item) => item.event_id !== match?.event_id && item.event_type === (event?.event_type ?? match?.event_type) && item.offset_well.id !== (event?.well_id ?? match?.offset_well.id))
    .map((item) => item.offset_well.id))

  const sourceHrefEventId = event?.id ?? match?.event_id ?? alert?.historical_event_id

  const transition = async (next: AlertStatus, acknowledge = false) => {
    if (!detail) return
    setBusy(true)
    setActionError(null)
    try {
      const updated = await api<AlertDetail>(acknowledge ? `/alerts/${detail.id}/acknowledge` : `/alerts/${detail.id}`, {
        method: acknowledge ? 'POST' : 'PATCH',
        headers: acknowledge ? undefined : { 'Content-Type': 'application/json' },
        body: acknowledge ? undefined : JSON.stringify({ status: next }),
      })
      setDetail(updated)
      onUpdated?.()
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'Unable to update alert.') }
    finally { setBusy(false) }
  }

  const submitNote = async (eventForm: FormEvent<HTMLFormElement>) => {
    eventForm.preventDefault()
    if (!detail || !note.trim()) return
    setBusy(true)
    setActionError(null)
    try {
      const created = await api<AlertNote>(`/alerts/${detail.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.trim(), author: 'Operations team' }),
      })
      setDetail({ ...detail, notes: [...(detail.notes ?? []), created] })
      setNote('')
      onUpdated?.()
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'Unable to save note.') }
    finally { setBusy(false) }
  }

  return <div className="drawer-overlay" role="presentation" onMouseDown={(eventDown) => { if (eventDown.target === eventDown.currentTarget) onClose() }}>
    <aside className="evidence-drawer" role="dialog" aria-modal="true" aria-label="Historical event evidence">
      <div className="drawer-header"><div><div className="eyebrow">SOURCE EVIDENCE</div><h2>Historical precedent</h2></div><button className="icon-button" onClick={onClose} aria-label="Close evidence drawer"><X size={18} /></button></div>
      {loading ? <Loading label="Loading source record" /> : error ? <ErrorState message={error} /> : <>
        <div className="drawer-event-head"><span className={`event-type-icon ${match?.relevance_band ?? 'medium'}`}><FileText size={17} /></span><div><span className="event-type-label">{humanize(event?.event_type ?? match?.event_type)}</span><h3>{title}</h3><p>Source well {sourceWell} <span>·</span> {formatDate(event?.event_date)}</p></div></div>
        {document?.origin === 'seeded_demo' && <div className="synthetic-badge"><span />SYNTHETIC DEMO DATA · REPRESENTATIVE SOURCE RECORD</div>}
        <div className="drawer-metrics drawer-core-facts"><div><span>ACTIVE DEPTH</span><strong>{formatDepth(activeDepth)}</strong></div><div><span>HISTORICAL DEPTH</span><strong>{formatDepth(depth)}</strong></div><div><span>DEPTH DIFFERENCE</span><strong>{depthDifference == null ? '—' : `${depthDifference > 0 ? '+' : ''}${Math.round(depthDifference)} m`}</strong></div><div><span>FORMATION</span><strong>{formation ?? '—'}</strong></div></div>
        <div className="drawer-section"><div className="drawer-section-title">Evidence <span className="verified-label"><Check size={12} /> Source linked</span></div>
          {excerpt ? <blockquote className="evidence-quote">“{excerpt}”</blockquote> : <p className="muted-copy">No evidence excerpt is attached to this record.</p>}
        </div>
        <div className="drawer-source-card"><div className="source-doc-icon"><FileText size={17} /></div><div className="source-doc-meta"><SourceReference documentId={document?.id} eventId={sourceHrefEventId} page={resolvedPage} className="source-doc-link" ariaLabel={`Open stored document record ${document?.filename ?? ''}`}><strong>{document?.filename ?? 'Source document unavailable'}</strong><ExternalLink size={12} /></SourceReference><span>{document?.source_label ?? (document?.origin === 'seeded_demo' ? 'Seeded Demo Evidence' : 'Uploaded Document')}</span></div><SourceReference documentId={document?.id} eventId={sourceHrefEventId} page={resolvedPage} className="source-page source-page-link" ariaLabel={`Open stored evidence at source page ${resolvedPage ?? 'unavailable'}`}>PAGE <strong>{resolvedPage ?? '—'}</strong></SourceReference></div>
        <div className="drawer-section"><div className="drawer-section-title">Recorded mitigation</div><p className="mitigation-copy">{mitigation ?? 'No mitigation was recorded in the source event.'}</p></div>
        <details className="evidence-technical-details"><summary>Match, source and confidence details</summary>
        <div className="drawer-metrics"><div><span>DISTANCE</span><strong>{formatDistance(distance)}</strong></div><div><span>RELEVANCE</span><strong>{score != null ? `${Math.round(score)} / 100` : '—'}</strong></div></div>
        <div className="drawer-section"><div className="drawer-section-title">Why this signal?</div><ul className="relevance-reasons">
          <li>{formationMatch === 'exact' ? `Same normalized formation${formation ? `: ${formation}` : ''}.` : formationMatch === 'alias' ? `Formation matched through an alias${formation ? `: ${formation}` : ''}.` : formationMatch === 'matched' ? 'The alert records a formation match; exact versus alias detail is not included in the alert summary.' : formationMatch === 'mismatch' ? `Historical formation differs${formation ? `: ${formation}` : ''}.` : 'Formation match is unknown from the stored event.'}</li>
          <li>{depthDifference == null ? 'Depth difference is not recorded.' : `${Math.abs(Math.round(depthDifference))} m ${depthDifference > 0 ? 'ahead of' : depthDifference < 0 ? 'behind' : 'at'} the active depth${activeDepth != null ? ` (${formatDepth(activeDepth)} active MD)` : ''}.`}</li>
          <li>{sourceWell} is {formatDistance(distance)} from the active well.</li>
          {sameTypeWells.size > 0 && <li>The same event type is also recorded in {sameTypeWells.size} additional matched offset well{sameTypeWells.size === 1 ? '' : 's'}.</li>}
          {match?.explanation && <li className="backend-explanation">{match.explanation}</li>}
        </ul></div>
        <div className="document-metadata-grid"><div><span>DOCUMENT TYPE</span><strong>{humanize(document?.document_type)}</strong></div><div><span>ORIGIN</span><strong>{document?.origin === 'seeded_demo' ? 'Synthetic demo record' : 'Uploaded document'}</strong></div><div><span>RECORDED SOURCE</span><strong>{document?.source ?? 'Not recorded'}</strong></div><div><span>DOCUMENT PAGES</span><strong>{document?.page_count ?? '—'}</strong></div><div><span>UPLOADED / SEEDED</span><strong>{formatDate(document?.uploaded_at)}</strong></div><div><span>EXTRACTION METHOD</span><strong>{humanize(sourceEvidence?.extraction_method ?? 'Not available')}</strong></div></div>
        <div className="confidence-strip"><div><span>EXTRACTION CONFIDENCE</span><strong>{sourceEvidence ? `${Math.round(sourceEvidence.confidence * 100)}%` : 'Not available'}</strong></div><div><span>EVENT CONFIDENCE</span><strong>{event ? `${Math.round(event.confidence * 100)}%` : 'Not included in this result'}</strong></div><div><span>COMBINED SOURCE CONFIDENCE</span><strong>{match ? `${Math.round(match.source_confidence * 100)}%` : 'See linked source record'}</strong></div></div>
        {document?.origin === 'seeded_demo' ? <p className="source-limit-note">This seeded source has representative document metadata and stored evidence excerpts. No original PDF binary was supplied for this demo record.</p> : <p className="source-limit-note">The page link opens this stored source record and excerpt. The current prototype does not provide an in-browser original-file viewer.</p>}
        {(event?.consequence ?? match?.consequence) && <div className="drawer-section"><div className="drawer-section-title">Recorded consequence</div><p className="muted-copy">{event?.consequence ?? match?.consequence}</p></div>}
        </details>
        {alert && <div className="alert-review-section"><div className="drawer-section-title">Alert review <span className={`status-pill ${status}`}>{humanize(status)}</span></div>
          {(status === 'acknowledged' || status === 'reviewed') && <p className="acknowledged-reassurance">This signal is based on historical evidence and supports engineer review.</p>}
          <div className="review-actions">
            {status === 'open' && <button className="secondary-button" disabled={busy} onClick={() => void transition('acknowledged', true)}><Check size={14} /> Acknowledge</button>}
            {(status === 'open' || status === 'acknowledged') && <button className="primary-button" disabled={busy} onClick={() => void transition('reviewed')}><ClipboardCheck size={14} /> Mark reviewed</button>}
            {status !== 'dismissed' && status !== 'reviewed' && <button className="quiet-button" disabled={busy} onClick={() => void transition('dismissed')}>Dismiss</button>}
          </div>
          <form className="note-form" onSubmit={(eventForm) => void submitNote(eventForm)}><label htmlFor="engineer-note">Engineer note</label><textarea id="engineer-note" value={note} onChange={(eventChange) => setNote(eventChange.target.value)} placeholder="Record review context or follow-up…" rows={3} maxLength={4000} /><button className="secondary-button" disabled={busy || !note.trim()} type="submit"><MessageSquareText size={14} /> Add note</button></form>
          {detail?.notes?.map((entry) => <div className="saved-note" key={entry.id}><p>{entry.note}</p><span>{entry.author ?? 'Operations'} · {formatDate(entry.created_at)}</span></div>)}
          {actionError && <div className="inline-error">{actionError}</div>}
        </div>}
        <div className="drawer-origin"><ExternalLink size={13} />{document?.origin === 'seeded_demo' ? 'Seeded Demo Evidence' : 'Uploaded Document'} · Document and page are preserved from the event record.</div>
      </>}
    </aside>
  </div>
}

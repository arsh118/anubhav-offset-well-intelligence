import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, CircleAlert, ExternalLink, FileText, FileUp, RefreshCw, ScanText, UploadCloud } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api, type Document, type DocumentProcess, type Well, type WellEvent } from '../lib/api'
import { useApp } from '../lib/AppContext'
import { formatDate, formatDepth, humanize } from '../lib/format'
import { EmptyState, ErrorState, Loading } from '../components/Feedback'
import { PageHeading } from './Dashboard'
import { SourceReference } from '../components/SourceReference'

export function DocumentsPage() {
  const { wells, activeWell, refreshWells } = useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [documents, setDocuments] = useState<Document[]>([])
  const [selected, setSelected] = useState<Document | null>(null)
  const [events, setEvents] = useState<WellEvent[]>([])
  const [wellId, setWellId] = useState(activeWell?.id ?? '')
  const [documentType, setDocumentType] = useState('daily_drilling_report')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const requestedDocumentId = searchParams.get('documentId')
  const requestedEventId = searchParams.get('eventId')
  const requestedPage = Number(searchParams.get('page')) || null

  useEffect(() => { if (!wellId && activeWell) setWellId(activeWell.id) }, [activeWell, wellId])
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setDocuments(await api<Document[]>('/documents?limit=500')) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load document records.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const selectDocument = useCallback(async (document: Document) => {
    setSelected(document); setEvents([]); setError(null)
    try {
      const [latest, extracted] = await Promise.all([api<Document>(`/documents/${document.id}`), api<WellEvent[]>(`/documents/${document.id}/events`)] )
      setSelected(latest); setEvents(extracted)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load extracted event records.') }
  }, [])

  useEffect(() => {
    if (!requestedDocumentId || selected?.id === requestedDocumentId) return
    const sourceDocument = documents.find((document) => document.id === requestedDocumentId)
    if (sourceDocument) void selectDocument(sourceDocument)
  }, [documents, requestedDocumentId, selected?.id, selectDocument])

  useEffect(() => {
    if (!requestedEventId || !selected || events.length === 0) return
    document.getElementById(`source-event-${requestedEventId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [events, requestedEventId, selected])

  const manuallySelectDocument = (document: Document) => {
    if (requestedDocumentId) setSearchParams({}, { replace: true })
    void selectDocument(document)
  }

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!file || !wellId) return
    setUploading(true); setError(null); setSuccess(null)
    const formData = new FormData()
    formData.append('well_id', wellId)
    formData.append('document_type', documentType)
    formData.append('file', file)
    try {
      const created = await api<Document>('/documents/ingest', { method: 'POST', body: formData })
      setSelected(created); setEvents([]); setFile(null)
      setSuccess(`${created.filename} received. Start processing to extract source-linked events.`)
      await load()
      await refreshWells()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Document upload failed.') }
    finally { setUploading(false) }
  }

  const process = async () => {
    if (!selected) return
    setProcessing(true); setError(null); setSuccess(null)
    try {
      const result = await api<DocumentProcess>(`/documents/${selected.id}/process`, { method: 'POST' })
      setSelected(result.document); setEvents(result.events)
      setSuccess(`${result.message} · ${result.extracted_pages} page${result.extracted_pages === 1 ? '' : 's'} inspected, ${result.events.length} event${result.events.length === 1 ? '' : 's'} structured.`)
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Document processing failed.') }
    finally { setProcessing(false) }
  }

  const seeded = documents.filter((document) => document.origin === 'seeded_demo').length
  const uploaded = documents.filter((document) => document.origin === 'uploaded_document').length

  return <div className="page-stack">
    <PageHeading title="Documents & evidence" subtitle="Inspect seeded demo sources or ingest a representative PDF/text document for rule-based extraction." action={<span className="document-count"><FileText size={14} />{documents.length} sources</span>} />
    {error && <ErrorState message={error} retry={() => void load()} />}
    {success && <div className="success-banner"><CheckCircle2 size={16} /><span>{success}</span><button onClick={() => setSuccess(null)} aria-label="Dismiss notification">×</button></div>}
    <div className="document-overview-grid"><div className="document-stat"><span className="document-stat-icon seeded"><FileText size={16} /></span><span>SEEDED DEMO EVIDENCE</span><strong>{seeded}</strong><small>Representative synthetic source records</small></div><div className="document-stat"><span className="document-stat-icon uploaded"><FileUp size={16} /></span><span>UPLOADED DOCUMENTS</span><strong>{uploaded}</strong><small>Files ingested through this interface</small></div><div className="document-stat"><span className="document-stat-icon processed"><ScanText size={16} /></span><span>PROCESSED</span><strong>{documents.filter((document) => document.processing_status === 'processed').length}</strong><small>Text extraction and deterministic rules</small></div></div>
    <div className="documents-layout">
      <section className="panel document-upload-panel"><div className="panel-heading"><div><div className="eyebrow">INGEST DOCUMENT</div><h2>Upload source file</h2></div><UploadCloud size={18} className="panel-heading-icon" /></div>
        <p className="upload-intro">Ingest a PDF or text drilling report.</p>
        <form className="upload-form" onSubmit={(event) => void upload(event)}>
          <label>WELL<select value={wellId} onChange={(event) => setWellId(event.target.value)} required><option value="">Select source well</option>{wells.map((well: Well) => <option key={well.id} value={well.id}>{well.well_name} · {well.role}</option>)}</select></label>
          <label>DOCUMENT TYPE<select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="daily_drilling_report">Daily drilling report</option><option value="final_well_report">Final well report</option><option value="incident_report">Incident report</option><option value="other">Other</option></select></label>
          <label className={`file-drop ${file ? 'has-file' : ''}`}><input type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="file-drop-icon">{file ? <CheckCircle2 size={22} /> : <UploadCloud size={22} />}</span><strong>{file?.name ?? 'Choose a PDF or text report'}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · Ready to ingest` : 'PDF or TXT · 20 MB maximum'}</small><span className="browse-files">Browse files</span></label>
          <button className="primary-button upload-submit" type="submit" disabled={!file || !wellId || uploading}>{uploading ? <RefreshCw className="spin" size={15} /> : <FileUp size={15} />}{uploading ? 'Uploading…' : 'Upload document'}</button>
        </form>
        <div className="upload-disclaimer"><CircleAlert size={14} /><span>Prototype extraction · representative demo data · no confidential OIL connection.</span></div>
      </section>

      <section className="panel document-list-panel"><div className="panel-heading"><div><div className="eyebrow">SOURCE LIBRARY</div><h2>Available documents</h2></div><button className="icon-button" onClick={() => void load()} aria-label="Refresh documents"><RefreshCw size={15} /></button></div>
        {loading ? <Loading label="Loading source documents" /> : documents.length === 0 ? <EmptyState title="No documents found" detail="Documents will appear here after upload or database seeding." /> : <div className="document-list">{documents.map((document) => <button key={document.id} className={`document-row ${selected?.id === document.id ? 'selected' : ''}`} onClick={() => manuallySelectDocument(document)}><span className={`document-file-icon ${document.origin}`}><FileText size={16} /></span><span className="document-row-main"><strong>{document.filename}</strong><small>{document.source_label} · {document.page_count ?? '—'} pages</small></span><span className={`processing-status ${document.processing_status}`}>{humanize(document.processing_status)}</span></button>)}</div>}
        {selected && <div className="selected-document"><div className="selected-document-heading"><div><div className="eyebrow">SELECTED SOURCE · {selected.source_label}</div><h3>{selected.filename}</h3></div>{selected.origin === 'uploaded_document' && selected.processing_status !== 'processing' && <button className="secondary-button" disabled={processing} onClick={() => void process()}>{processing ? <RefreshCw size={14} className="spin" /> : <ScanText size={14} />}{processing ? 'Processing…' : selected.processing_status === 'processed' ? 'Reprocess' : 'Process document'}</button>}</div>
          <details className="selected-document-metadata"><summary>Document metadata</summary><div className="selected-document-meta"><span>TYPE <strong>{humanize(selected.document_type)}</strong></span><span>STATUS <strong>{humanize(selected.processing_status)}</strong></span><span>PAGES <strong>{selected.page_count ?? '—'}</strong></span><span>RECEIVED <strong>{formatDate(selected.uploaded_at)}</strong></span></div></details>
          {requestedDocumentId === selected.id && requestedEventId && <div className="source-jump-notice"><ExternalLink size={14} /><span>Opened the linked source record at page {requestedPage ?? '—'}. The page excerpt below is stored evidence from this document.</span></div>}
          {selected.origin === 'seeded_demo' && <div className="source-limit-note">Representative synthetic document metadata and page evidence are available for this source. No original PDF binary was supplied.</div>}
          {events.length === 0 ? <EmptyState title={selected.processing_status === 'processed' ? 'No structured events found' : 'No extracted events yet'} detail={selected.origin === 'seeded_demo' ? 'This seeded source document provides representative event evidence linked to the historical event repository.' : 'Process this uploaded document to extract events, depth, formation, and page evidence.'} /> : <div className="extracted-events"><div className="extracted-events-title">EXTRACTED EVENTS <span>{events.length}</span></div>{events.map((event) => {
            const evidence = event.evidence.find((item) => item.page_number === requestedPage && item.excerpt) ?? event.evidence.find((item) => item.excerpt) ?? event.evidence[0]
            const eventPage = event.source_page ?? evidence?.page_number
            return <article id={`source-event-${event.id}`} key={event.id} className={`extracted-event ${requestedEventId === event.id ? 'source-event-focused' : ''}`}><div className="extracted-event-top"><strong>{event.event_title}</strong><span>{formatDepth(event.measured_depth)} · {event.formation?.name ?? 'Formation unknown'}</span></div><details><summary>Event details and source excerpt</summary><p>{event.description}</p>{event.mitigation && <p><strong>Recorded mitigation:</strong> {event.mitigation}</p>}{evidence?.excerpt && <blockquote>{evidence.excerpt}</blockquote>}<small><FileText size={12} /> {selected.source_label} · {eventPage != null ? <SourceReference documentId={selected.id} eventId={event.id} page={eventPage} className="extracted-page-link">Page {eventPage}</SourceReference> : 'Page unavailable'} · {humanize(evidence?.extraction_method ?? 'unknown')} · {evidence ? `${Math.round(evidence.confidence * 100)}% extraction confidence` : 'Confidence unavailable'}</small></details></article>
          })}</div>}
        </div>}
      </section>
    </div>
  </div>
}

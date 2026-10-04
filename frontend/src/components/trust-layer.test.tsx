import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Document, Evidence, OffsetMatch, Well } from '../lib/api'
import { api } from '../lib/api'
import { EvidenceDrawer } from './EvidenceDrawer'
import { MethodologyDrawer } from './MethodologyDrawer'
import { AppProvider } from '../lib/AppContext'
import { AppShell } from './AppShell'

const sourceDocument: Document = {
  id: 'doc-01',
  well_id: 'well-02',
  filename: 'DDR-ANB-02-2024-07.pdf',
  document_type: 'daily_drilling_report',
  source: 'Representative Synthetic Demo Data',
  origin: 'seeded_demo',
  source_label: 'Seeded Demo Evidence',
  uploaded_at: '2024-07-14T08:15:00Z',
  processing_status: 'processed',
  page_count: 34,
}

const match: OffsetMatch = {
  event_id: 'event-01',
  offset_well: { id: 'well-02', well_name: 'ANB-02', field: 'Upper-Assam-Demo', latitude: 26.0, longitude: 93.0 },
  distance_km: 4.2,
  historical_depth_m: 2865,
  active_depth_m: 2842,
  depth_difference_m: 23,
  absolute_depth_difference_m: 23,
  depth_band: 'high',
  formation: { id: 'formation-x', name: 'X Formation', normalized_name: 'x formation', aliases: ['X Sand'] },
  formation_match: 'exact',
  event_type: 'lost_circulation',
  event_title: 'Partial lost circulation in X Formation',
  description: 'Partial returns recorded in X Formation.',
  consequence: 'Reduced returns were recorded.',
  mitigation: 'Adjusted mud program and monitored losses.',
  relevance_score: 91,
  relevance_score_normalized: 0.91,
  relevance_band: 'high',
  components: {
    formation: { score: 1, weight: 0.3 },
    depth_proximity: { score: 1, weight: 0.25 },
    spatial_proximity: { score: 0.8, weight: 0.2 },
    event_similarity: { score: 1, weight: 0.15 },
    source_confidence: { score: 0.95, weight: 0.1 },
  },
  source_document: sourceDocument,
  source_page: 18,
  evidence_excerpt: 'Correlation response fallback excerpt must not replace stored evidence.',
  source_confidence: 0.95,
  existing_alert: null,
  explanation: 'High historical relevance because the event occurred 23 m ahead of the active depth, in the same formation, and was recorded 4.2 km away.',
}

const sourceEvidence: Evidence = {
  id: 'evidence-01',
  event_id: 'event-01',
  document_id: 'doc-01',
  page_number: 18,
  excerpt: 'Losses were observed while drilling through X Formation at 2865 m. Adjusted mud program and monitored losses.',
  extraction_method: 'synthetic_demo',
  confidence: 0.93,
  document: sourceDocument,
}

const activeWell: Well = {
  id: 'active-01',
  well_name: 'ANB-01',
  field: 'Upper-Assam-Demo',
  latitude: 26,
  longitude: 93,
  spud_date: '2026-07-02',
  completion_date: null,
  total_depth: 3400,
  current_depth: 2842,
  current_formation: { id: 'formation-x', name: 'X Formation', normalized_name: 'x formation', aliases: ['X Sand'] },
  formations: [],
  role: 'active',
  status: 'drilling',
  source: 'Representative Synthetic Demo Data',
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="current-location">{location.pathname}{location.search}</output>
}

function renderWithRouter(ui: ReactNode) {
  return render(<MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><LocationProbe />{ui}</MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('turns API validation details into a short readable error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status: 422,
    json: async () => ({ detail: [
      { loc: ['query', 'radius_km'], msg: 'Input should be greater than 0' },
      { loc: ['query', 'limit'], msg: 'Input should be less than or equal to 200' },
    ] }),
  }))

  await expect(api('/wells')).rejects.toMatchObject({
    name: 'ApiError',
    status: 422,
    message: 'Input should be greater than 0 · Input should be less than or equal to 200',
  })
})

describe('trust and evidence layer', () => {
  it('renders stored page evidence, source metadata, confidence, and opens the linked source page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [sourceEvidence] })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const relatedMatches = [
      match,
      { ...match, event_id: 'event-02', offset_well: { ...match.offset_well, id: 'well-03', well_name: 'ANB-03' } },
      { ...match, event_id: 'event-03', offset_well: { ...match.offset_well, id: 'well-04', well_name: 'ANB-04' } },
    ]

    renderWithRouter(<EvidenceDrawer match={match} relatedMatches={relatedMatches} onClose={() => undefined} />)

    expect(await screen.findByText(/Losses were observed while drilling through X Formation at 2865 m/)).toBeTruthy()
    expect(screen.queryByText(/Correlation response fallback excerpt/)).toBeNull()
    expect(screen.getByText('2,865 m')).toBeTruthy()
    expect(screen.getByText('+23 m')).toBeTruthy()
    expect(screen.getAllByText('4.2 km').length).toBeGreaterThan(0)
    expect(screen.getByText('91 / 100')).toBeTruthy()
    expect(screen.getByText('Adjusted mud program and monitored losses.')).toBeTruthy()
    expect(screen.getByText(/same event type is also recorded in 2 additional matched offset wells/)).toBeTruthy()
    expect(screen.getByText('SYNTHETIC DEMO DATA · REPRESENTATIVE SOURCE RECORD')).toBeTruthy()
    expect(screen.getByText('93%')).toBeTruthy()
    expect(screen.getByText('DDR-ANB-02-2024-07.pdf')).toBeTruthy()

    await user.click(screen.getByRole('link', { name: 'Open stored evidence at source page 18' }))
    await waitFor(() => expect(screen.getByTestId('current-location').textContent).toContain('/documents?documentId=doc-01&eventId=event-01&page=18'))
  })

  it('shows the configured relevance weights and heuristic disclaimer from the API', async () => {
    const apiPayload = {
      active_well: { id: 'active-01', well_name: 'ANB-01', field: 'Upper-Assam-Demo', latitude: 26, longitude: 93, active_depth_m: 2842, active_formation: 'X Formation' },
      radius_km: 20,
      depth_window_m: 100,
      event_family: null,
      heuristic_weights: { formation: 0.3, depth_proximity: 0.25, spatial_proximity: 0.2, event_similarity: 0.15, source_confidence: 0.1 },
      offsets: [],
      total_matching_events: 3,
      message: null,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => apiPayload }))

    render(<MethodologyDrawer activeWellId="active-01" radiusKm={20} depthWindowM={100} onClose={() => undefined} />)

    expect(await screen.findByText('Heuristic historical relevance — not an OIL risk score.')).toBeTruthy()
    expect(screen.getByText('30')).toBeTruthy()
    expect(screen.getByText('25')).toBeTruthy()
    expect(screen.getByText('20')).toBeTruthy()
    expect(screen.getByText('15')).toBeTruthy()
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.getByText(/Haversine distance/)).toBeTruthy()
    expect(screen.getByText(/strongest eligible linked evidence confidence/)).toBeTruthy()
  })

  it('keeps the decision-support banner and synthetic-data note visible in the global shell', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: string) => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => input.endsWith('/health') ? { status: 'ok', database: 'connected' } : [activeWell],
    })))

    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppProvider><AppShell /></AppProvider></MemoryRouter>)

    expect(await screen.findByText('DECISION SUPPORT')).toBeTruthy()
    expect(screen.getByText('Source-linked history · engineer review required')).toBeTruthy()
  })
})

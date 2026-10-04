import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppProvider } from '../lib/AppContext'
import type { Correlation, Document, Evidence, Formation, Well, WellEvent } from '../lib/api'
import { KnowledgePage } from './Knowledge'

const document: Document = {
  id: 'doc-02', well_id: 'well-02', filename: 'DDR-ANB-02-2024-07.pdf', document_type: 'daily_drilling_report',
  source: 'Representative Synthetic Demo Data', origin: 'seeded_demo', source_label: 'Seeded Demo Evidence',
  uploaded_at: '2024-07-14T08:15:00Z', processing_status: 'processed', page_count: 34,
}

const formation: Formation = { id: 'formation-x', name: 'X Formation', normalized_name: 'x formation', aliases: ['x-fm'] }

const activeWell: Well = {
  id: 'well-01', well_name: 'ANB-01', field: 'Upper-Assam-Demo', latitude: 27.45, longitude: 95.2,
  spud_date: '2026-07-02', completion_date: null, total_depth: 3400, current_depth: 2842,
  current_formation: formation, formations: [], role: 'active', status: 'drilling', source: 'Representative Synthetic Demo Data',
}

const evidence: Evidence = {
  id: 'evidence-02', event_id: 'event-02', document_id: document.id, page_number: 3,
  excerpt: 'Representative Synthetic Demo Data: mud loss at 2,875 m in X Formation; loss-control treatment recorded.',
  extraction_method: 'synthetic_demo', confidence: 0.96, document,
}

const event: WellEvent = {
  id: 'event-02', well_id: 'well-02', well_name: 'ANB-04', event_type: 'lost_circulation',
  event_title: 'Mud loss reported in X Formation', description: 'A separate offset record notes mud loss deeper in X Formation.',
  measured_depth: 2875, true_vertical_depth: 2627, formation, event_date: '2022-07-09',
  consequence: 'Reduced returns and a controlled pause were documented.',
  mitigation: 'The report describes a loss-control treatment followed by monitored circulation.',
  severity_label: 'medium', source_document_id: document.id, source_page: 41, confidence: 0.97,
  source_document: document, evidence: [evidence],
}

const correlation = {
  active_well: { id: activeWell.id, well_name: activeWell.well_name, field: activeWell.field, latitude: activeWell.latitude, longitude: activeWell.longitude, active_depth_m: 2842, active_formation: 'X Formation' },
  radius_km: 20, depth_window_m: 100, heuristic_weights: {}, matched_wells: [],
  historical_events: [{ event_id: event.id, offset_well: { id: event.well_id, well_name: event.well_name, field: activeWell.field, latitude: 27.46, longitude: 95.21 }, distance_km: 4.2, historical_depth_m: 2875, active_depth_m: 2842, depth_difference_m: 33, absolute_depth_difference_m: 33, depth_band: 'near', formation: event.formation, formation_match: 'exact', event_type: event.event_type, event_title: event.event_title, description: event.description, consequence: event.consequence, mitigation: event.mitigation, relevance_score: 91, relevance_score_normalized: .91, relevance_band: 'high', components: {}, source_document: document, source_page: 3, evidence_excerpt: evidence.excerpt, source_confidence: .96, existing_alert: null, explanation: 'Same formation and nearby depth.' }],
  total_matching_events: 1, active_formation_interval: null, active_drilling_parameters: null, comparable_wells: [], data_notice: 'Representative Synthetic Demo Data', message: null,
} as unknown as Correlation

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('knowledge repository presentation', () => {
  it('shows a compact, relevant event row and opens the shared source evidence drawer', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const payload = input.endsWith('/wells?limit=500') ? [activeWell]
        : input.endsWith('/health') ? { status: 'ok', database: 'connected' }
          : input.endsWith('/formations') ? [formation]
            : input.includes('/intelligence/well-01/correlation') ? correlation
            : input.includes('/knowledge/search') ? [event]
              : input.includes('/events/event-02/evidence') ? [evidence]
              : []
      return Promise.resolve({ ok: true, status: 200, json: async () => payload })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<MemoryRouter initialEntries={['/knowledge?q=mud%20losses']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProvider><Routes><Route path="/knowledge" element={<KnowledgePage />} /></Routes></AppProvider>
    </MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Historical Event Explorer' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'WELL' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'EVENT' })).toBeTruthy()
    expect(screen.getByRole('row', { name: /Open Mud loss reported in X Formation evidence from ANB-04/ })).toBeTruthy()
    expect(await screen.findByText('91')).toBeTruthy()
    fireEvent.click(screen.getByRole('row', { name: /Open Mud loss reported in X Formation evidence from ANB-04/ }))
    expect(await screen.findByRole('dialog', { name: 'Historical event evidence' })).toBeTruthy()
    expect(screen.getByText('DDR-ANB-02-2024-07.pdf')).toBeTruthy()
    expect(screen.getByText((_text, element) => element?.tagName === 'BLOCKQUOTE' && Boolean(element.textContent?.includes(evidence.excerpt)))).toBeTruthy()
    expect(screen.getByText('Recorded mitigation')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/knowledge/search?q=mud+losses'))).toBe(true)
  })
})

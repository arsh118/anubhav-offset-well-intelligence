import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppProvider } from '../lib/AppContext'
import type { Document, Evidence, Formation, Well, WellEvent } from '../lib/api'
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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('knowledge repository presentation', () => {
  it('loads the judging query and shows the event, challenge, mitigation, and traceable source evidence', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const payload = input.endsWith('/wells?limit=500') ? [activeWell]
        : input.endsWith('/health') ? { status: 'ok', database: 'connected' }
          : input.endsWith('/formations') ? [formation]
            : input.includes('/knowledge/search') ? [event]
              : []
      return Promise.resolve({ ok: true, status: 200, json: async () => payload })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<MemoryRouter initialEntries={['/knowledge?q=mud%20losses']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProvider><Routes><Route path="/knowledge" element={<KnowledgePage />} /></Routes></AppProvider>
    </MemoryRouter>)

    expect(await screen.findByText('Mud loss reported in X Formation')).toBeTruthy()
    expect(screen.getByText((_text, element) => element?.textContent === 'Challenge / summary: A separate offset record notes mud loss deeper in X Formation.')).toBeTruthy()
    expect(screen.getAllByText('Recorded mitigation').length).toBeGreaterThan(0)
    expect(screen.getAllByText('The report describes a loss-control treatment followed by monitored circulation.').length).toBeGreaterThan(0)
    expect(screen.getByText('ANB-04')).toBeTruthy()
    expect(screen.getByText('2,875 m')).toBeTruthy()
    expect(screen.getAllByText('X Formation').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('DDR-ANB-02-2024-07.pdf')).toBeTruthy()
    expect(screen.getByText('Seeded Demo Evidence · Page 3')).toBeTruthy()
    expect(screen.getByText((_text, element) => element?.tagName === 'BLOCKQUOTE' && Boolean(element.textContent?.includes(evidence.excerpt)))).toBeTruthy()
    expect(screen.getByText('Representative Synthetic Demo Data')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/knowledge/search?q=mud+losses'))).toBe(true)
  })
})

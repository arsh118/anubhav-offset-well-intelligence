import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { OffsetWellSummary, Well } from '../lib/api'
import { OffsetMap } from './OffsetMap'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  TileLayer: () => null,
  Circle: () => null,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Polyline: () => <div data-testid="map-connection" />,
  ScaleControl: () => <div data-testid="map-scale-control" />,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useMap: () => ({ fitBounds: () => undefined }),
}))

const activeWell: Well = {
  id: 'well-01', well_name: 'ANB-01', field: 'Demo Field', latitude: 27.45, longitude: 95.2, spud_date: null, completion_date: null,
  total_depth: 3400, current_depth: 2842, current_formation: null, formations: [], role: 'active', status: 'drilling', source: 'Synthetic',
}
const offset: OffsetWellSummary = {
  id: 'well-02', well_name: 'ANB-02', field: 'Demo Field', formation_name: 'X Formation', latitude: 27.48, longitude: 95.21,
  distance_km: 4.2, matching_event_count: 2, best_relevance_score: 91, event_ids: ['event-02'],
}

afterEach(() => cleanup())

describe('operational offset map popup', () => {
  it('shows contextual relevance and opens the selected offset intelligence view', () => {
    const onSelectWell = vi.fn()
    render(<MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes>
      <Route path="/" element={<OffsetMap activeWell={activeWell} offsets={[offset]} radiusKm={20} onSelectWell={onSelectWell} />} />
      <Route path="/offsets" element={<CurrentLocation />} />
    </Routes></MemoryRouter>)

    expect(screen.getByText('X Formation')).toBeTruthy()
    expect(screen.getByText('4.2 km from ANB-01')).toBeTruthy()
    expect(screen.getByText('91 relevance')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View offset intelligence' }))
    expect(onSelectWell).toHaveBeenCalledWith(offset.id)
    expect(screen.getByText('/offsets?well=well-02')).toBeTruthy()
  })

  it('shows live offset distances, dashed connections, radius scaling, and the active well labels in dashboard presentation', () => {
    const secondOffset: OffsetWellSummary = {
      ...offset, id: 'well-03', well_name: 'ANB-03', latitude: 27.42, longitude: 95.22, distance_km: 6.1,
    }
    const { container } = render(<MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <OffsetMap activeWell={activeWell} offsets={[offset, secondOffset]} radiusKm={20} dashboardPresentation />
    </MemoryRouter>)

    const labels = Array.from(container.querySelectorAll('.map-well-label')).map((label) => label.textContent)
    expect(labels).toEqual(['ANB-024.2 km', 'ANB-036.1 km'])
    expect(screen.getAllByTestId('map-connection')).toHaveLength(2)
    expect(screen.getByTestId('map-scale-control')).toBeTruthy()
    expect(screen.getByText('ANB-01 · Active')).toBeTruthy()
  })
})

function CurrentLocation() {
  const location = useLocation()
  return <span>{location.pathname}{location.search}</span>
}

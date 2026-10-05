import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { OffsetWellSummary, Well } from '../lib/api'
import { OffsetMap } from './OffsetMap'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, className, zoomSnap }: { children: React.ReactNode; className?: string; zoomSnap?: number }) => <div className={className} data-zoom-snap={zoomSnap}>
    {children}
  </div>,
  TileLayer: () => null,
  Circle: () => null,
  Marker: ({ children, position, icon }: { children: React.ReactNode; position: [number, number]; icon: { options: { html: string } } }) => <div data-testid="well-marker" data-position={position.join(',')} data-icon-html={icon.options.html}>{children}</div>,
  CircleMarker: ({ center }: { center: [number, number] }) => <div data-testid="recorded-site" data-position={center.join(',')} />,
  Polyline: ({ pathOptions }: { pathOptions: { dashArray: string } }) => <div data-testid="map-connection" data-dash={pathOptions.dashArray} />,
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

  it('spaces dashboard offset markers around the active well while retaining source coordinates and dotted links', () => {
    const secondOffset: OffsetWellSummary = {
      ...offset, id: 'well-03', well_name: 'ANB-03', latitude: 27.42, longitude: 95.22, distance_km: 6.1,
    }
    const { container } = render(<MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <OffsetMap activeWell={activeWell} offsets={[offset, secondOffset]} radiusKm={20} dashboardPresentation />
    </MemoryRouter>)

    const labels = Array.from(container.querySelectorAll('.map-well-label')).map((label) => label.textContent)
    expect(labels).toEqual(['ANB-024.2 km', 'ANB-036.1 km'])
    const markers = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="well-marker"]'))
    const activeMarker = markers.find((marker) => marker.dataset.iconHtml?.includes('dashboard-active-star'))
    const offsetMarkers = markers.filter((marker) => marker.dataset.iconHtml?.includes('dashboard-offset'))
    expect(offsetMarkers).toHaveLength(2)
    expect(screen.getAllByTestId('recorded-site')).toHaveLength(2)
    expect(activeMarker).toBeTruthy()
    const activePosition = activeMarker?.dataset.position?.split(',').map(Number) ?? []
    const displayDistances = offsetMarkers.map((marker) => {
      const [latitude, longitude] = marker.dataset.position?.split(',').map(Number) ?? []
      const latitudeKm = (latitude - activePosition[0]) * 111
      const longitudeKm = (longitude - activePosition[1]) * 111 * Math.cos(activePosition[0] * Math.PI / 180)
      return Math.hypot(latitudeKm, longitudeKm)
    })
    expect(displayDistances.every((distance) => distance >= 16)).toBe(true)
    expect(screen.getAllByTestId('map-connection').filter((line) => line.getAttribute('data-dash') === '4 6')).toHaveLength(2)
    expect(screen.getByTestId('map-scale-control')).toBeTruthy()
    expect(container.querySelector('.leaflet-map')?.getAttribute('data-zoom-snap')).toBe('0.25')
    expect(screen.getByText('ANB-01 · Active')).toBeTruthy()
  })
})

function CurrentLocation() {
  const location = useLocation()
  return <span>{location.pathname}{location.search}</span>
}

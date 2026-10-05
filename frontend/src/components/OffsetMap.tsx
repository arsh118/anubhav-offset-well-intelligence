import { Fragment, useEffect, useMemo } from 'react'
import { Circle, MapContainer, Marker, Polyline, Popup, ScaleControl, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Map as MapIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { OffsetWellSummary, Well } from '../lib/api'
import { formatDistance } from '../lib/format'

type Props = { activeWell: Well; offsets: OffsetWellSummary[]; radiusKm: number; selectedWellId?: string; onSelectWell?: (id: string) => void; dashboardPresentation?: boolean }

function wellIcon(kind: 'active' | 'offset', selected = false, dashboardPresentation = false) {
  if (dashboardPresentation && kind === 'active') {
    return L.divIcon({ className: 'leaflet-anubhav-icon', html: '<span class="map-marker dashboard-active-star" aria-hidden="true">★</span>', iconSize: [28, 28], iconAnchor: [14, 14] })
  }
  if (dashboardPresentation && kind === 'offset') {
    return L.divIcon({ className: 'leaflet-anubhav-icon', html: `<span class="map-marker dashboard-offset${selected ? ' selected' : ''}"><i></i></span>`, iconSize: [24, 24], iconAnchor: [12, 12] })
  }
  const className = `map-marker ${kind}${selected ? ' selected' : ''}`
  return L.divIcon({ className: 'leaflet-anubhav-icon', html: `<span class="${className}"><i></i></span>`, iconSize: [24, 24], iconAnchor: [12, 12] })
}

function FitDashboardMap({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 })
  }, [bounds, map])
  return null
}

export function OffsetMap({ activeWell, offsets, radiusKm, selectedWellId, onSelectWell, dashboardPresentation = false }: Props) {
  const navigate = useNavigate()
  const mapBounds = useMemo(() => {
    if (!dashboardPresentation || activeWell.latitude == null || activeWell.longitude == null) return null
    const center = L.latLng(activeWell.latitude, activeWell.longitude)
    const farthestOffsetKm = offsets.reduce((farthest, offset) => {
      if (offset.latitude == null || offset.longitude == null) return farthest
      return Math.max(farthest, center.distanceTo([offset.latitude, offset.longitude]) / 1_000)
    }, 0)
    const fittingRadiusKm = Math.min(Math.max(radiusKm, 1), Math.max(farthestOffsetKm + 3, radiusKm * 0.65))
    const radiusBounds = center.toBounds(fittingRadiusKm * 2_000)
    const bounds = L.latLngBounds([radiusBounds.getSouthWest(), radiusBounds.getNorthEast()])
    return bounds
  }, [activeWell.latitude, activeWell.longitude, dashboardPresentation, offsets, radiusKm])

  if (activeWell.latitude == null || activeWell.longitude == null) {
    return <div className="map-empty"><MapIcon size={24} /><strong>Location unavailable</strong><span>Coordinates are not available for this active well.</span></div>
  }

  const center: [number, number] = [activeWell.latitude, activeWell.longitude]
  const activeLongitude = activeWell.longitude
  return <MapContainer key={`${activeWell.id}-${radiusKm}`} center={center} zoom={10} scrollWheelZoom={false} className="leaflet-map">
    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <Circle center={center} radius={radiusKm * 1000} pathOptions={{ color: '#48b995', weight: 1, dashArray: '5 5', fillColor: '#48b995', fillOpacity: 0.035 }} />
    {dashboardPresentation && mapBounds && <FitDashboardMap bounds={mapBounds} />}
    {dashboardPresentation && <ScaleControl position="bottomright" metric imperial={false} />}
    <Marker position={center} icon={wellIcon('active', false, dashboardPresentation)} zIndexOffset={1000}><Tooltip direction={dashboardPresentation ? 'bottom' : 'top'} offset={dashboardPresentation ? [0, 8] : [0, -8]} permanent className={dashboardPresentation ? 'map-active-label' : undefined}>{activeWell.well_name} · Active</Tooltip></Marker>
    {offsets.map((offset) => {
      if (offset.latitude == null || offset.longitude == null) return null
      const hasEvents = offset.matching_event_count > 0
      const position: [number, number] = [offset.latitude, offset.longitude]
      const labelDirection: 'left' | 'right' | 'top' = dashboardPresentation ? (offset.longitude < activeLongitude ? 'left' : 'right') : 'top'
      const labelOffset: [number, number] = dashboardPresentation ? (labelDirection === 'right' ? [8, 0] : [-8, 0]) : [0, -8]
      return <Fragment key={offset.id}>
        {dashboardPresentation && <Polyline positions={[center, position]} pathOptions={{ color: '#486458', weight: 1.5, dashArray: '6 5', opacity: 0.9, interactive: false }} />}
        <Marker position={position} icon={wellIcon('offset', offset.id === selectedWellId, dashboardPresentation)} eventHandlers={{ click: () => onSelectWell?.(offset.id) }}>
          <Popup><div className="map-popup"><strong>{offset.well_name}</strong><span>{formatDistance(offset.distance_km)} from {activeWell.well_name}</span><span>{offset.formation_name ?? 'Formation not recorded'}</span><span>{hasEvents ? `${offset.matching_event_count} relevant historical event${offset.matching_event_count === 1 ? '' : 's'}` : 'No event in current correlation window'}</span>{offset.best_relevance_score > 0 && <span>{Math.round(offset.best_relevance_score)} relevance</span>}<button type="button" onClick={() => { onSelectWell?.(offset.id); navigate(`/offsets?well=${encodeURIComponent(offset.id)}`) }}>View offset intelligence</button></div></Popup>
          <Tooltip direction={labelDirection} offset={labelOffset} permanent={dashboardPresentation} className={dashboardPresentation ? 'map-distance-label' : undefined}>
            {dashboardPresentation ? <span className="map-well-label"><strong>{offset.well_name}</strong><span>{formatDistance(offset.distance_km)}</span></span> : <>{offset.well_name}{hasEvents ? ' · historical match' : ''}</>}
          </Tooltip>
        </Marker>
      </Fragment>
    })}
  </MapContainer>
}

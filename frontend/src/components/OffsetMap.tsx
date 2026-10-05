import { Fragment, useEffect, useMemo } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, ScaleControl, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Map as MapIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { OffsetWellSummary, Well } from '../lib/api'
import { formatDistance } from '../lib/format'

type Props = { activeWell: Well; offsets: OffsetWellSummary[]; radiusKm: number; selectedWellId?: string; onSelectWell?: (id: string) => void; dashboardPresentation?: boolean }
type Position = [number, number]
type PlottedOffset = { offset: OffsetWellSummary; recordedPosition: Position; displayPosition: Position; relocated: boolean }

const toRadians = (degrees: number) => degrees * Math.PI / 180
const toDegrees = (radians: number) => radians * 180 / Math.PI
const normalizeBearing = (degrees: number) => (degrees % 360 + 360) % 360

function bearingBetween([latitude1, longitude1]: Position, [latitude2, longitude2]: Position) {
  const lat1 = toRadians(latitude1)
  const lat2 = toRadians(latitude2)
  const deltaLongitude = toRadians(longitude2 - longitude1)
  const y = Math.sin(deltaLongitude) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLongitude)
  return normalizeBearing(toDegrees(Math.atan2(y, x)))
}

function pointAtDistance([latitude, longitude]: Position, bearing: number, distanceKm: number): Position {
  const earthRadiusKm = 6_371.0088
  const angularDistance = distanceKm / earthRadiusKm
  const bearingRadians = toRadians(bearing)
  const latitudeRadians = toRadians(latitude)
  const longitudeRadians = toRadians(longitude)
  const destinationLatitude = Math.asin(Math.sin(latitudeRadians) * Math.cos(angularDistance)
    + Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians))
  const destinationLongitude = longitudeRadians + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
    Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(destinationLatitude),
  )
  return [toDegrees(destinationLatitude), toDegrees(destinationLongitude)]
}

function spreadBearings(items: Array<{ id: string; bearing: number }>) {
  const sorted = [...items].sort((left, right) => left.bearing - right.bearing)
  if (sorted.length < 2) return new Map(sorted.map((item) => [item.id, item.bearing]))

  const spacing = 360 / sorted.length
  let bestStart = sorted[0].bearing
  let smallestError = Number.POSITIVE_INFINITY
  sorted.forEach((item, index) => {
    const candidateStart = normalizeBearing(item.bearing - index * spacing)
    const totalError = sorted.reduce((total, current, currentIndex) => {
      const target = normalizeBearing(candidateStart + currentIndex * spacing)
      const difference = Math.abs(target - current.bearing)
      return total + Math.min(difference, 360 - difference)
    }, 0)
    if (totalError < smallestError) {
      smallestError = totalError
      bestStart = candidateStart
    }
  })
  return new Map(sorted.map((item, index) => [item.id, normalizeBearing(bestStart + index * spacing)]))
}

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
  const plottedOffsets = useMemo<PlottedOffset[]>(() => {
    if (activeWell.latitude == null || activeWell.longitude == null) return []
    const origin: Position = [activeWell.latitude, activeWell.longitude]
    const located = offsets.flatMap((offset) => offset.latitude == null || offset.longitude == null
      ? []
      : [{ offset, position: [offset.latitude, offset.longitude] as Position }])
    const bearingMap = spreadBearings(located.map(({ offset, position }) => ({ id: offset.id, bearing: bearingBetween(origin, position) })))
    const minDisplayDistanceKm = Math.min(16.5, Math.max(1, radiusKm * 0.825))

    return located.map(({ offset, position: recordedPosition }) => {
      if (!dashboardPresentation) return { offset, recordedPosition, displayPosition: recordedPosition, relocated: false }
      const actualDistanceKm = L.latLng(origin).distanceTo(recordedPosition) / 1_000
      const displayDistanceKm = Math.max(actualDistanceKm, minDisplayDistanceKm)
      const displayPosition = pointAtDistance(origin, bearingMap.get(offset.id) ?? bearingBetween(origin, recordedPosition), displayDistanceKm)
      const relocated = L.latLng(displayPosition).distanceTo(recordedPosition) > 75
      return { offset, recordedPosition, displayPosition, relocated }
    })
  }, [activeWell.latitude, activeWell.longitude, dashboardPresentation, offsets, radiusKm])

  const mapBounds = useMemo(() => {
    if (!dashboardPresentation || activeWell.latitude == null || activeWell.longitude == null) return null
    const center = L.latLng(activeWell.latitude, activeWell.longitude)
    const farthestDisplayKm = plottedOffsets.reduce((farthest, item) => Math.max(farthest, center.distanceTo(item.displayPosition) / 1_000), 0)
    const fittingRadiusKm = Math.max(radiusKm, farthestDisplayKm + 2, 1)
    const radiusBounds = center.toBounds(fittingRadiusKm * 2_000)
    const bounds = L.latLngBounds([radiusBounds.getSouthWest(), radiusBounds.getNorthEast()])
    return bounds
  }, [activeWell.latitude, activeWell.longitude, dashboardPresentation, plottedOffsets, radiusKm])

  if (activeWell.latitude == null || activeWell.longitude == null) {
    return <div className="map-empty"><MapIcon size={24} /><strong>Location unavailable</strong><span>Coordinates are not available for this active well.</span></div>
  }

  const center: [number, number] = [activeWell.latitude, activeWell.longitude]
  const activeLongitude = activeWell.longitude
  return <MapContainer key={`${activeWell.id}-${radiusKm}`} center={center} zoom={10} zoomSnap={0.25} scrollWheelZoom={false} className="leaflet-map">
    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <Circle center={center} radius={radiusKm * 1000} pathOptions={{ color: '#48b995', weight: 1, dashArray: '5 5', fillColor: '#48b995', fillOpacity: 0.035 }} />
    {dashboardPresentation && mapBounds && <FitDashboardMap bounds={mapBounds} />}
    {dashboardPresentation && <ScaleControl position="bottomright" metric imperial={false} />}
    <Marker position={center} icon={wellIcon('active', false, dashboardPresentation)} zIndexOffset={1000}><Tooltip direction={dashboardPresentation ? 'bottom' : 'top'} offset={dashboardPresentation ? [0, 8] : [0, -8]} permanent className={dashboardPresentation ? 'map-active-label' : undefined}>{activeWell.well_name} · Active</Tooltip></Marker>
    {plottedOffsets.map(({ offset, recordedPosition, displayPosition, relocated }) => {
      const hasEvents = offset.matching_event_count > 0
      const labelDirection: 'left' | 'right' | 'top' = dashboardPresentation ? (displayPosition[1] < activeLongitude ? 'left' : 'right') : 'top'
      const labelOffset: [number, number] = dashboardPresentation ? (labelDirection === 'right' ? [8, 0] : [-8, 0]) : [0, -8]
      return <Fragment key={offset.id}>
        {dashboardPresentation && <Polyline positions={[center, displayPosition]} pathOptions={{ color: '#294c3c', weight: 2.5, dashArray: '4 6', lineCap: 'round', opacity: 0.96, interactive: false }} />}
        {dashboardPresentation && relocated && <>
          <Polyline positions={[recordedPosition, displayPosition]} pathOptions={{ color: '#60766a', weight: 1.5, dashArray: '2 4', lineCap: 'round', opacity: 0.95, interactive: false }} />
          <CircleMarker center={recordedPosition} radius={4} pathOptions={{ color: '#66776e', weight: 1.5, fillColor: '#fff', fillOpacity: 1, interactive: false }} />
        </>}
        <Marker position={displayPosition} icon={wellIcon('offset', offset.id === selectedWellId, dashboardPresentation)} eventHandlers={{ click: () => onSelectWell?.(offset.id) }}>
          <Popup><div className="map-popup"><strong>{offset.well_name}</strong><span>{formatDistance(offset.distance_km)} from {activeWell.well_name}</span><span>{offset.formation_name ?? 'Formation not recorded'}</span><span>{hasEvents ? `${offset.matching_event_count} relevant historical event${offset.matching_event_count === 1 ? '' : 's'}` : 'No event in current correlation window'}</span>{offset.best_relevance_score > 0 && <span>{Math.round(offset.best_relevance_score)} relevance</span>}<button type="button" onClick={() => { onSelectWell?.(offset.id); navigate(`/offsets?well=${encodeURIComponent(offset.id)}`) }}>View offset intelligence</button></div></Popup>
          <Tooltip direction={labelDirection} offset={labelOffset} permanent={dashboardPresentation} className={dashboardPresentation ? 'map-distance-label' : undefined}>
            {dashboardPresentation ? <span className="map-well-label"><strong>{offset.well_name}</strong><span>{formatDistance(offset.distance_km)}</span></span> : <>{offset.well_name}{hasEvents ? ' · historical match' : ''}</>}
          </Tooltip>
        </Marker>
      </Fragment>
    })}
  </MapContainer>
}

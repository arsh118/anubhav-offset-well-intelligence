import { Circle, MapContainer, Marker, Popup, TileLayer, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import { Map as MapIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { OffsetWellSummary, Well } from '../lib/api'

type Props = { activeWell: Well; offsets: OffsetWellSummary[]; radiusKm: number; selectedWellId?: string; onSelectWell?: (id: string) => void }

function wellIcon(kind: 'active' | 'offset', selected = false) {
  const className = `map-marker ${kind}${selected ? ' selected' : ''}`
  return L.divIcon({ className: 'leaflet-anubhav-icon', html: `<span class="${className}"><i></i></span>`, iconSize: [24, 24], iconAnchor: [12, 12] })
}

export function OffsetMap({ activeWell, offsets, radiusKm, selectedWellId, onSelectWell }: Props) {
  const navigate = useNavigate()
  if (activeWell.latitude == null || activeWell.longitude == null) {
    return <div className="map-empty"><MapIcon size={24} /><strong>Location unavailable</strong><span>Coordinates are not available for this active well.</span></div>
  }

  const center: [number, number] = [activeWell.latitude, activeWell.longitude]
  return <MapContainer key={`${activeWell.id}-${radiusKm}`} center={center} zoom={10} scrollWheelZoom={false} className="leaflet-map">
    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <Circle center={center} radius={radiusKm * 1000} pathOptions={{ color: '#48b995', weight: 1, dashArray: '5 5', fillColor: '#48b995', fillOpacity: 0.035 }} />
    <Marker position={center} icon={wellIcon('active')} zIndexOffset={1000}><Tooltip direction="top" offset={[0, -8]} permanent>{activeWell.well_name} · Active</Tooltip></Marker>
    {offsets.map((offset) => {
      if (offset.latitude == null || offset.longitude == null) return null
      const hasEvents = offset.matching_event_count > 0
      return <Marker key={offset.id} position={[offset.latitude, offset.longitude]} icon={wellIcon('offset', offset.id === selectedWellId)} eventHandlers={{ click: () => onSelectWell?.(offset.id) }}>
        <Popup><div className="map-popup"><strong>{offset.well_name}</strong><span>{offset.distance_km.toFixed(1)} km from {activeWell.well_name}</span><span>{offset.formation_name ?? 'Formation not recorded'}</span><span>{hasEvents ? `${offset.matching_event_count} relevant historical event${offset.matching_event_count === 1 ? '' : 's'}` : 'No event in current correlation window'}</span>{offset.best_relevance_score > 0 && <span>{Math.round(offset.best_relevance_score)} relevance</span>}<button type="button" onClick={() => { onSelectWell?.(offset.id); navigate(`/offsets?well=${encodeURIComponent(offset.id)}`) }}>View offset intelligence</button></div></Popup>
        <Tooltip direction="top" offset={[0, -8]}>{offset.well_name}{hasEvents ? ' · historical match' : ''}</Tooltip>
      </Marker>
    })}
  </MapContainer>
}

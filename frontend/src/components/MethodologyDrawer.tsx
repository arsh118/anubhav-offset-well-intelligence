import { useEffect, useState } from 'react'
import { BarChart3, CheckCircle2, CircleHelp, Layers3, MapPinned, Ruler, Waves, X, type LucideIcon } from 'lucide-react'
import { api, queryString, type OffsetWellsRead } from '../lib/api'
import { humanize } from '../lib/format'
import { ErrorState, Loading } from './Feedback'

type Props = { activeWellId: string; radiusKm: number; depthWindowM: number; onClose: () => void }

const componentDescriptions: Record<string, string> = {
  formation: 'Exact normalized formation matches receive the full component score; a recognized alias receives a lower score. Missing or different formations score zero.',
  depth_proximity: 'Compares the historical measured depth with the active measured depth. Its score decreases with separation using the configured proximity bands and selected depth window.',
  spatial_proximity: 'Uses Haversine distance between well coordinates. The component decreases linearly with distance across the selected radius.',
  event_similarity: 'Compares the event type with an optional event family. Without a selected family, this prototype currently assigns the default component score of 1.0.',
  source_confidence: 'Averages the structured event confidence and the strongest eligible linked evidence confidence.',
}

const componentIcons: Record<string, LucideIcon> = {
  formation: Layers3,
  depth_proximity: Ruler,
  spatial_proximity: MapPinned,
  event_similarity: Waves,
  source_confidence: CheckCircle2,
}

export function MethodologyDrawer({ activeWellId, radiusKm, depthWindowM, onClose }: Props) {
  const [data, setData] = useState<OffsetWellsRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      setLoading(true)
      try {
        const result = await api<OffsetWellsRead>(`/intelligence/${activeWellId}/offsets${queryString({ radius_km: radiusKm, depth_window_m: depthWindowM })}`)
        if (live) { setData(result); setError(null) }
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : 'Unable to load methodology settings.')
      } finally { if (live) setLoading(false) }
    }
    void load()
    return () => { live = false }
  }, [activeWellId, radiusKm, depthWindowM])

  return <div className="drawer-overlay methodology-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="methodology-drawer" role="dialog" aria-modal="true" aria-label="How ANUBHAV calculates historical relevance">
      <div className="drawer-header"><div><div className="eyebrow">TRANSPARENT HEURISTIC</div><h2>How relevance is calculated</h2></div><button className="icon-button" onClick={onClose} aria-label="Close methodology drawer"><X size={18} /></button></div>
      <div className="methodology-notice"><CircleHelp size={17} /><div><strong>Heuristic historical relevance — not an OIL risk score.</strong><span>It ranks evidence-backed historical analogs for engineer review. It does not predict an incident or replace engineering judgment.</span></div></div>
      {loading ? <Loading label="Loading active relevance weights" /> : error ? <ErrorState message={error} /> : data && <>
        <div className="method-context"><span>ACTIVE CONTEXT</span><strong>{data.active_well.well_name} · {data.active_well.active_formation ?? 'Formation unavailable'}</strong><small>{data.active_well.active_depth_m?.toLocaleString() ?? '—'} m MD · {data.radius_km} km radius · {data.depth_window_m} m depth window</small></div>
        <div className="method-formula"><span>COMPOSITE SCORE</span><code>100 × Σ(component score × normalized weight)</code><small>Each component is normalized from 0 to 1. The weights below are returned by the active ANUBHAV API configuration.</small></div>
        <div className="method-components"><div className="method-section-label">SCORING COMPONENTS</div>{Object.entries(data.heuristic_weights).map(([key, weight]) => {
          const Icon = componentIcons[key] ?? BarChart3
          return <article className="method-component" key={key}><span className="method-icon"><Icon size={15} /></span><div className="method-component-copy"><strong>{humanize(key)}</strong><p>{componentDescriptions[key] ?? 'Component score returned by the active intelligence API.'}</p></div><span className="method-weight">{(weight * 100).toFixed(0)}<small>%</small></span></article>
        })}</div>
        <div className="method-footnote"><BarChart3 size={14} /><span>Prototype heuristic defaults are configurable and are not calibrated, independently validated, or OIL-approved.</span></div>
      </>}
    </aside>
  </div>
}

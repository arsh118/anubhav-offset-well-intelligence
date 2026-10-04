import { ArrowRight, ChevronRight, Ruler } from 'lucide-react'
import type { OffsetMatch, Well } from '../lib/api'
import { formatDepth, signedDepth } from '../lib/format'

type Props = { activeWell: Well; events: OffsetMatch[]; depthWindowM: number; onSelect: (event: OffsetMatch) => void }

export function DepthCorrelation({ activeWell, events, depthWindowM, onSelect }: Props) {
  const activeDepth = activeWell.current_depth ?? events[0]?.active_depth_m ?? 0
  const min = Math.max(0, activeDepth - Math.min(40, depthWindowM * 0.2))
  const max = activeDepth + depthWindowM
  const span = Math.max(1, max - min)
  const position = (depth: number) => Math.min(99, Math.max(1, ((depth - min) / span) * 100))
  const formationBands = activeWell.formations.filter((interval) => interval.base_depth >= min && interval.top_depth <= max)
  const visibleEvents = events.filter((event) => event.historical_depth_m >= min && event.historical_depth_m <= max).slice(0, 30)
  const aheadEvents = events.filter((event) => event.depth_difference_m > 0)
  const strongest = aheadEvents[0]
  const formationMatchCount = events.filter((event) => event.formation_match === 'exact' || event.formation_match === 'alias').length
  const chips = [
    formationMatchCount ? `Same formation · ${formationMatchCount}` : activeWell.current_formation?.name ?? 'Formation unavailable',
    strongest ? `${Math.round(strongest.depth_difference_m)} m ahead` : 'No event ahead in window',
    strongest ? `${strongest.distance_km.toFixed(1)} km away` : `${events.length} historical matches`,
    `${events.length} correlated event${events.length === 1 ? '' : 's'}`,
  ]

  return <section className="panel correlation-panel">
    <div className="panel-heading"><div><div className="eyebrow">DEPTH-AWARE OFFSET COMPARISON</div><h2>Depth correlation</h2></div><span className="panel-meta"><Ruler size={14} /> MD · meters</span></div>
    {visibleEvents.length === 0 ? <div className="correlation-empty"><strong>No significant historical precedent found in the selected radius and depth window.</strong><span>Try a wider radius or a larger depth window to review more historical records.</span></div> : <>
      <div className="depth-chart">
        <div className="depth-scale"><span>{formatDepth(min)}</span><span>{formatDepth((min + max) / 2)}</span><span>{formatDepth(max)}</span></div>
        <div className="depth-track">
          {formationBands.map((band) => {
            const left = position(Math.max(min, band.top_depth))
            const right = position(Math.min(max, band.base_depth))
            return <div className="formation-band" key={band.id} style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }} title={`${band.formation.name}: ${formatDepth(band.top_depth)}–${formatDepth(band.base_depth)}`}>
              <span>{band.formation.name}</span>
            </div>
          })}
          <div className="active-depth-window" style={{ left: `${position(activeDepth)}%`, width: `${Math.max(0, position(max) - position(activeDepth))}%` }} />
          <div className="depth-tick active-tick" style={{ left: `${position(activeDepth)}%` }}><span>ACTIVE {formatDepth(activeDepth)}</span></div>
          {visibleEvents.map((event) => <button key={event.event_id} className={`depth-event ${event.relevance_band}`} style={{ left: `${position(event.historical_depth_m)}%` }} onClick={() => onSelect(event)} title={`${event.event_title} · ${formatDepth(event.historical_depth_m)} · ${event.offset_well.well_name}`}>
            <span className="depth-event-dot" /><span className="depth-event-label">{event.offset_well.well_name} · {signedDepth(event.depth_difference_m)}</span>
          </button>)}
        </div>
      </div>
      <div className="depth-legend"><span><i className="legend-active" />Current depth</span><span><i className="legend-future" />Future depth window</span><span><i className="legend-event" />Historical event</span><span className="legend-hint">Select a marker to inspect its source evidence</span></div>
      <div className="why-signal"><div className="why-heading"><div><div className="eyebrow">EVIDENCE SUMMARY</div><h3>Why this signal?</h3></div>{strongest && <button className="inline-link" onClick={() => onSelect(strongest)}>Open strongest match <ChevronRight size={15} /></button>}</div>
        <div className="evidence-chips">{chips.map((chip) => <span key={chip} className="evidence-chip"><i />{chip}</span>)}</div>
      </div>
      <div className="correlation-list">{visibleEvents.slice(0, 4).map((event) => <button key={event.event_id} className="correlation-row" onClick={() => onSelect(event)} aria-label={`View evidence for ${event.event_title} in ${event.offset_well.well_name}`}>
        <span className={`event-dot ${event.relevance_band}`} /><span className="correlation-event-name">{event.event_title}<small>{event.offset_well.well_name} · {event.formation?.name ?? 'Formation not recorded'}</small></span><span className="correlation-depth">{formatDepth(event.historical_depth_m)}<small>{signedDepth(event.depth_difference_m)} from active</small></span><span className="correlation-score">{Math.round(event.relevance_score)}<small>RELEVANCE</small></span><span className="view-evidence-label">View evidence</span><ArrowRight size={15} className="row-arrow" />
      </button>)}</div>
    </>}
  </section>
}

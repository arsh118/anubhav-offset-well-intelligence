import { ArrowRight, ChevronRight, Ruler } from 'lucide-react'
import type { OffsetMatch, Well } from '../lib/api'
import { formatDepth, humanize, signedDepth } from '../lib/format'

type Props = { activeWell: Well; events: OffsetMatch[]; depthWindowM: number; onSelect: (event: OffsetMatch) => void }

export function DepthCorrelation({ activeWell, events, depthWindowM, onSelect }: Props) {
  const activeDepth = activeWell.current_depth ?? events[0]?.active_depth_m ?? 0
  const min = Math.max(0, activeDepth - Math.min(40, depthWindowM * 0.2))
  const max = activeDepth + depthWindowM
  const span = Math.max(1, max - min)
  const position = (depth: number) => Math.min(99, Math.max(1, ((depth - min) / span) * 100))
  const formationBands = activeWell.formations.filter((interval) => interval.base_depth >= min && interval.top_depth <= max)
  const visibleEvents = events
    .filter((event) => event.historical_depth_m >= min && event.historical_depth_m <= max)
    .sort((left, right) => left.absolute_depth_difference_m - right.absolute_depth_difference_m)
  const plottedEvents = visibleEvents.slice(0, 5)
  const strongest = [...visibleEvents.filter((event) => event.depth_difference_m > 0)]
    .sort((left, right) => right.relevance_score - left.relevance_score)[0] ?? visibleEvents[0]
  const formationMatchCount = events.filter((event) => event.formation_match === 'exact' || event.formation_match === 'alias').length
  const chips = [
    formationMatchCount ? `${formationMatchCount} formation matches` : activeWell.current_formation?.name ?? 'Formation unavailable',
    strongest ? signedDepth(strongest.depth_difference_m) : 'No event in depth window',
    strongest ? `${strongest.distance_km.toFixed(1)} km offset` : `${events.length} historical matches`,
    `${events.length} correlated ${events.length === 1 ? 'event' : 'events'}`,
  ]

  return <section className="panel correlation-panel" aria-labelledby="depth-correlation-title">
    <div className="panel-heading"><div><div className="eyebrow">DEPTH CORRELATION</div><h2 id="depth-correlation-title">Approaching historical events</h2></div><span className="panel-meta"><Ruler size={15} />{depthWindowM} m window</span></div>
    {visibleEvents.length === 0 ? <div className="correlation-empty"><strong>No matched historical events in this depth window.</strong><span>Adjust the radius or depth window to review more source-backed records.</span></div> : <>
      <div className="depth-chart" aria-label={`Depth correlation from ${Math.round(min)} to ${Math.round(max)} meters`}>
        <div className="depth-scale"><span>{formatDepth(min)}</span><span>{formatDepth(min + span / 2)}</span><span>{formatDepth(max)}</span></div>
        <div className="depth-plot">
          <div className="depth-formation-track" aria-label="Active well formation intervals">
            {formationBands.map((band) => {
              const left = position(Math.max(min, band.top_depth))
              const right = position(Math.min(max, band.base_depth))
              return <div className="formation-band" key={band.id} style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }} title={`${band.formation.name}: ${formatDepth(band.top_depth)}–${formatDepth(band.base_depth)}`}>
                <span>{band.formation.name}</span>
              </div>
            })}
          </div>
          <div className="depth-track">
            <div className="active-depth-window" style={{ left: `${position(activeDepth)}%`, width: `${Math.max(0, position(max) - position(activeDepth))}%` }} />
            <div className="depth-axis-line" />
            <div className="depth-tick active-tick" style={{ left: `${position(activeDepth)}%` }}><span>CURRENT · {formatDepth(activeDepth)}</span></div>
            {plottedEvents.map((event, index) => <button key={event.event_id} className={`depth-event ${event.relevance_band}`} style={{ left: `${position(event.historical_depth_m)}%`, top: `${index * 48}px` }} onClick={() => onSelect(event)} title={`${event.event_title} · ${formatDepth(event.historical_depth_m)} · ${event.offset_well.well_name}`} aria-label={`${event.event_title}, ${event.offset_well.well_name}, ${formatDepth(event.historical_depth_m)}, ${signedDepth(event.depth_difference_m)}`}>
              <span className="depth-event-stem" /><span className="depth-event-dot" /><span className="depth-event-label"><strong>{formatDepth(event.historical_depth_m)} m</strong><small>{humanize(event.event_type)}</small></span>
            </button>)}
          </div>
        </div>
        <div className="depth-legend"><span><i className="legend-active" />Current measured depth</span><span><i className="legend-future" />Look-ahead window</span><span><i className="legend-event" />Historical event</span><span className="legend-hint">Select a marker for source evidence</span></div>
      </div>
      <details className="depth-details"><summary>Related events and match context <span>{visibleEvents.length}</span></summary>
        <div className="why-signal"><div className="why-heading"><div><div className="eyebrow">MATCH CONTEXT</div><h3>Why this signal?</h3></div>{strongest && <button className="inline-link" onClick={() => onSelect(strongest)}>View strongest evidence <ChevronRight size={15} /></button>}</div>
          <div className="evidence-chips">{chips.map((chip) => <span key={chip} className="evidence-chip"><i />{chip}</span>)}</div>
        </div>
        <div className="correlation-list">{visibleEvents.slice(0, 4).map((event) => <button key={event.event_id} className="correlation-row" onClick={() => onSelect(event)} aria-label={`View evidence for ${event.event_title} in ${event.offset_well.well_name}`}>
          <span className={`event-dot ${event.relevance_band}`} /><span className="correlation-event-name">{event.event_title}<small>{event.offset_well.well_name} · {event.formation?.name ?? 'Formation not recorded'}</small></span><span className="correlation-depth">{formatDepth(event.historical_depth_m)}<small>{signedDepth(event.depth_difference_m)}</small></span><span className={`score-badge ${event.relevance_band}`}>{Math.round(event.relevance_score)}</span><span className="view-evidence-label">Evidence</span><ArrowRight size={15} className="row-arrow" />
        </button>)}</div>
        {visibleEvents.length > plottedEvents.length && <p className="depth-more-note">Showing the 5 nearest markers. Full event records remain in Offset Wells.</p>}
      </details>
    </>}
  </section>
}
